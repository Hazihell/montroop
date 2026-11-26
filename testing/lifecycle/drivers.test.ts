import { DIR } from "../home.ts";
import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AskAI, type Ask, type Vendor } from "../../AskAI.ts";
import * as config from "../../Config.ts";
import type { Job } from "../../Driver.ts";
import { Hold, HOLDS } from "../../Hold.ts";
import type { Spec } from "../../Machine.ts";
import { Rules, type Rule } from "../../Rules.ts";
import { Setup } from "../../Setup.ts";
import { Tools } from "../../Tools.ts";
import type { Ev, Told } from "../../Wire.ts";
import { connect, fake, hold, repo, signed, tag, tell, until } from "../rig.ts";

signed(DIR);
config.config_reload();

// the job of each driver, on a data folder's accounts: a given one's
// blocks end with the text the fake matches
const DRIVERS: Record<string, (home: string, text: string) => Omit<Job, "dir">> = {
  "claude-code, native": (home) => ({ ...base(home, "claude", "plan", "claude-haiku-5-5"), context: { kind: "native", resume: "", first: [], brief: "" }, cwd: fs.mkdtempSync(path.join(os.tmpdir(), "cwd-")) }),
  "claude-code, given" : (home, text) => ({ ...base(home, "claude", "plan", "claude-haiku-5-5"), context: { kind: "given", blocks: [{ text, mark: false }], imgs: [] } }),
  "anthropic api"      : (home) => ({ ...base(home, "claude", "key", "claude-haiku-5-5"), context: { kind: "native", resume: "", first: [], brief: "" } }),
  "openai api"         : (home) => ({ ...base(home, "openai", "key", "gpt-6-luna"), context: { kind: "native", resume: "", first: [], brief: "" } }),
  "codex"              : (home) => ({ ...base(home, "openai", "plan", "gpt-6-luna"), context: { kind: "native", resume: "", first: [], brief: "" }, cwd: fs.mkdtempSync(path.join(os.tmpdir(), "cwd-")) }),
};

function base(home: string, provider: string, kind: "plan" | "key", model: string): Omit<Job, "dir"> {
  const account = kind === "plan" ? { provider, id: provider === "claude" ? "personal" : "chatgpt", kind, dir: path.join(home, provider === "claude" ? "claude-sub" : "codex") } : { provider, id: "key", kind, dir: null };
  return { account, model, effort: "low", speed: "slow", system: "You are a test agent.", own: "", context: { kind: "native", resume: "", first: [], brief: "" }, cwd: null, write: true, tools: [], web: 0 };
}

const evs = (told: Told[]): Ev[] => told.map((x) => x.ev);

for (const [name, of] of Object.entries(DRIVERS)) {
  test.concurrent(name + ": a tool call of Montroop's runs in the holder, its result goes back to the model in the same turn", async () => {
    const t = tag();
    const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
    await fake.next(t + ": work", { what: "tool", calls: [["ask", { question: t + " which one?" }]] });

    const told = evs(await hold(home, of(home, t + ": work"), t + ": work", async (dir) => {
      await until("its question", () => Hold.told(dir).some((x) => x.ev.k === "question"));
      await tell(dir, { $: "say", id: t + "-1", text: t + " this one", answer: true });
    }));
    expect(told.some((e) => e.k === "tool" && e.name.endsWith("ask"))).toBe(true);
    expect(told as unknown[]).toContainEqual(expect.objectContaining({ k: "result", text: "The answer: " + t + " this one", error: false }));
    expect(told.filter((e) => e.k === "turn")).toEqual([{ k: "turn", ok: true, text: "ok" }]);
    expect(told.at(-1)).toEqual({ k: "end", ok: true, text: "ok" });
  });

  test.concurrent(name + ": a stalled answer is waited for", async () => {
    const t = tag();
    const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
    await fake.next(t + ": work", { what: "stall", ms: 2000 });

    const told = await hold(home, of(home, t + ": work"), t + ": work");
    const asked = await fake.seen(t + ": work");
    expect(told.at(-1)?.ev).toEqual({ k: "end", ok: true, text: "ok" });
    expect(told.at(-1)?.at ?? 0).toBeGreaterThanOrEqual(Date.parse(asked[0].at) + 2000);
    expect(asked).toHaveLength(1);
  });

  test.concurrent(name + ": an answer cut off halfway is asked for again", async () => {
    const t = tag();
    const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
    await fake.next(t + ": work", { what: "cut" });

    const told = evs(await hold(home, of(home, t + ": work"), t + ": work"));
    expect(told.at(-1)).toEqual({ k: "end", ok: true, text: "ok" });
    expect((await fake.seen(t + ": work")).length).toBe(2);
  });

  test.concurrent(name + ": a message that comes in while it works reaches the model in the same run", async () => {
    const t = tag();
    const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
    await fake.next(t + ": work", { what: "tool", calls: [["ask", { question: t + " which one?" }]] });

    const told = evs(await hold(home, of(home, t + ": work"), t + ": work", async (dir) => {
      await until("its question", () => Hold.told(dir).some((x) => x.ev.k === "question"));
      await tell(dir, { $: "say", id: t + "-1", text: t + " also this", answer: false }, { $: "say", id: t + "-2", text: t + " the first", answer: true });
    }));
    expect(told as unknown[]).toContainEqual(expect.objectContaining({ k: "result", text: "The answer: " + t + " the first" }));
    expect(told.at(-1)).toEqual({ k: "end", ok: true, text: "ok" });
    // (Claude Code tells a message that came in mid-turn beside the next
    // tool result, so the model's request has it either way)
    const asked = [...await fake.last(t + " the first"), ...await fake.last(t + " also this")];
    expect(asked.some((m) => m.text.includes(t + " also this"))).toBe(true);
  });
}

for (const name of ["claude-code, native", "anthropic api"]) {
  test.concurrent(name + ": a new conversation's first message starts with the job's first blocks, a marked one ending a cache entry", async () => {
    const t = tag();
    const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
    const job = { ...DRIVERS[name](home, ""), context: { kind: "native" as const, resume: "", first: [{ text: "The view " + t + ".\n", mark: true }, { text: "Devices: none.\n", mark: false }], brief: "" } };

    expect(evs(await hold(home, job, t + ": work")).at(-1)).toEqual({ k: "end", ok: true, text: "ok" });
    const first = ((await fake.body(t + ": work")) as { messages: Array<{ content: Array<{ text?: string; cache_control?: unknown }> }> }).messages[0].content.filter((b) => !(b.text ?? "").startsWith("<system-reminder>"));
    expect(first.map((b) => b.text)).toEqual(["The view " + t + ".\n", "Devices: none.\n", t + ": work"]);
    expect(first[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });
}

// the owner's ~/.claude/CLAUDE.md, with what it imports, as Claude Code's
// user memory, the account's folder holding none of its own
for (const name of ["claude-code, native", "claude-code, given"]) {
  test.concurrent(name + ": the owner's own instructions for Claude Code, and the files they import, are in its request", async () => {
    const t = tag();
    const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
    const user = fs.mkdtempSync(path.join(os.tmpdir(), "user-"));
    fs.mkdirSync(path.join(user, ".claude"));
    fs.writeFileSync(path.join(user, ".claude", "CLAUDE.md"), "Owner's rule " + t + ".\n\n@more.md\n");
    fs.writeFileSync(path.join(user, ".claude", "more.md"), "Imported rule " + t + ".\n");

    expect(evs(await hold(home, DRIVERS[name](home, t + ": work"), t + ": work", undefined, undefined, { HOME: user })).at(-1)).toEqual({ k: "end", ok: true, text: "ok" });
    const body = JSON.stringify(await fake.body(t + ": work"));
    expect(body).toContain("Owner's rule " + t + ".");
    expect(body).toContain("Imported rule " + t + ".");
  });
}

test.concurrent("claude-code, given: the account folder's own settings run no hook and let no call past the gate", async () => {
  const t = tag();
  const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
  const ran = path.join(home, "hook-ran");
  fs.writeFileSync(path.join(home, "claude-sub", "settings.json"), JSON.stringify({ permissions: { allow: ["mcp__claude_ai_Gmail__send_message"] }, hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "touch " + ran }] }], UserPromptSubmit: [{ hooks: [{ type: "command", command: "touch " + ran }] }] } }));
  await fake.next(t + ": work", { what: "tool", calls: [["mcp__claude_ai_Gmail__send_message", { to: t + "@example.com", body: "hi" }]] });
  const rules = Rules.read(undefined) as Rule[];

  const told = evs(await hold(home, DRIVERS["claude-code, given"](home, t + ": work"), "", (dir) => serve(dir, rules, {}, () => ""), undefined, {}, { rules }));
  expect(told.filter((e) => e.k === "ask").map((e) => e.k === "ask" && e.tool)).toEqual(["mcp__claude_ai_Gmail__send_message"]);
  expect(fs.existsSync(ran)).toBe(false);
});

test.concurrent("claude-code, native: a brief is told again after a compaction", async () => {
  const t = tag();
  const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
  const job = { ...DRIVERS["claude-code, native"](home, ""), context: { kind: "native" as const, resume: "", first: [], brief: "The brief " + t + "." } };
  await fake.next(t + ": work", { what: "stall", ms: 2000 });

  const told = evs(await hold(home, job, t + ": work", async (dir) => {
    await tell(dir, { $: "say", id: t + "-1", text: "/compact", answer: false }, { $: "say", id: t + "-2", text: t + ": after", answer: false });
  }));
  expect(told).toContainEqual({ k: "compacted" });
  expect(JSON.stringify(await fake.body(t + ": after"))).toContain("Your task, as you were first given it:\\n\\nThe brief " + t + ".");
});

// a server of the test's own for a holder: each call of Montroop's tools
// answered with what out makes of its input, each call parked denied
async function serve(dir: string, rules: Rule[], scratch: Record<string, string>, out: (input: Record<string, unknown>) => string): Promise<void> {
  const send = (c: { write: (s: string) => unknown }, msg: object) => c.write(JSON.stringify(msg) + "\n");
  let rest = "";
  await connect(dir, {
    open: (c) => void send(c, { $: "hello", v: 4, ack: 0, rules, scratch }),
    data: (c, d) => {
      const lines = (rest + d.toString()).split("\n");
      rest = lines.pop() ?? "";
      for (const msg of lines.map((l) => JSON.parse(l) as { $: string; id: string; input: Record<string, unknown>; ev?: { k: string; id: string } })) {
        if (msg.$ === "call") {
          send(c, { $: "result", id: msg.id, out: { text: out(msg.input), fail: false } });
        } else if (msg.$ === "ev" && msg.ev?.k === "ask") {
          send(c, { $: "answer", id: msg.ev.id, ok: false, note: "" });
        }
      }
    },
  });
}

test.concurrent("anthropic api: a device's tool a start offers keeps its device, whose scratch folder the rules read, and each call is answered by the server", async () => {
  const t = tag();
  const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
  const tools = [{ name: "box_files__delete_file", info: "Delete a file.", schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }, device: "box" }];
  await fake.next(t + ": work", { what: "tool", calls: [["box_files__delete_file", { path: "/box/scratch/a-" + t }]] });
  await fake.next("deleted /box/scratch/a-" + t, { what: "tool", calls: [["box_files__delete_file", { path: "/elsewhere/b-" + t }]] });
  const [rules, scratch] = [Rules.read(undefined) as Rule[], { box: "/box/scratch" }];

  const told = evs(await hold(home, DRIVERS["anthropic api"](home, ""), t + ": work", (dir) => serve(dir, rules, scratch, (input) => "deleted " + String(input.path)), undefined, {}, { tools, rules, scratch }));
  expect(told.filter((e) => e.k === "result").map((e) => e.k === "result" && [e.text.split("\n")[0], e.error])).toEqual([["deleted /box/scratch/a-" + t, false], [expect.stringContaining("The user denied this"), true]]);
  expect(told.filter((e) => e.k === "ask").map((e) => e.k === "ask" && e.input.path)).toEqual(["/elsewhere/b-" + t]);
  expect(told.at(-1)).toEqual({ k: "end", ok: true, text: "ok" });
});

test.concurrent("anthropic api: a later holder resumes the conversation from its transcript", async () => {
  const t = tag();
  const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hold-"));
  const job = DRIVERS["anthropic api"](home, "");
  await fake.next(t + ": one", { what: "reply", text: t + " first answer" });
  const began = evs(await hold(home, job, t + ": one", undefined, dir)).find((e) => e.k === "began");
  await fake.next(t + ": two", { what: "reply", text: t + " second answer" });

  const told = evs(await hold(home, { ...job, context: { kind: "native", resume: String(began?.sdk), first: [], brief: "" } }, t + ": two", undefined, dir));
  expect(told.at(-1)).toEqual({ k: "end", ok: true, text: t + " second answer" });
  expect((await fake.last(t + ": two")).map((m) => [m.role, m.text])).toEqual([["user", t + ": one"], ["assistant", t + " first answer"], ["user", t + ": two"]]);
});

test.concurrent("anthropic api: a failed worktree setup is told in the first message of a resumed run, and not again to the holder after", async () => {
  const t = tag();
  const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hold-"));
  const job = DRIVERS["anthropic api"](home, "");
  await fake.next(t + ": one", { what: "reply", text: t + " first answer" });
  const began = evs(await hold(home, job, t + ": one", undefined, dir)).find((e) => e.k === "began");
  const resumed = { ...job, context: { kind: "native" as const, resume: String(began?.sdk), first: [], brief: "" } };
  const r = repo();
  Setup.tool("setup-" + t, { action: "setup", repo: r, command: "echo broken-" + t + "; exit 4" });
  Setup.arm("setup-" + t, r, fs.mkdtempSync(path.join(os.tmpdir(), "worktree-")), dir);
  await fake.next(t + ": two", { what: "reply", text: t + " second answer" });
  await hold(home, resumed, t + ": two", undefined, dir);
  await fake.next(t + ": three", { what: "reply", text: t + " third answer" });
  await hold(home, resumed, t + ": three", undefined, dir);

  const said = (await fake.last(t + ": three")).filter((m) => m.role === "user").map((m) => m.text);
  expect(said[1]).toStartWith("The setup of your worktree failed (it exited with 4).");
  expect(said[1]).toContain("broken-" + t);
  expect(said[2]).toBe(t + ": three");
});

test.concurrent("claude-code, native: a job that may not write has its edit tools denied", async () => {
  const t = tag();
  const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
  const job = { ...DRIVERS["claude-code, native"](home, ""), write: false };
  const file = path.join(String(job.cwd), "written-" + t);
  await fake.next(t + ": work", { what: "tool", calls: [["Write", { file_path: file, content: "x" }]] });

  const told = evs(await hold(home, job, t + ": work"));
  expect(told.find((e) => e.k === "result")).toMatchObject({ error: true });
  expect(fs.existsSync(file)).toBe(false);
});

test.concurrent("claude-code, native: Claude Code's tools that act past its holder or its run are neither offered nor run", async () => {
  const t = tag();
  const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
  const job = DRIVERS["claude-code, native"](home, "");
  await fake.next(t + ": work", { what: "tool", calls: [["ScheduleWakeup", { delaySeconds: 60, prompt: t + ": again", reason: "to look again" }]] });

  const told = evs(await hold(home, job, t + ": work"));
  const offered = (await fake.seen(t + ": work"))[0].tools;
  expect(["Agent", "Bash", "Read", "Edit", "Write", "Skill"].filter((n) => !offered.includes(n))).toEqual([]);
  expect(offered.filter((n) => ["Workflow", "ListAgents", "SendMessage", "ScheduleWakeup", "CronCreate", "CronDelete", "CronList", "RemoteTrigger", "Monitor", "PushNotification", "EnterWorktree", "ExitWorktree"].includes(n))).toEqual([]);
  expect(told.find((e) => e.k === "result")).toMatchObject({ error: true });
});

// a job no driver can run is refused before any call
test.concurrent.each([
  ["a model without the effort", { ...DRIVERS["openai api"](DIR, ""), effort: "turbo" }, "gpt-6-luna has no effort turbo; one of none, low, medium, high, xhigh, max."],
  ["no such model", { ...DRIVERS["anthropic api"](DIR, ""), model: "claude-nine" }, "No model claude-nine on claude-api."],
  ["no such provider", { ...DRIVERS["anthropic api"](DIR, ""), account: { provider: "acme", id: "key", kind: "key" as const, dir: null } }, "No provider acme; one of claude, openai."],
  ["Claude Code with no folder", { ...DRIVERS["claude-code, native"](DIR, ""), cwd: null }, "Claude Code works in a folder, and this job names none."],
])("%s: refused", async (_what, job, why) => {
  expect(evs(await hold(DIR, job, "work")).at(-1)).toEqual({ k: "end", ok: false, text: why });
});

// a plan's usage limit is waited out: the fake refuses each call till
// its reset, so a run that ends well asked again after it
for (const name of ["claude-code, native", "claude-code, given", "codex"]) {
  test.concurrent(name + ": a usage limit is waited out till its reset, then the run goes on", async () => {
    const t = tag();
    const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
    const reset = Date.now() + 3000;
    await fake.next(t + ": work", { what: "error", kind: "usage-limit", reset });

    const end = (await hold(home, DRIVERS[name](home, t + ": work"), t + ": work")).at(-1);
    expect(end?.ev).toEqual({ k: "end", ok: true, text: "ok" });
    expect(end?.at ?? 0).toBeGreaterThanOrEqual(reset);
  });
}

// an API key's usage limit is its credit spent: no reset to wait for
test.concurrent.each([["anthropic api", "usage limits"], ["openai api", "quota"]])("%s: a usage limit ends the run with the vendor's word", async (name, word) => {
  const t = tag();
  const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
  await fake.next(t + ": work", { what: "error", kind: "usage-limit", reset: Date.now() + 3000 });

  const end = evs(await hold(home, DRIVERS[name](home, t + ": work"), t + ": work")).at(-1);
  expect(end).toMatchObject({ k: "end", ok: false });
  expect(end?.k === "end" ? end.text : "").toContain(word);
});

// Montroop's tools on an endpoint of the test's own, as the server's own
// path reaches them (Tools.answer lists them so)
function endpoint(tools: Spec[]): string {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) {
    const msg = (await req.json().catch(() => ({}))) as { id?: unknown; method?: string; params?: { protocolVersion?: string } };
    if (msg.id === undefined) {
      return new Response(null, { status: 202 });
    }
    const listed = tools.map((t) => ({ name: t.name, description: t.info, inputSchema: t.schema, ...(t.defer === true ? { _meta: { "anthropic/alwaysLoad": false } } : {}) }));
    const result = msg.method === "initialize" ? { protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "montroop", version: "1" } } : msg.method === "tools/list" ? { tools: listed } : {};
    return Response.json({ jsonrpc: "2.0", id: msg.id, result });
  } });
  return "http://127.0.0.1:" + server.port + "/";
}

const GIVEN: Array<[Vendor, string, Job["account"]]> = [
  ["claude-sub", "claude-haiku-5-5", { provider: "claude", id: "personal", kind: "plan", dir: config.claude_dir("personal") }],
  ["claude-api", "claude-haiku-5-5", { provider: "claude", id: "key", kind: "key", dir: null }],
  ["openai-api", "gpt-6-luna", { provider: "openai", id: "key", kind: "key", dir: null }],
  ["openai-sub", "gpt-6-luna", { provider: "openai", id: "chatgpt", kind: "plan", dir: path.dirname(config.CHATGPT) }],
];

test.concurrent.each(GIVEN)("%s: a holder's given turn asks the model what the server's own path asks it", async (vendor, model, account) => {
  const t = tag();
  const tools = Tools.list(false, true);
  const blocks = [{ text: "<view>\n" + "a line of the view\n".repeat(200) + "</view>\n", mark: true }, { text: "Devices: box.\n", mark: false }, { text: t + ": compare", mark: false }];
  const ask: Ask = { vendor, model, effort: "low", speed: "slow", system: "You are a test agent.", own: "Its own part.", blocks, searches: 2, server: endpoint([...HOLDS, ...tools]) };
  expect((await AskAI.ask(ask, () => {}).done).ok).toBe(true);
  const server = await fake.body(t + ": compare");

  const job: Omit<Job, "dir"> = { account, model, effort: "low", speed: "slow", system: ask.system, own: "Its own part.", context: { kind: "given", blocks, imgs: [] }, cwd: null, write: false, tools, web: 2 };
  expect(evs(await hold(DIR, job, "")).at(-1)).toEqual({ k: "end", ok: true, text: "ok" });
  expect(unsessioned(await fake.body(t + ": compare"))).toEqual(unsessioned(server));
});

// a request without what Claude Code makes anew for each session and
// prompt: its ids in the user id and the billing header, which the API
// doesn't cache
function unsessioned(body: unknown): string {
  return JSON.stringify(body).replace(/(\\"session_id\\":\\")[0-9a-f-]+/, "$1").replace(/cch=\w+; cc_prompt_id=[0-9a-f-]+/, "");
}
