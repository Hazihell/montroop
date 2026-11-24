// Hold
// ====
// `ki hold <dir>`: a work session's holder, a process of its own (a systemd
// user unit the server starts, Sessions) so the session outlives a server
// restart. It runs one Claude Code session in the session's worktree until
// it has nothing left to do, tells the server everything it does (Wire),
// and parks each call a rule names until the server sends the owner's
// answer. What it tells is also kept in the session's log, which the
// server reads what it missed from once the holder is gone.

import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import type { CanUseTool, HookCallback, PermissionResult, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeSub } from "./ClaudeSub.ts";
import { err_why } from "./Err.ts";
import { get, list, rec, str } from "./Json.ts";
import { Rules, type Rule } from "./Rules.ts";
import { Wire, type Ask, type Ev, type Told } from "./Wire.ts";

// what a session keeps for its life: its worktree, its Claude account's
// folder, its model ("": the account's default) and what its system
// prompt adds, fixed at its start
export type Spec = { cwd: string; claude: string; model: string; append: string };

// what one holder starts with: its first message, the Claude Code session
// it resumes ("": a new one), the rules that ask the owner first, the
// socket it listens on
export type Start = { prompt: string; resume: string; rules: Rule[]; sock: string };

export const SPEC = "spec.json";
export const START = "start.json";
export const LOG = "log.jsonl";

const CLIP = 2000;

// how long a holder whose run is over waits for the server to take what
// it has not acked yet; the rest stays in the log
const LINGER = 60e3;

const ENV = {
  CLAUDE_AGENT_SDK_CLIENT_APP              : "ki",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC : "1",
};

// a session asks no one in it: the owner's answers come through the gate
const NOT = ["AskUserQuestion"];

export namespace Hold {

  // what the log holds, oldest first (a line cut short by a crash is
  // skipped)
  export function told(dir: string): Told[] {
    let text = "";
    try {
      text = fs.readFileSync(path.join(dir, LOG), "utf8");
    } catch {}
    return text.split("\n").flatMap((line) => {
      try {
        const t: unknown = JSON.parse(line);
        return rec(t) && typeof t.seq === "number" && rec(t.ev) ? [t as Told] : [];
      } catch {
        return [];
      }
    });
  }

  export function clip(text: string): string {
    return text.length > CLIP ? text.slice(0, CLIP) + "…" : text;
  }

  // a tool's input or result as text
  export function shown(x: unknown): string {
    if (typeof x === "string") {
      return x;
    }
    const blocks = list(x).filter((b) => get(b, "type") === "text").map((b) => str(get(b, "text")) ?? "");
    return blocks.length > 0 ? blocks.join("\n") : JSON.stringify(x);
  }

  // the messages Claude Code reads, as they come; closed: it ends
  export function inbox() {
    const queue: SDKUserMessage[] = [];
    let wake = () => {};
    let shut = false;
    const put = (text: string) => {
      queue.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });
      wake();
    };
    const close = () => {
      shut = true;
      wake();
    };
    async function* read(): AsyncGenerator<SDKUserMessage> {
      for (;;) {
        for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
          yield next;
        }
        if (shut) {
          return;
        }
        await new Promise<void>((ok) => (wake = ok));
      }
    }
    return { put, close, read, empty: () => queue.length === 0, open: () => !shut };
  }

  export async function main(dir: string): Promise<void> {
    const spec = JSON.parse(fs.readFileSync(path.join(dir, SPEC), "utf8")) as Spec;
    const start = JSON.parse(fs.readFileSync(path.join(dir, START), "utf8")) as Start;
    const log = fs.openSync(path.join(dir, LOG), "a");
    const box = Wire.outbox(Hold.told(dir).at(-1)?.seq ?? 0);
    const asks = new Map<string, { ask: Ask; done: (r: PermissionResult) => void }>();
    const named = new Map<string, string>();
    const notes = new Map<string, string>();
    const heard = new Set<string>();
    const box_in = Hold.inbox();
    let rules = start.rules;
    let conn: net.Socket | null = null;
    let sdk = start.resume;
    let tasks = 0;

    const send = (s: net.Socket | null, msg: Parameters<typeof Wire.line>[0]) => {
      if (s !== null && !s.destroyed) {
        s.write(Wire.line(msg));
      }
    };
    const emit = (ev: Ev) => {
      const told = Wire.push(box, ev, Date.now());
      fs.writeSync(log, JSON.stringify(told) + "\n");
      send(conn, { $: "ev", ...told });
    };
    const said = (msg: Record<string, unknown>, s: net.Socket) => {
      if (msg.$ === "hello") {
        if (conn !== null && conn !== s) {
          conn.destroy();
        }
        conn = s;
        rules = Array.isArray(msg.rules) ? (msg.rules as Rule[]) : rules;
        Wire.ack(box, Number(msg.ack) || 0);
        send(s, { $: "welcome", seq: box.seq, asks: [...asks.values()].map((a) => a.ask) });
        box.kept.forEach((t) => send(s, { $: "ev", ...t }));
      } else if (s !== conn) {
        return;
      } else if (msg.$ === "ack") {
        Wire.ack(box, Number(msg.seq) || 0);
      } else if (msg.$ === "answer") {
        Hold.answer(asks, notes, String(msg.id), msg.ok === true, str(msg.note) ?? "", emit);
      } else if (msg.$ === "say" && typeof msg.id === "string" && typeof msg.text === "string" && !heard.has(msg.id) && box_in.open()) {
        heard.add(msg.id);
        box_in.put(msg.text);
        emit({ k: "heard", id: msg.id });
      }
    };

    const sock = start.sock;
    fs.rmSync(sock, { force: true });
    const server = net.createServer((s) => {
      s.setEncoding("utf8");
      s.on("data", Wire.lines((msg) => said(msg, s)));
      s.on("error", () => {});
      s.on("close", () => {
        if (conn === s) {
          conn = null;
        }
      });
    });
    await new Promise<void>((ok) => server.listen(sock, ok));

    const pre: HookCallback = (input) => {
      if (input.hook_event_name !== "PreToolUse") {
        return Promise.resolve({});
      }
      const args = rec(input.tool_input) ? input.tool_input : {};
      const [tool, given] = input.tool_name === "Bash" ? ["shell", { command: args.command }] : [input.tool_name, args];
      const rule = Rules.match(rules, tool, given, spec.cwd);
      if (rule === null) {
        return Promise.resolve({});
      }
      named.set(input.tool_use_id, rule.what);
      return Promise.resolve({ hookSpecificOutput: { hookEventName: "PreToolUse" as const, permissionDecision: "ask" as const, permissionDecisionReason: rule.what } });
    };
    const post: HookCallback = (input) => {
      const note = input.hook_event_name === "PostToolUse" ? notes.get(input.tool_use_id) : undefined;
      if (input.hook_event_name !== "PostToolUse" || note === undefined) {
        return Promise.resolve({});
      }
      notes.delete(input.tool_use_id);
      return Promise.resolve({ hookSpecificOutput: { hookEventName: "PostToolUse" as const, additionalContext: "The user approved this with a note: “" + note + "”" } });
    };
    const can: CanUseTool = (tool, input, { signal, toolUseID }) => {
      const what = named.get(toolUseID);
      named.delete(toolUseID);
      if (what === undefined) {
        return Promise.resolve({ behavior: "allow", updatedInput: input });
      }
      return new Promise((ok) => {
        const ask = { id: toolUseID, tool, input, what };
        const off = () => {
          if (asks.delete(toolUseID)) {
            emit({ k: "dropped", id: toolUseID });
            ok({ behavior: "deny", message: "Stopped." });
          }
        };
        asks.set(toolUseID, { ask, done: (r) => (signal.removeEventListener("abort", off), ok(r)) });
        signal.addEventListener("abort", off, { once: true });
        emit({ k: "ask", ...ask });
      });
    };

    box_in.put(start.prompt);
    let end: Ev = { k: "end", ok: false, text: "Claude Code ended before its turn did." };
    try {
      const sdk_mod = await ClaudeSub.sdk();
      const q = sdk_mod.query({ prompt: box_in.read(), options: {
        cwd                        : spec.cwd,
        model                      : spec.model === "" ? undefined : spec.model,
        pathToClaudeCodeExecutable : await ClaudeSub.bin_on_disk(),
        env                        : { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ANTHROPIC_|CLAUDE_|DISABLE_AUTO_COMPACT$)/.test(k))), ...ENV, CLAUDE_CONFIG_DIR: spec.claude },
        systemPrompt               : { type: "preset", preset: "claude_code", append: spec.append },
        tools                      : { type: "preset", preset: "claude_code" },
        settingSources             : ["user", "project", "local"],
        permissionMode             : "default",
        disallowedTools            : NOT,
        settings                   : { disableClaudeAiConnectors: true },
        resume                     : sdk === "" ? undefined : sdk,
        canUseTool                 : can,
        hooks                      : {
          PreToolUse  : [{ hooks: [pre], onFailure: "block" }],
          PostToolUse : [{ hooks: [post] }],
        },
      } });
      for await (const msg of q) {
        if (msg.type === "system" && msg.subtype === "init" && msg.session_id !== sdk) {
          sdk = msg.session_id;
          emit({ k: "began", sdk });
        }
        if (msg.type === "system" && msg.subtype === "background_tasks_changed") {
          tasks = msg.tasks.filter((t) => t.ambient !== true).length;
        }
        Hold.told_of(msg).forEach(emit);
        if (msg.type === "result") {
          end = { k: "end", ok: msg.subtype === "success" && !msg.is_error, text: msg.subtype === "success" ? msg.result : msg.errors.join("; ") };
          if (box_in.empty() && tasks === 0 && asks.size === 0) {
            box_in.close();
          }
        }
      }
    } catch (err) {
      end = { k: "end", ok: false, text: err_why(err) };
    }
    emit(end);
    for (const at = Date.now(); box.kept.length > 0 && Date.now() - at < LINGER; ) {
      await Bun.sleep(200);
    }
    server.close();
    fs.rmSync(sock, { force: true });
    fs.closeSync(log);
    process.exit(0);
  }

  // what a message of Claude Code's tells the server (only the session's
  // own, not its subagents')
  export function told_of(msg: SDKMessage): Ev[] {
    if (msg.type === "assistant" && msg.parent_tool_use_id === null) {
      return msg.message.content.flatMap((b): Ev[] =>
        b.type === "text" && b.text.trim() !== "" ? [{ k: "text", text: b.text }] :
        b.type === "tool_use" ? [{ k: "tool", id: b.id, name: b.name, input: Hold.clip(Hold.shown(b.input)) }] : []);
    }
    if (msg.type === "user" && msg.parent_tool_use_id === null && Array.isArray(msg.message.content)) {
      return msg.message.content.flatMap((b): Ev[] => (b.type === "tool_result" ? [{ k: "result", id: b.tool_use_id, text: Hold.clip(Hold.shown(b.content ?? "")), error: b.is_error === true }] : []));
    }
    if (msg.type === "system" && msg.subtype === "compact_boundary") {
      return [{ k: "compacted" }];
    }
    if (msg.type === "result") {
      return [{ k: "turn", ok: msg.subtype === "success" && !msg.is_error, text: msg.subtype === "success" ? msg.result : msg.errors.join("; ") }];
    }
    return [];
  }

  // the owner's answer to a parked call; one it already had, or for a
  // call no longer parked, does nothing
  export function answer(asks: Map<string, { ask: Ask; done: (r: PermissionResult) => void }>, notes: Map<string, string>, id: string, ok: boolean, note: string, emit: (ev: Ev) => void): void {
    const parked = asks.get(id);
    if (parked === undefined) {
      return;
    }
    asks.delete(id);
    emit({ k: "answered", id, ok });
    const said = note === "" ? "" : ": “" + note + "”";
    if (ok && note !== "") {
      notes.set(id, note);
    }
    parked.done(ok ? { behavior: "allow", updatedInput: parked.ask.input } : { behavior: "deny", message: "The user denied this (" + parked.ask.what.toLowerCase() + ")" + (said || ".") + " Don't do it another way; if it's still needed, say so when you finish." });
  }

}
