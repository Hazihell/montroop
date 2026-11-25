// Code
// ====
// The Claude Code driver, two ways. Native: one Claude Code session in the
// job's folder, with its own tools, settings and compaction, resumed by
// its session id, running until it has nothing left to do: no message
// waiting, no task in the background, no call parked. Given: one turn on
// the job's blocks, made as the server's own path makes it (ClaudeSub):
// no tools of its own but web search, nothing kept once it ends. Either
// way Kunumy's tools (Job.tools) are an MCP server in it, each call run by
// the holder (io.call), which gates them; every other call it makes passes
// the holder's gate first. A usage limit is waited out (Limit), then the
// turn it cut goes on. Both read the owner's own instructions for Claude
// Code (instructions).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CanUseTool, HookCallback, HookInput, McpSdkServerConfigWithInstance, Options, Query, SDKMessage, SDKRateLimitInfo, SDKResultMessage, SDKUserMessage, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { Agent, BUSY } from "./Agent.ts";
import { Anthropic } from "./Anthropic.ts";
import { AskAI } from "./AskAI.ts";
import { BIN } from "./Browser.ts";
import { ClaudeSub } from "./ClaudeSub.ts";
import type { Call, Driver, End, Io, Job } from "./Driver.ts";
import { err_why } from "./Err.ts";
import { get, list, rec, str } from "./Json.ts";
import { Limit } from "./Limit.ts";
import { Loop } from "./Loop.ts";
import type { Spec } from "./Machine.ts";
import * as Prompts from "./Prompts.ts";
import { HELD, MCP, Wire, type Ev } from "./Wire.ts";

const ENV = {
  CLAUDE_AGENT_SDK_CLIENT_APP              : "kunumy",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC : "1",
};

// it asks no one in it: the owner's answers come through the gate
const DISALLOWED = ["AskUserQuestion"];

// what a job that may not write is denied
const EDITS = ["Edit", "Write", "NotebookEdit"];

// claude.ai's connectors left out; a project's AGENTS.md loaded beside any
// CLAUDE.md (by default it's skipped when one is found further up, as the
// account's own often is)
const SETTINGS = {
  disableClaudeAiConnectors : true,
  pluginConfigs             : { "cc-plugin-agents-md@builtin": { options: { instructionFiles: "claude-md-and-agents-md" } } },
};

const HOUR = { type: "ephemeral", ttl: "1h" };

// what a brief told again after a compaction starts with
const AGAIN = "Your task, as you were first given it:\n\n";

// a failed turn's errors that say the service was busy (ClaudeSub.turn)
const BUSY_ERRORS = ["server_error", "overloaded"];

// what a turn's messages told of a usage limit: Claude Code's latest word
// on it, whether a request was refused for one, whether it runs on extra
// usage; cut: why the turn stopped after its tool calls (cut)
type Limits = { info: SDKRateLimitInfo | null; hit: boolean; over: boolean; cut: "over" | "steer" | null };

// the messages Claude Code reads (feed)
type Feed = { put: (content: object[]) => void; pause: () => void; busy: () => boolean; read: () => AsyncGenerator<SDKUserMessage> };

// how a turn ended: its end, a usage limit (with when it resets, if told),
// the messages that came in to go on it, or Claude Code gone
type Turn = { end: End } | { limit: number | null } | { steered: true } | { died: string };

export namespace Code {

  export const native: Driver = async (job, io) => {
    if (job.cwd === null) {
      throw new Error("Claude Code works in a folder, and this job names none.");
    }
    const sdk = await ClaudeSub.sdk();
    const dir = signed_in(job);
    instructions(dir);
    const c = job.context;
    const brief = c.kind === "native" ? c.brief : "";
    const first = c.kind === "native" && c.resume === "" ? c.first.filter((b) => b.text !== "") : [];
    const marked = first.findLastIndex((b) => b.mark);
    const env = Object.fromEntries(Object.entries(ClaudeSub.bare_env()).filter(([k]) => k !== "DISABLE_AUTO_COMPACT"));
    // the API refuses an hour's mark after Claude Code's own 5 minutes'
    // one, and a resumed session sends its first message again
    const ttl = c.kind === "native" && c.first.some((b) => b.mark) ? { CLAUDE_CODE_PROMPT_CACHE_TTL: "1h" } : {};
    const watch: Limits = { info: null, hit: false, over: false, cut: null };
    const limit = Limit.make(Loop.asked(job, "claude-sub"), Loop.limits(io), new AbortController().signal);
    const gates = gated(io);
    let id = c.kind === "native" ? c.resume : "";
    let tasks = 0;
    const asked = { id: "" };
    let end: End = { ok: false, text: "Claude Code ended before its turn did." };
    let opening = first;
    const box = feed(io.inbox, (text) => {
      const blocks = opening;
      opening = [];
      return marked_content([...blocks.map((b) => b.text), text], blocks.length === 0 ? -1 : marked);
    });

    const q = sdk.query({ prompt: box.read(), options: {
      cwd                        : job.cwd,
      model                      : job.model === "" ? undefined : job.model,
      effort                     : job.effort === "" ? undefined : job.effort as Options["effort"],
      pathToClaudeCodeExecutable : await ClaudeSub.bin_on_disk(),
      env                        : { ...env, ...ENV, ...ttl, CLAUDE_CONFIG_DIR: dir, PATH: [path.join(job.dir, BIN), env.PATH].filter((p) => p !== undefined).join(path.delimiter) },
      systemPrompt               : { type: "preset", preset: "claude_code", append: [job.system, job.own].filter((s) => s !== "").join("\n\n") },
      tools                      : { type: "preset", preset: "claude_code" },
      settingSources             : ["user", "project", "local"],
      permissionMode             : "default",
      allowedTools               : ["mcp__" + MCP],
      disallowedTools            : [...DISALLOWED, ...(job.write ? [] : EDITS)],
      settings                   : SETTINGS,
      mcpServers                 : { [MCP]: kunumy(io, job.tools) },
      resume                     : id === "" ? undefined : id,
      canUseTool                 : gates.can,
      hooks                      : {
        PreToolUse    : [{ hooks: [gates.pre], onFailure: "block" }],
        PostToolUse   : [{ hooks: [gates.post] }],
        PostToolBatch : [{ hooks: [() => Promise.resolve(cut(watch, false))] }],
        SessionStart  : [{ hooks: [(input) => Promise.resolve(again(input, brief))] }],
      },
    } });
    for await (const msg of q) {
      if (msg.type === "system" && msg.subtype === "init" && msg.session_id !== id) {
        id = msg.session_id;
        io.emit({ k: "began", sdk: id });
      }
      if (msg.type === "system" && msg.subtype === "background_tasks_changed") {
        tasks = msg.tasks.filter((t) => t.ambient !== true).length;
      }
      seen(watch, msg);
      told_of(msg).forEach(io.emit);
      used_of(msg, asked).forEach(io.emit);
      if (msg.type === "result") {
        end = outcome(msg);
        const until = limited(watch, end.ok);
        if (until !== undefined) {
          box.pause();
          limit.n += 1;
          void Limit.hit(limit, until, true, end.text).then(() => box.put(Anthropic.content([go_on()], [])));
          continue;
        }
        limit.n = 0;
        if (!io.inbox.pending() && !box.busy() && tasks === 0 && gates.parked() === 0) {
          io.inbox.close();
        }
      }
    }
    return end;
  };

  export const given: Driver = async (job, io) => {
    const c = job.context;
    if (c.kind !== "given") {
      throw new Error("Claude Code runs a given turn on given blocks.");
    }
    const sdk = await ClaudeSub.sdk();
    const bin = await ClaudeSub.bin_on_disk();
    const dir = signed_in(job);
    instructions(dir);
    const ask = Loop.asked(job, "claude-sub");
    const limit = Limit.make(ask, Loop.limits(io), new AbortController().signal);
    const base = ClaudeSub.options(ask, new AbortController(), sdk.BUILTIN_TOOL_NAMES, sdk.SYSTEM_PROMPT_DYNAMIC_BOUNDARY);
    // its own tools (web search, tool search): a turn that called no
    // other waits out a limit in a new Claude Code (ClaudeSub.run)
    const own = (base.tools ?? []) as string[];
    const signin = ClaudeSub.sign_in(ClaudeSub.account(ask));
    const watch: Limits = { info: null, hit: false, over: false, cut: null };
    const asked = { id: "" };
    const gates = gated(io);
    const options: Options = {
      ...base,
      env             : { ...base.env, CLAUDE_CONFIG_DIR: dir },
      cwd             : dir,
      pathToClaudeCodeExecutable: bin,
      settingSources  : ["user"],
      // the account folder is read for the owner's instructions only: hooks
      // its settings name don't run (the holder's own still do)
      settings        : { ...(typeof base.settings === "object" ? base.settings : {}), disableAllHooks: true },
      permissionMode  : "default",
      allowedTools    : [...own, "mcp__" + MCP],
      mcpServers      : { [MCP]: kunumy(io, job.tools) },
      canUseTool      : gates.can,
      hooks           : {
        PreToolUse    : [{ hooks: [gates.pre], onFailure: "block" }],
        PostToolUse   : [{ hooks: [gates.post] }],
        PostToolBatch : [{ hooks: [() => Promise.resolve(cut(watch, io.inbox.pending()))] }],
      },
    };
    const blocks = c.blocks.filter((b) => b.text !== "");
    let code: { q: Query; box: Feed } | null = null;
    let lead: string[] = [];
    // the messages taken in, for a new Claude Code's first message
    const steered = await Loop.taken(io);
    let acted = false;
    try {
      for (let tries = 0; ;) {
        if (code === null) {
          const box = feed(null, () => []);
          code = { q: sdk.query({ prompt: box.read(), options: { ...options, abortController: new AbortController() } }), box };
          box.put([...marked_content([...blocks.map((b) => b.text), ...steered], blocks.slice(0, -1).findLastIndex((b) => b.mark)), ...c.imgs.map(Anthropic.image)]);
        } else {
          const texts = await Loop.taken(io);
          steered.push(...texts);
          const said = [...lead, ...texts];
          code.box.put(Anthropic.content(said.length === 0 ? [labeled(Prompts.prompt("continue"))] : said, []));
        }
        const said = { v: false };
        const got = await turn(code.q, io, watch, asked, own, signin, said, (v) => (acted ||= v));
        if ("died" in got) {
          if (said.v || tries > 0) {
            return { ok: false, text: got.died };
          }
          tries += 1;
          code.q.close();
          code = null;
          continue;
        }
        if ("end" in got && (!got.end.ok || !io.inbox.pending())) {
          return got.end;
        }
        lead = [];
        if ("limit" in got) {
          lead = [go_on()];
          if (!acted) {
            code.q.close();
            code = null;
          }
          limit.n += 1;
          await Limit.hit(limit, got.limit, acted, "usage limit");
        }
      }
    } finally {
      code?.q.close();
    }
  };

  // the account's sign-in folder Claude Code runs with
  function signed_in(job: Job): string {
    if (job.account.kind !== "plan") {
      throw new Error("Claude Code runs on a plan's sign-in, not an API key.");
    }
    return job.account.dir;
  }

  // Claude Code reads its user memory, and the files it imports, from its
  // config folder (CLAUDE_CONFIG_DIR, the account's): a link there to the
  // owner's ~/.claude/CLAUDE.md, unless the folder has one of its own
  function instructions(dir: string): void {
    const own = path.join(os.homedir(), ".claude", "CLAUDE.md");
    const at = path.join(dir, "CLAUDE.md");
    if (fs.existsSync(own) && !exists(at)) {
      try {
        fs.symlinkSync(own, at);
      } catch {}
    }
  }

  // a file there, even a link to none
  function exists(file: string): boolean {
    try {
      fs.lstatSync(file);
      return true;
    } catch {
      return false;
    }
  }

  // after a compaction, the brief told again: what the compaction summed
  // up keeps nothing of a brief given once
  function again(input: HookInput, brief: string): SyncHookJSONOutput {
    return input.hook_event_name === "SessionStart" && input.source === "compact" && brief !== "" ? { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: AGAIN + brief } } : {};
  }

  // texts as a message's blocks, the one at mark (-1: none) ending an
  // hour's cache entry, as the server's own path marks the view's end
  function marked_content(texts: string[], mark: number): object[] {
    return Anthropic.content(texts, []).map((b, k) => (k === mark ? { ...b, cache_control: HOUR } : b));
  }

  // a word of the app's to the model (ClaudeSub.go_on)
  function labeled(text: string): string {
    return AskAI.labeled({ text, imgs: [], from: Prompts.sender("app") });
  }

  // the app's word that a limit's reset came (ClaudeSub.run)
  function go_on(): string {
    return labeled(Prompts.prompt("go-on"));
  }

  // the messages Claude Code reads, as they come: the driver's own (put),
  // and the holder's (from, each as first makes it a message) unless a
  // limit paused them, till the holder's inbox closes; a put of the
  // driver's goes on with them. busy: paused, or holding some
  function feed(from: Io["inbox"] | null, first: (text: string) => object[]): Feed {
    const mine: SDKUserMessage[] = [];
    const later: SDKUserMessage[] = [];
    let paused = false;
    let wake = () => {};
    const user = (content: object[]): SDKUserMessage => ({ type: "user", message: { role: "user", content: content as Exclude<SDKUserMessage["message"]["content"], string> }, parent_tool_use_id: null });
    async function* read(): AsyncGenerator<SDKUserMessage> {
      let next: Promise<string | null> | null = null;
      for (;;) {
        const own = mine.shift() ?? (paused ? undefined : later.shift());
        if (own !== undefined) {
          yield own;
          continue;
        }
        const came = new Promise<undefined>((ok) => (wake = () => ok(undefined)));
        if (from === null) {
          await came;
          continue;
        }
        next ??= from.next();
        const text = await Promise.race([next, came]);
        if (text === undefined) {
          continue;
        }
        next = null;
        if (text === null) {
          return;
        }
        (paused ? later : mine).push(user(first(text)));
      }
    }
    return {
      put   : (content) => {
        mine.push(user(content));
        paused = false;
        wake();
      },
      pause : () => void (paused = true),
      busy  : () => paused || later.length > 0,
      read,
    };
  }

  // the holder's gate on the calls Claude Code makes, but Kunumy's own
  // (io.call gates those): pre has one a rule names asked (canUseTool),
  // even one Claude Code would let run by itself, the rest as its own
  // settings say; post tells the model the owner's note to a call it
  // approved, with its result; parked: the calls waiting on the gate
  function gated(io: Io): { pre: HookCallback; post: HookCallback; can: CanUseTool; parked: () => number } {
    const notes = new Map<string, string>();
    let gating = 0;
    const pre: HookCallback = (input) => {
      const asks = input.hook_event_name === "PreToolUse" && !input.tool_name.startsWith(HELD) && io.parks(call_of(input.tool_name, rec(input.tool_input) ? input.tool_input : {}, input.tool_use_id));
      return Promise.resolve(asks ? { hookSpecificOutput: { hookEventName: "PreToolUse" as const, permissionDecision: "ask" as const } } : {});
    };
    const post: HookCallback = (input) => {
      const note = input.hook_event_name === "PostToolUse" ? notes.get(input.tool_use_id) : undefined;
      if (input.hook_event_name !== "PostToolUse" || note === undefined) {
        return Promise.resolve({});
      }
      notes.delete(input.tool_use_id);
      return Promise.resolve({ hookSpecificOutput: { hookEventName: "PostToolUse" as const, additionalContext: note } });
    };
    const can: CanUseTool = async (tool, input, { signal, toolUseID }) => {
      if (tool.startsWith(HELD)) {
        return { behavior: "allow", updatedInput: input };
      }
      gating += 1;
      try {
        const said = await io.gate(call_of(tool, input, toolUseID), signal);
        if (said.ok && said.note !== "") {
          notes.set(toolUseID, said.note);
        }
        return said.ok ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: said.note };
      } finally {
        gating -= 1;
      }
    };
    return { pre, post, can, parked: () => gating };
  }

  // Kunumy's tools as an MCP server of the job's own, listed as given:
  // their JSON schemas whole (the SDK's tool() would turn them into
  // others), each loaded up front unless deferred, so the request is the
  // one the server's own path sends (ClaudeSub.mcp, Tools.answer). Each
  // call is run by the holder, under the provider's tool use id
  function kunumy(io: Io, tools: Spec[]): McpSdkServerConfigWithInstance {
    const listed = tools.map((t) => ({ name: t.name, description: t.info, inputSchema: t.schema, _meta: { "anthropic/alwaysLoad": t.defer !== true } }));
    const answer = async (method: unknown, params: unknown): Promise<object> => {
      if (method === "initialize") {
        return { protocolVersion: str(get(params, "protocolVersion")) ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: MCP, version: "1" } };
      }
      if (method === "tools/list") {
        return { tools: listed };
      }
      if (method !== "tools/call") {
        return {};
      }
      const name = str(get(params, "name")) ?? "";
      const args = get(params, "arguments");
      const input = rec(args) ? args : {};
      const id = str(get(get(params, "_meta"), "claudecode/toolUseId")) ?? crypto.randomUUID();
      const out = !tools.some((t) => t.name === name) ? { text: "No tool " + name + ".", fail: true } : await io.call({ id, tool: name, args: input, native: HELD + name, input }).catch((err: unknown) => ({ text: err_why(err), fail: true, imgs: [] }));
      const imgs = (out.imgs ?? []).map((img) => ({ type: "image", data: img.data, mimeType: img.type }));
      return { content: [{ type: "text", text: out.text || "(no output)" }, ...imgs], isError: out.fail };
    };
    type Link = { start: () => Promise<void>; send: (msg: object) => Promise<void>; onmessage?: (msg: Record<string, unknown>) => void };
    const instance = {
      connect: async (link: Link) => {
        link.onmessage = (msg) => {
          if (msg.id === undefined) {
            return;
          }
          void answer(msg.method, msg.params).then((result) => link.send({ jsonrpc: "2.0", id: msg.id, result }));
        };
        await link.start();
      },
    };
    return { type: "sdk", name: MCP, instance: instance as unknown as McpSdkServerConfigWithInstance["instance"] };
  }

  // a call as the rules name it: Bash is shell, with its command
  function call_of(tool: string, input: Record<string, unknown>, id: string): Call {
    return { id, tool: tool === "Bash" ? "shell" : tool, args: tool === "Bash" ? { command: input.command } : input, native: tool, input };
  }

  function outcome(msg: SDKResultMessage): End {
    return { ok: msg.subtype === "success" && !msg.is_error, text: msg.subtype === "success" ? msg.result : msg.errors.join("; ") };
  }

  // a message's word on a usage limit taken in (ClaudeSub.turn)
  function seen(l: Limits, msg: SDKMessage): void {
    if (msg.type === "rate_limit_event") {
      l.info = msg.rate_limit_info;
      l.over ||= l.info.isUsingOverage === true;
    }
    l.hit ||= msg.type === "assistant" && msg.error === "rate_limit";
  }

  // at a turn's end: whether a usage limit cut it, and when it resets
  // (null: not told; undefined: no limit cut it); the turn's word on it
  // dropped for the next
  function limited(l: Limits, ok: boolean): number | null | undefined {
    const cut = ClaudeSub.limit_ended(ok && l.cut !== "over", l.hit, l.over, l.info);
    const until = l.info === null ? null : ClaudeSub.reset(l.info);
    Object.assign(l, { info: null, hit: false, over: false, cut: null });
    return cut ? until : undefined;
  }

  // after a batch of tool calls, the turn stops with their results in:
  // under extra usage, which is waited out as a limit, or for the
  // messages that came in (steer), which go on it in a message of their
  // own (ClaudeSub.after_tools)
  function cut(l: Limits, steer: boolean): SyncHookJSONOutput {
    l.cut = l.over ? "over" : steer ? "steer" : null;
    return l.cut === null ? {} : { continue: false, stopReason: l.cut === "over" ? "usage limit: extra usage" : "new messages came in; they follow" };
  }

  // one given turn's messages till its result (ClaudeSub.turn); signin:
  // what an expired sign-in ends it with; said: it told something; acted:
  // it called a tool not its own; asked: as used_of's
  async function turn(q: Query, io: Io, watch: Limits, asked: { id: string }, own: string[], signin: string, said: { v: boolean }, acted: (v: boolean) => void): Promise<Turn> {
    let err: string | undefined;
    for (;;) {
      let r: IteratorResult<SDKMessage>;
      try {
        r = await q.next();
      } catch (e) {
        return { died: e instanceof Error ? e.message : String(e) };
      }
      if (r.done) {
        return { died: "Claude Code ended early" };
      }
      const msg = r.value;
      seen(watch, msg);
      const evs = told_of(msg);
      said.v ||= evs.length > 0;
      evs.forEach(io.emit);
      used_of(msg, asked).forEach(io.emit);
      if (msg.type === "assistant" && msg.error === undefined) {
        acted(msg.message.content.some((b) => b.type === "tool_use" && !own.includes(b.name)));
      }
      if (msg.type === "assistant" && msg.error === "authentication_failed") {
        await settle(q);
        return { end: { ok: false, text: signin } };
      }
      err = msg.type === "assistant" ? msg.error ?? err : err;
      if (msg.type !== "result") {
        continue;
      }
      const steered = watch.cut === "steer";
      const end = outcome(msg);
      const limit = limited(watch, end.ok);
      if (limit !== undefined) {
        return { limit };
      }
      if (end.ok && steered) {
        return { steered: true };
      }
      if (!end.ok) {
        const why = (err ? err + ": " : "") + (end.text || msg.subtype);
        return { end: { ok: false, text: BUSY_ERRORS.includes(err ?? "") ? BUSY : Agent.said(why) } };
      }
      return { end: { ok: true, text: end.text.trim() } };
    }
  }

  // the rest of a turn read, its result the last
  async function settle(q: Query): Promise<void> {
    for (;;) {
      const r = await q.next();
      if (r.done || r.value.type === "result") {
        return;
      }
    }
  }

  // a tool's input or result as text
  function shown(x: unknown): string {
    if (typeof x === "string") {
      return x;
    }
    const blocks = list(x).filter((b) => get(b, "type") === "text").map((b) => str(get(b, "text")) ?? "");
    return blocks.length > 0 ? blocks.join("\n") : JSON.stringify(x);
  }

  // what a message of Claude Code's tells the server (only the session's
  // own, not its subagents')
  function told_of(msg: SDKMessage): Ev[] {
    if (msg.type === "assistant" && msg.parent_tool_use_id === null) {
      return msg.message.content.flatMap((b): Ev[] =>
        b.type === "text" && b.text.trim() !== "" ? [{ k: "text", text: b.text }] :
        b.type === "tool_use" ? [{ k: "tool", id: b.id, name: b.name, input: Wire.clip(shown(b.input)) }] : []);
    }
    if (msg.type === "user" && msg.parent_tool_use_id === null && Array.isArray(msg.message.content)) {
      return msg.message.content.flatMap((b): Ev[] => (b.type === "tool_result" ? [{ k: "result", id: b.tool_use_id, text: Wire.clip(shown(b.content ?? "")), error: b.is_error === true }] : []));
    }
    if (msg.type === "system" && msg.subtype === "compact_boundary") {
      return [{ k: "compacted" }];
    }
    if (msg.type === "result") {
      return [{ k: "turn", ...outcome(msg) }];
    }
    return [];
  }

  // the tokens of a request of the run's own, once (Claude Code tells each
  // block of an answer as a message of its own, all with its usage; one it
  // makes up itself, as for a usage limit, has none); asked: the latest
  // request's message id
  function used_of(msg: SDKMessage, asked: { id: string }): Ev[] {
    if (msg.type !== "assistant" || msg.parent_tool_use_id !== null || msg.message.id === asked.id) {
      return [];
    }
    asked.id = msg.message.id;
    const used = Anthropic.used(msg.message.usage);
    const tokens = used === null ? 0 : used.read + used.write + used.input;
    return tokens === 0 ? [] : [{ k: "used", tokens }];
  }

}
