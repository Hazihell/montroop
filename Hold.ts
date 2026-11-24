// Hold
// ====
// `ki hold <dir>`: a work session's holder, a process of its own (a systemd
// user unit the server starts, Sessions) so the session outlives a server
// restart. It runs one Claude Code session in the session's worktree until
// it has nothing left to do, tells the server everything it does (Wire),
// and parks each call a rule names until the server sends the owner's
// answer. What it tells is also kept in the session's log, which the
// server reads what it missed from once the holder is gone. It gives the
// session two tools of Ki's: ask_owner, a question for its agent that
// waits for the answer (a message the server sends as one), and report,
// its result.

import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import type { CanUseTool, HookCallback, McpSdkServerConfigWithInstance, PermissionResult, SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { ClaudeSub } from "./ClaudeSub.ts";
import { err_why } from "./Err.ts";
import { get, list, rec, str } from "./Json.ts";
import { Rules, type Rule } from "./Rules.ts";
import { BIN } from "./Browser.ts";
import { Wire, type Ask, type Asking, type Ev, type Outbox, type Told } from "./Wire.ts";

// what a session keeps for its life: its worktree, its Claude account's
// folder, its model ("": the account's default) and what its system
// prompt adds, fixed at its start
export type Spec = { cwd: string; claude: string; model: string; append: string };

// what one holder starts with: its first message, the Claude Code session
// it resumes ("": a new one), the rules that ask the owner first, the
// socket it listens on
export type Start = { prompt: string; resume: string; rules: Rule[]; sock: string };

type Parked = { ask: Ask; done: (r: PermissionResult) => void };

type Waiting = { q: Asking; done: (answer: string) => void };

// a holder's state: what it told and the server hasn't acked, the calls
// parked, the questions waiting for an answer, the notes the owner
// approved some with, the messages the server sent (by id), Claude Code's
// input, the rules that park a call, the connection that owns it now, how
// it tells an event
type Held = {
  out   : Outbox;
  asks  : Map<string, Parked>;
  waits : Map<string, Waiting>;
  notes : Map<string, string>;
  says  : Set<string>;
  inbox : ReturnType<typeof ClaudeSub.inbox>;
  rules : Rule[];
  conn  : net.Socket | null;
  emit  : (ev: Ev) => void;
};

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
const DISALLOWED = ["AskUserQuestion"];

// claude.ai's connectors left out; a project's AGENTS.md loaded beside any
// CLAUDE.md (by default it's skipped when one is found further up, as the
// account's own often is)
const SETTINGS = {
  disableClaudeAiConnectors : true,
  pluginConfigs             : { "cc-plugin-agents-md@builtin": { options: { instructionFiles: "claude-md-and-agents-md" } } },
};

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

  // a message from a connection: a hello takes the holder over (closing
  // the one it had) and gets a welcome, then what isn't acked yet; the
  // rest counts only from the connection that owns it
  export function got(h: Held, msg: Record<string, unknown>, s: net.Socket): void {
    if (msg.$ === "hello") {
      if (h.conn !== null && h.conn !== s) {
        h.conn.destroy();
      }
      h.conn = s;
      h.rules = Array.isArray(msg.rules) ? (msg.rules as Rule[]) : h.rules;
      Wire.ack(h.out, Number(msg.ack) || 0);
      Wire.send(s, { $: "welcome", seq: h.out.seq, asks: [...h.asks.values()].map((a) => a.ask), questions: [...h.waits.values()].map((w) => w.q) });
      h.out.kept.forEach((t) => Wire.send(s, { $: "ev", ...t }));
    } else if (s !== h.conn) {
      return;
    } else if (msg.$ === "ack") {
      Wire.ack(h.out, Number(msg.seq) || 0);
    } else if (msg.$ === "rules" && Array.isArray(msg.rules)) {
      h.rules = msg.rules as Rule[];
    } else if (msg.$ === "answer") {
      Hold.answer(h, String(msg.id), msg.ok === true, str(msg.note) ?? "");
    } else if (msg.$ === "say" && typeof msg.id === "string" && typeof msg.text === "string" && !h.says.has(msg.id) && h.inbox.open()) {
      h.says.add(msg.id);
      const [first] = h.waits.values();
      if (msg.answer !== true || first === undefined) {
        h.inbox.put([msg.text], []);
      } else {
        h.waits.delete(first.q.id);
        h.emit({ k: "replied", id: first.q.id });
        first.done(msg.text);
      }
      h.emit({ k: "heard", id: msg.id });
    }
  }

  export function tools(h: Held, sdk: Awaited<ReturnType<typeof ClaudeSub.sdk>>): McpSdkServerConfigWithInstance {
    const said = (text: string) => ({ content: [{ type: "text" as const, text }] });
    return sdk.createSdkMcpServer({ name: "ki", alwaysLoad: true, tools: [
      sdk.tool("ask_owner", "Ask the agent that started this session a question, when you can't go on without its answer (a decision, missing information). The call waits for the answer, which can take a while; it comes back as this call's result.", { question: z.string() }, async ({ question }) => {
        const id = crypto.randomUUID();
        const answer = await new Promise<string>((done) => {
          h.waits.set(id, { q: { id, text: question }, done });
          h.emit({ k: "question", id, text: question });
        });
        return said("The answer: " + answer);
      }),
      sdk.tool("report", "Give your result to the agent that started this session, once, when you're done: what you did, where (branch, commits, files), how you checked it, what is left. Then end your turn.", { result: z.string() }, ({ result }) => {
        h.emit({ k: "report", text: result });
        return Promise.resolve(said("Reported. End your turn now."));
      }),
    ] });
  }

  // the owner's answer to a parked call; one it already had, or for a
  // call no longer parked, does nothing
  export function answer(h: Held, id: string, ok: boolean, note: string): void {
    const parked = h.asks.get(id);
    if (parked === undefined) {
      return;
    }
    h.asks.delete(id);
    h.emit({ k: "answered", id, ok });
    if (ok && note !== "") {
      h.notes.set(id, note);
    }
    const said = note === "" ? "." : ": “" + note + "”.";
    parked.done(ok ? { behavior: "allow", updatedInput: parked.ask.input } : { behavior: "deny", message: "The user denied this (" + parked.ask.what.toLowerCase() + ")" + said + " Don't do it another way; if it's still needed, say so when you finish." });
  }

  export function outcome(msg: SDKResultMessage): { ok: boolean; text: string } {
    return { ok: msg.subtype === "success" && !msg.is_error, text: msg.subtype === "success" ? msg.result : msg.errors.join("; ") };
  }

  export async function main(dir: string): Promise<void> {
    const spec = JSON.parse(fs.readFileSync(path.join(dir, SPEC), "utf8")) as Spec;
    const start = JSON.parse(fs.readFileSync(path.join(dir, START), "utf8")) as Start;
    const file = path.join(dir, LOG);
    const log = fs.openSync(file, "a");
    // a holder killed mid-line left it unended: the next line starts anew
    const size = fs.fstatSync(log).size;
    if (size > 0 && fs.readFileSync(file).at(size - 1) !== 0x0a) {
      fs.writeSync(log, "\n");
    }
    const h: Held = { out: Wire.outbox(Hold.told(dir).at(-1)?.seq ?? 0), asks: new Map(), waits: new Map(), notes: new Map(), says: new Set(), inbox: ClaudeSub.inbox(), rules: start.rules, conn: null, emit: () => {} };
    h.emit = (ev) => {
      const told = Wire.push(h.out, ev, Date.now());
      fs.writeSync(log, JSON.stringify(told) + "\n");
      Wire.send(h.conn, { $: "ev", ...told });
    };
    const named = new Map<string, string>();
    let sdk = start.resume;
    let tasks = 0;

    fs.rmSync(start.sock, { force: true });
    const server = net.createServer((s) => {
      s.setEncoding("utf8");
      s.on("data", Wire.lines((msg) => Hold.got(h, msg, s)));
      s.on("error", () => {});
      s.on("close", () => {
        if (h.conn === s) {
          h.conn = null;
        }
      });
    });
    await new Promise<void>((ok) => server.listen(start.sock, ok));

    const pre: HookCallback = (input) => {
      if (input.hook_event_name !== "PreToolUse") {
        return Promise.resolve({});
      }
      const args = rec(input.tool_input) ? input.tool_input : {};
      const [tool, given] = input.tool_name === "Bash" ? ["shell", { command: args.command }] : [input.tool_name, args];
      const rule = Rules.match(h.rules, tool, given, spec.cwd);
      if (rule === null) {
        return Promise.resolve({});
      }
      named.set(input.tool_use_id, rule.what);
      return Promise.resolve({ hookSpecificOutput: { hookEventName: "PreToolUse" as const, permissionDecision: "ask" as const, permissionDecisionReason: rule.what } });
    };
    const post: HookCallback = (input) => {
      const note = input.hook_event_name === "PostToolUse" ? h.notes.get(input.tool_use_id) : undefined;
      if (input.hook_event_name !== "PostToolUse" || note === undefined) {
        return Promise.resolve({});
      }
      h.notes.delete(input.tool_use_id);
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
          if (h.asks.delete(toolUseID)) {
            h.emit({ k: "dropped", id: toolUseID });
            ok({ behavior: "deny", message: "Stopped." });
          }
        };
        h.asks.set(toolUseID, { ask, done: (r) => (signal.removeEventListener("abort", off), ok(r)) });
        signal.addEventListener("abort", off, { once: true });
        h.emit({ k: "ask", ...ask });
      });
    };

    h.inbox.put([start.prompt], []);
    let end: Ev = { k: "end", ok: false, text: "Claude Code ended before its turn did." };
    try {
      const sdk_mod = await ClaudeSub.sdk();
      const env = Object.fromEntries(Object.entries(ClaudeSub.bare_env()).filter(([k]) => k !== "DISABLE_AUTO_COMPACT"));
      const q = sdk_mod.query({ prompt: h.inbox.read(), options: {
        cwd                        : spec.cwd,
        model                      : spec.model === "" ? undefined : spec.model,
        pathToClaudeCodeExecutable : await ClaudeSub.bin_on_disk(),
        env                        : { ...env, ...ENV, CLAUDE_CONFIG_DIR: spec.claude, PATH: [path.join(dir, BIN), env.PATH].filter((p) => p !== undefined).join(path.delimiter) },
        systemPrompt               : { type: "preset", preset: "claude_code", append: spec.append },
        tools                      : { type: "preset", preset: "claude_code" },
        settingSources             : ["user", "project", "local"],
        permissionMode             : "default",
        disallowedTools            : DISALLOWED,
        settings                   : SETTINGS,
        mcpServers                 : { ki: Hold.tools(h, sdk_mod) },
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
          h.emit({ k: "began", sdk });
        }
        if (msg.type === "system" && msg.subtype === "background_tasks_changed") {
          tasks = msg.tasks.filter((t) => t.ambient !== true).length;
        }
        Hold.told_of(msg).forEach(h.emit);
        if (msg.type === "result") {
          end = { k: "end", ...Hold.outcome(msg) };
          if (h.inbox.empty() && tasks === 0 && h.asks.size === 0) {
            h.inbox.close();
          }
        }
      }
    } catch (err) {
      end = { k: "end", ok: false, text: err_why(err) };
    }
    h.emit(end);
    for (const at = Date.now(); h.out.kept.length > 0 && Date.now() - at < LINGER; ) {
      await Bun.sleep(200);
    }
    server.close();
    fs.rmSync(start.sock, { force: true });
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
      return [{ k: "turn", ...Hold.outcome(msg) }];
    }
    return [];
  }

}
