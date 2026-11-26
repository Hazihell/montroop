// Codex
// =====
// The Codex driver: one Codex thread (`codex app-server`, JSON-RPC on its
// stdio) in the job's folder, with Codex's own tools, sandbox, config,
// instructions and compaction, its home the account's (CODEX_HOME), resumed
// by the thread's id, running until it has nothing left to do: no message
// waiting, its turn over. Montroop adds to it only its tools, as Codex's
// dynamic tools in a namespace of their own, each call run by the holder
// (io.call); the job's prompt and first message; and the owner's gate.
// Codex asks before every command, file change and MCP call that isn't
// read-only (the approval policy "untrusted"), and each request passes the
// holder's gate, which answers at once when no rule names the call, and a
// question it asks the user waits for the owner's answer (io.ask). The
// ChatGPT sign-in stays Montroop's own (ChatGPT): Codex is handed its access
// token and asks for a fresh one when the backend refuses it, so it never
// holds or refreshes the refresh token. A usage limit is waited out (Limit),
// then the run goes on with a new turn.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Out } from "./Agent.ts";
import { AskAI } from "./AskAI.ts";
import { BIN } from "./Browser.ts";
import { ChatGPT } from "./ChatGPT.ts";
import { ClaudeSub } from "./ClaudeSub.ts";
import * as config from "./Config.ts";
import type { Call, Driver, Gated, Io, Job } from "./Driver.ts";
import { err_why } from "./Err.ts";
import { get, list, rec, str } from "./Json.ts";
import { Limit } from "./Limit.ts";
import { Loop } from "./Loop.ts";
import type { Spec } from "./Machine.ts";
import * as Prompts from "./Prompts.ts";
import { QUESTION } from "./Question.ts";
import { HELD, MCP, Wire, type Ev } from "./Wire.ts";

const NO_BIN = "Codex isn't here: install it (npm install -g @openai/codex), or set codex in config.json to its path.";

// asks before anything that isn't read-only; its sandbox keeps a command's
// writes in the workspace and off the network, unless the command asks to
// run outside it, which is asked too
const POLICY = { approvalPolicy: "untrusted", sandbox: "workspace-write" };

// its question tool, which Codex offers only while planning unless this
// feature is on, so it asks the owner (io.ask) in its default mode too
const FEATURES = ["default_mode_request_user_input"];

// what the model is told of a file change a job that may not write makes
const NO_WRITE = "This job may not write: its edits are denied.";

// the server requests no one here answers, refused
const UNANSWERED = "No one here answers this: decide yourself, or say what you need when you finish.";

// a JSON-RPC message, either way
type Msg = { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { code?: number; message?: string } };

// the app-server: a request and its result, a notification, and why it
// ended once it has
type Server = { ask: (method: string, params: object) => Promise<unknown>; tell: (method: string) => void; gone: Promise<string> };

// the app-server's process, as its connection uses it
type Proc = { stdin: Bun.FileSink; stdout: ReadableStream<Uint8Array<ArrayBuffer>>; exited: Promise<number>; signalCode: NodeJS.Signals | number | null };

// the ChatGPT sign-in's access token last handed to Codex
type Signin = { given: string };

// what a request of Codex's is answered with: the job and the holder's Io,
// the items of its turns as they started, which an approval names, its
// sign-in, and note, what the owner said with an answer, for the model once
// the item it's for is done (null: none)
type Answering = { job: Job; io: Io; items: Map<string, unknown>; signin: Signin; note: (item: string | null, text: string) => void };

// how a turn ended: done (its last reply), cut by a usage limit (when it
// resets, if told), or failed (why)
type Turn = { done: string } | { limit: number | null } | { failed: string };

export namespace Codex {

  export const native: Driver = async (job, io) => {
    const c = job.context;
    if (job.cwd === null || c.kind !== "native") {
      throw new Error("Codex keeps its own thread in a folder, and this job names none.");
    }
    const home = home_of(job);
    instructions(home);
    const proc = Bun.spawn([bin(), "app-server", ...FEATURES.flatMap((f) => ["--enable", f])], {
      cwd    : job.cwd,
      env    : env(job, home),
      stdin  : "pipe",
      stdout : "pipe",
      stderr : fs.openSync(path.join(job.dir, "codex.log"), "a"),
    });
    const signin: Signin = { given: "" };
    // the items of its turns as they started, its native subagents' too,
    // which an approval names
    const items = new Map<string, unknown>();
    const limit = Limit.make(Loop.asked(job, "openai-sub"), Loop.limits(io), new AbortController().signal);
    // the latest word on its usage limits
    let limits: unknown = null;
    let thread = c.resume;
    // the turn at work: its id ("": not told yet), its latest reply, the
    // messages for it that came before its id
    let turn = null as { id: string; last: string; end: (t: Turn) => void; early: string[] } | null;
    // the messages taken in for the next turn, the steers on their way
    const queue: string[] = [];
    const steering = new Set<Promise<void>>();
    // what the owner said with an answer, for the model once its call is
    // done (a call of one of Codex's own subagents told to the main thread)
    const notes = new Map<string, string>();
    const server = connect(proc, (method, params) => {
      const item = get(params, "item");
      const id = str(get(item, "id")) ?? "";
      if (method === "account/rateLimits/updated") {
        limits = get(params, "rateLimits");
      } else if (method === "item/started") {
        items.set(id, item);
      } else if (method === "item/completed") {
        items.delete(id);
        const note = notes.get(id);
        if (note !== undefined) {
          notes.delete(id);
          steer(labeled(note));
        }
      }
      if (get(params, "threadId") !== thread) {
        return;
      }
      if (method === "item/started") {
        told_started(item).forEach(io.emit);
      } else if (method === "item/completed") {
        if (turn !== null && get(item, "type") === "agentMessage") {
          turn.last = str(get(item, "text")) ?? turn.last;
        }
        told_done(item).forEach(io.emit);
        if (get(item, "type") === "contextCompaction") {
          io.emit({ k: "compacted" });
          if (c.brief !== "") {
            steer("Your task, as you were first given it:\n\n" + c.brief);
          }
        }
      } else if (method === "thread/tokenUsage/updated") {
        const tokens = Number(get(get(get(params, "tokenUsage"), "last"), "inputTokens")) || 0;
        if (tokens > 0) {
          io.emit({ k: "used", tokens });
        }
      } else if (method === "turn/completed" && turn !== null) {
        const t = turn;
        turn = null;
        t.end(ended(get(params, "turn"), t.last, limits));
      }
    }, (method, params, stop) => answer(method, params, stop, { job, io, items, signin, note: (item, note) => (item === null ? steer(labeled(note)) : notes.set(item, note)) }));

    // a message into the turn at work, after its current tool call (one
    // that comes before the turn's id, once it's told); one that comes
    // between turns, or as one ends, goes into the next
    function steer(text: string): void {
      const t = turn;
      if (t === null) {
        queue.push(text);
      } else if (t.id === "") {
        t.early.push(text);
      } else {
        const sent: Promise<void> = server.ask("turn/steer", { threadId: thread, expectedTurnId: t.id, input: [input(text)] }).then(() => {}, () => void queue.push(text)).finally(() => steering.delete(sent));
        steering.add(sent);
      }
    }

    try {
      const started = await Promise.race([setup(server, job, thread, signin), server.gone.then((why) => new Error(why))]);
      if (started instanceof Error) {
        return { ok: false, text: started.message };
      }
      if (thread === "") {
        thread = started;
        io.emit({ k: "began", sdk: thread });
      }
      const text = await io.inbox.next();
      if (text === null) {
        return { ok: true, text: "" };
      }
      // the messages for the next turn
      let texts = [...(c.resume === "" ? c.first.map((b) => b.text) : []), text].filter((t) => t !== "");
      // the messages that come in go to the turn at work, till the inbox
      // closes, those it holds then taken first
      const reading = (async () => {
        for (let t = await io.inbox.next(); t !== null; t = await io.inbox.next()) {
          steer(t);
        }
      })();
      for (;;) {
        let end: (t: Turn) => void = () => {};
        const done = new Promise<Turn>((ok) => (end = ok));
        const at = { id: "", last: "", end, early: [] as string[] };
        turn = at;
        const opened = await Promise.race([
          server.ask("turn/start", { threadId: thread, input: texts.map(input), ...(job.effort === "" ? {} : { effort: job.effort }) }).then((r) => str(get(get(r, "turn"), "id")) ?? "", (err: unknown) => new Error(err_why(err))),
          server.gone.then((why) => new Error(why)),
        ]);
        if (opened instanceof Error) {
          turn = null;
          io.emit({ k: "turn", ok: false, text: opened.message });
          return { ok: false, text: opened.message };
        }
        at.id = opened;
        at.early.splice(0).forEach(steer);
        const got = await Promise.race([done, server.gone.then((why): Turn => ({ failed: why }))]);
        await Promise.all([...steering]);
        if ("failed" in got) {
          io.emit({ k: "turn", ok: false, text: got.failed });
          return { ok: false, text: got.failed };
        }
        if ("limit" in got) {
          limit.n += 1;
          // Codex reads the plan's usage from the backend, its reset with it
          const read = await server.ask("account/rateLimits/read", {}).catch(() => null);
          await Limit.hit(limit, got.limit ?? reset(get(read, "rateLimits")), true, "usage limit");
          texts = [labeled(Prompts.prompt("go-on")), ...queue.splice(0)];
          continue;
        }
        limit.n = 0;
        io.emit({ k: "turn", ok: true, text: got.done });
        if (queue.length === 0) {
          io.inbox.close();
          await reading;
        }
        if (queue.length === 0) {
          return { ok: true, text: got.done };
        }
        texts = queue.splice(0);
      }
    } finally {
      proc.kill();
    }
  };

  // a word of the app's to the model
  function labeled(text: string): string {
    return AskAI.labeled({ text, imgs: [], from: Prompts.sender("app") });
  }

  // the codex it runs: config.json's, the one Montroop carries, or the one
  // on PATH
  function bin(): string {
    const found = config.CODEX || carried() || Bun.which("codex");
    if (found === null || found === "") {
      throw new Error(NO_BIN);
    }
    return found;
  }

  // the codex installed with Montroop's packages: its package for this
  // platform, which @openai/codex brings
  function carried(): string | null {
    try {
      const codex = path.dirname(Bun.fileURLToPath(import.meta.resolve("@openai/codex/package.json")));
      const pkg = path.dirname(Bun.resolveSync("@openai/codex-" + ClaudeSub.platform().replace(/-musl$/, "") + "/package.json", codex));
      const vendor = path.join(pkg, "vendor");
      const exe = fs.readdirSync(vendor).map((triple) => path.join(vendor, triple, "bin", process.platform === "win32" ? "codex.exe" : "codex")).find((f) => fs.existsSync(f));
      return exe ?? null;
    } catch {
      return null;
    }
  }

  // the account's Codex home: a plan's own folder (its sign-in stays
  // Montroop's), an API key's not served here
  function home_of(job: Job): string {
    if (job.account.kind !== "plan") {
      throw new Error("Codex runs on a ChatGPT plan's sign-in, not an API key.");
    }
    fs.mkdirSync(job.account.dir, { recursive: true, mode: 0o700 });
    return job.account.dir;
  }

  // Codex reads its user instructions from its home (CODEX_HOME, the
  // account's): a link there to the owner's ~/.codex/AGENTS.md, unless the
  // home has one of its own
  function instructions(home: string): void {
    const own = path.join(os.homedir(), ".codex", "AGENTS.md");
    const at = path.join(home, "AGENTS.md");
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

  // its variables: the holder's, without another OpenAI credential, in its
  // home, trusting the CA the holder's own requests trust, with the job's
  // browser on PATH
  function env(job: Job, home: string): Record<string, string | undefined> {
    const own = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(OPENAI_|CODEX_)/.test(k)));
    const ca = process.env.CODEX_CA_CERTIFICATE ?? process.env.NODE_EXTRA_CA_CERTS;
    return { ...own, CODEX_HOME: home, ...(ca === undefined ? {} : { CODEX_CA_CERTIFICATE: ca }), PATH: [path.join(job.dir, BIN), own.PATH].filter((p) => p !== undefined).join(path.delimiter) };
  }

  // the app-server on proc's stdio: on, a notification; serve, a request
  // of its own, whose result (or error) goes back, its wait dropped (stop)
  // once Codex resolves it itself, as when it interrupts one of its own
  // subagents
  function connect(proc: Proc, on: (method: string, params: unknown) => void, serve: (method: string, params: unknown, stop: AbortSignal) => Promise<unknown>): Server {
    let n = 0;
    const waits = new Map<number, { ok: (x: unknown) => void; no: (err: Error) => void }>();
    const serving = new Map<string, AbortController>();
    const write = (msg: Msg) => {
      try {
        void proc.stdin.write(JSON.stringify(msg) + "\n");
        void proc.stdin.flush();
      } catch {}
    };
    const gone = (async () => {
      let rest = "";
      for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
        const lines = (rest + chunk).split("\n");
        rest = lines.pop() ?? "";
        for (const line of lines) {
          let msg: Msg;
          try {
            msg = JSON.parse(line) as Msg;
          } catch {
            continue;
          }
          if (msg.method === undefined && typeof msg.id === "number") {
            const w = waits.get(msg.id);
            waits.delete(msg.id);
            if (msg.error !== undefined) {
              w?.no(new Error(msg.error.message ?? "Codex refused the request"));
            } else {
              w?.ok(msg.result);
            }
          } else if (msg.method !== undefined && msg.id !== undefined) {
            const id = msg.id;
            const stop = new AbortController();
            serving.set(String(id), stop);
            void serve(msg.method, msg.params, stop.signal).then((result) => write({ id, result }), (err: unknown) => write({ id, error: { code: -32603, message: err_why(err) } })).finally(() => serving.delete(String(id)));
          } else if (msg.method === "serverRequest/resolved") {
            serving.get(String(get(msg.params, "requestId")))?.abort();
          } else if (msg.method !== undefined) {
            on(msg.method, msg.params);
          }
        }
      }
      const code = await proc.exited;
      const why = "Codex process " + (proc.signalCode === null ? "exited with code " + code : "terminated by signal " + String(proc.signalCode));
      waits.forEach((w) => w.no(new Error(why)));
      waits.clear();
      return why;
    })();
    return {
      ask  : (method, params) => new Promise((ok, no) => {
        n += 1;
        waits.set(n, { ok, no });
        write({ id: n, method, params });
      }),
      tell : (method) => write({ method }),
      gone,
    };
  }

  // the connection made, signed in, and the thread started or resumed: its id
  async function setup(server: Server, job: Job, resume: string, signin: Signin): Promise<string> {
    await server.ask("initialize", { clientInfo: { name: "montroop", title: "Montroop", version: "1" }, capabilities: { experimentalApi: true } });
    server.tell("initialized");
    await server.ask("account/login/start", { type: "chatgptAuthTokens", ...await tokens(signin, false) });
    const shared = { cwd: job.cwd, model: job.model === "" ? null : job.model, ...POLICY, ...(job.speed === "" || job.speed === "slow" ? {} : { serviceTier: job.speed }) };
    if (resume !== "") {
      await server.ask("thread/resume", { threadId: resume, ...shared, excludeTurns: true });
      return resume;
    }
    const developer = [job.system, job.own].filter((s) => s !== "").join("\n\n");
    const r = await server.ask("thread/start", { ...shared, ...(developer === "" ? {} : { developerInstructions: developer }), dynamicTools: job.tools.length === 0 ? [] : [{ type: "namespace", name: MCP, description: "Montroop's tools.", tools: job.tools.map(tool) }] });
    const id = str(get(get(r, "thread"), "id"));
    if (id === undefined) {
      throw new Error("Codex started no thread.");
    }
    return id;
  }

  // the ChatGPT sign-in's access token as Codex takes it, and its
  // account; refused: the backend refused the one handed last, so one
  // newer is taken (Montroop's own refreshed, unless it was already)
  async function tokens(signin: Signin, refused: boolean): Promise<{ accessToken: string; chatgptAccountId: string; chatgptPlanType: string | null }> {
    const access = await ChatGPT.token(refused ? signin.given : undefined);
    signin.given = access;
    const auth = ChatGPT.claims(access)["https://api.openai.com/auth"];
    return { accessToken: access, chatgptAccountId: auth?.chatgpt_account_id ?? ChatGPT.load()?.tokens.account_id ?? "", chatgptPlanType: auth?.chatgpt_plan_type ?? null };
  }

  function tool(t: Spec): object {
    return { type: "function", name: t.name, description: t.info, inputSchema: t.schema, ...(t.defer === true ? { deferLoading: true } : {}) };
  }

  function input(text: string): object {
    return { type: "text", text, text_elements: [] };
  }

  // a request of Codex's: an approval through the holder's gate, its card
  // dropped once Codex no longer waits for it (stop), one of Montroop's
  // tools run by the holder, a fresh access token; what no one here can
  // answer, refused
  async function answer(method: string, params: unknown, stop: AbortSignal, { job, io, items, signin, note }: Answering): Promise<unknown> {
    const item = str(get(params, "itemId")) ?? null;
    const gated = async (call: Call): Promise<boolean> => {
      const said: Gated = await io.gate(call, stop);
      if (said.note !== "" && !stop.aborted) {
        note(item, said.note);
      }
      return said.ok;
    };
    const id = str(get(params, "approvalId")) ?? item ?? crypto.randomUUID();
    switch (method) {
      case "item/commandExecution/requestApproval": {
        const command = script(str(get(params, "command")) ?? "");
        const input = { command, cwd: str(get(params, "cwd")) ?? "", ...(str(get(params, "reason")) === undefined ? {} : { reason: str(get(params, "reason")) }) };
        return { decision: await gated({ id, tool: "shell", args: { command }, native: "exec_command", input }) ? "accept" : "decline" };
      }
      case "item/fileChange/requestApproval": {
        const changes = list(get(items.get(item ?? ""), "changes"));
        const paths = changes.map((ch) => str(get(ch, "path")) ?? "");
        const diffs = changes.map((ch) => str(get(ch, "diff")) ?? "");
        if (!job.write) {
          note(item, NO_WRITE);
          return { decision: "decline" };
        }
        const adds = changes.length > 0 && changes.every((ch) => get(get(ch, "kind"), "type") === "add");
        const args = { file_path: paths, [adds ? "content" : "diff"]: diffs };
        return { decision: await gated({ id, tool: adds ? "write" : "edit", args, native: "apply_patch", input: args }) ? "accept" : "decline" };
      }
      case "item/permissions/requestApproval": {
        const asked = rec(get(params, "permissions")) ? get(params, "permissions") as Record<string, unknown> : {};
        const args = { ...asked, reason: str(get(params, "reason")) ?? "" };
        const ok = await gated({ id, tool: "permissions", args, native: "request_permissions", input: args });
        return { permissions: ok ? Object.fromEntries(Object.entries(asked).filter(([, v]) => v !== null)) : {}, scope: "turn" };
      }
      case "mcpServer/elicitation/request": {
        const meta = get(params, "_meta");
        if (get(meta, "codex_approval_kind") !== "mcp_tool_call") {
          return { action: "decline", content: null, _meta: null };
        }
        const name = (str(get(params, "serverName")) ?? "") + "__" + (str(get(meta, "tool_name")) ?? "");
        const args = rec(get(meta, "tool_params")) ? get(meta, "tool_params") as Record<string, unknown> : {};
        return await gated({ id, tool: name, args, native: "mcp__" + name, input: args }) ? { action: "accept", content: {}, _meta: null } : { action: "decline", content: null, _meta: null };
      }
      case "item/tool/call": {
        const name = str(get(params, "tool")) ?? "";
        const args = rec(get(params, "arguments")) ? get(params, "arguments") as Record<string, unknown> : {};
        const out: Out = !job.tools.some((t) => t.name === name) ? { text: "No tool " + name + ".", fail: true } : await io.call({ id: str(get(params, "callId")) ?? id, tool: name, args, native: HELD + name, input: args }).catch((err: unknown) => ({ text: err_why(err), fail: true }));
        const imgs = (out.imgs ?? []).map((img) => ({ type: "inputImage", imageUrl: "data:" + img.type + ";base64," + img.data }));
        return { contentItems: [{ type: "inputText", text: out.text || "(no output)" }, ...imgs], success: !out.fail };
      }
      case "account/chatgptAuthTokens/refresh":
        return await tokens(signin, true);
      case "item/tool/requestUserInput": {
        const asked = list(get(params, "questions"));
        const questions = asked.map((q) => ({ question: str(get(q, "question")) ?? "", header: str(get(q, "header")) ?? "", options: list(get(q, "options")).map((o) => ({ label: str(get(o, "label")) ?? "", description: str(get(o, "description")) ?? "" })), multiSelect: false }));
        const input = { questions };
        const said = await io.ask({ id, tool: QUESTION, args: input, native: QUESTION, input }, stop);
        if (!said.ok) {
          if (!stop.aborted) {
            note(null, said.note);
          }
          return { answers: {} };
        }
        return { answers: Object.fromEntries(asked.map((q, k) => [str(get(q, "id")) ?? "", { answers: picks(said.answers?.[questions[k].question] ?? "", questions[k].options.map((o) => o.label)) }])) };
      }
      default:
        throw new Error(UNANSWERED);
    }
  }

  // an answer as Codex takes it: the choices picked, or what the owner typed
  // (an answer joins several picks with ", ", Question.answer)
  function picks(answer: string, labels: string[]): string[] {
    const parts = answer.split(", ");
    return answer === "" ? [] : parts.every((p) => labels.includes(p)) ? parts : [answer];
  }

  // how a turn ended, as turn/completed tells it (last: its last reply;
  // limits: the latest word on the usage limits, which a usage limit's
  // reset is read from)
  function ended(turn: unknown, last: string, limits: unknown): Turn {
    const status = get(turn, "status");
    if (status === "completed") {
      return { done: last.trim() };
    }
    const error = get(turn, "error");
    if (get(error, "codexErrorInfo") === "usageLimitExceeded") {
      return { limit: reset(limits) };
    }
    return { failed: status === "interrupted" ? "Codex's turn was interrupted." : str(get(error, "message")) ?? "Codex's turn failed." };
  }

  // when the usage limit that was reached resets (ms since 1970), as its
  // window tells it; null: not told
  function reset(limits: unknown): number | null {
    const full = [get(limits, "primary"), get(limits, "secondary")].filter((w) => Number(get(w, "usedPercent")) >= 100).map((w) => Number(get(w, "resetsAt")) * 1e3).filter((at) => at > 0);
    return full.length > 0 ? Math.max(...full) : null;
  }

  // what an item that started tells the server: a tool call
  function told_started(item: unknown): Ev[] {
    const id = str(get(item, "id")) ?? "";
    switch (get(item, "type")) {
      case "commandExecution":
        return [{ k: "tool", id, name: "exec_command", input: Wire.clip(JSON.stringify({ command: script(str(get(item, "command")) ?? "") })) }];
      case "fileChange":
        return [{ k: "tool", id, name: "apply_patch", input: Wire.clip(list(get(item, "changes")).map((ch) => str(get(ch, "path")) ?? "").join("\n")) }];
      case "dynamicToolCall":
        return [{ k: "tool", id, name: HELD + (str(get(item, "tool")) ?? ""), input: Wire.clip(JSON.stringify(get(item, "arguments") ?? {})) }];
      case "mcpToolCall":
        return [{ k: "tool", id, name: "mcp__" + (str(get(item, "server")) ?? "") + "__" + (str(get(item, "tool")) ?? ""), input: Wire.clip(JSON.stringify(get(item, "arguments") ?? {})) }];
      case "webSearch":
        return [{ k: "tool", id, name: "web_search", input: Wire.clip(str(get(item, "query")) ?? "") }];
      default:
        return [];
    }
  }

  // what an item that's done tells the server: a reply, or a tool call's
  // result
  function told_done(item: unknown): Ev[] {
    const id = str(get(item, "id")) ?? "";
    const status = get(item, "status");
    const failed = status === "failed" || status === "declined";
    switch (get(item, "type")) {
      case "agentMessage": {
        const text = str(get(item, "text")) ?? "";
        return text.trim() === "" ? [] : [{ k: "text", text }];
      }
      case "commandExecution":
        return [{ k: "result", id, text: Wire.clip(str(get(item, "aggregatedOutput")) ?? (status === "declined" ? "Declined." : "")), error: failed || (Number(get(item, "exitCode")) || 0) !== 0 }];
      case "fileChange":
        return [{ k: "result", id, text: status === "declined" ? "Declined." : status === "failed" ? "Failed." : "Done.", error: failed }];
      case "dynamicToolCall":
        return [{ k: "result", id, text: Wire.clip(list(get(item, "contentItems")).map((x) => str(get(x, "text")) ?? "").join("\n")), error: get(item, "success") === false }];
      case "mcpToolCall":
        return [{ k: "result", id, text: Wire.clip(JSON.stringify(get(item, "result") ?? get(item, "error") ?? "")), error: failed }];
      case "webSearch":
        return [{ k: "result", id, text: "", error: false }];
      default:
        return [];
    }
  }

  // a command as Codex shows it (its argv, each word quoted as a POSIX
  // shell reads it) as the model wrote it: a shell's -c script, or the
  // command itself
  function script(shown: string): string {
    const words = split(shown);
    return words.length === 3 && /(^|\/)(ba|z|da)?sh$/.test(words[0]) && /^-l?c$/.test(words[1]) ? words[2] : shown;
  }

  // the words a POSIX shell reads in a line: quotes and backslashes taken
  function split(line: string): string[] {
    const words: string[] = [];
    let word: string | null = null;
    let quote: "'" | "\"" | null = null;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quote === "'") {
        if (ch === "'") {
          quote = null;
        } else {
          word += ch;
        }
      } else if (quote === "\"") {
        if (ch === "\"") {
          quote = null;
        } else if (ch === "\\" && "$`\"\\\n".includes(line[i + 1] ?? "")) {
          word += line[++i];
        } else {
          word += ch;
        }
      } else if (ch === "'" || ch === "\"") {
        quote = ch;
        word ??= "";
      } else if (ch === "\\") {
        word = (word ?? "") + (line[++i] ?? "");
      } else if (/\s/.test(ch)) {
        if (word !== null) {
          words.push(word);
        }
        word = null;
      } else {
        word = (word ?? "") + ch;
      }
    }
    if (word !== null) {
      words.push(word);
    }
    return words;
  }

}

