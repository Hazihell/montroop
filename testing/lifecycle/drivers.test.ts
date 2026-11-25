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
import { Tools } from "../../Tools.ts";
import type { Ev, Told } from "../../Wire.ts";
import { fake, ROOT, tag, until } from "../rig.ts";

const jwt = (claims: object) => [{ alg: "none" }, { exp: Math.floor(Date.now() / 1e3) + 10 * 86400, ...claims }].map((x) => Buffer.from(JSON.stringify(x)).toString("base64url")).join(".") + ".fake";

// a data folder signed in to Claude and ChatGPT and keyed for both APIs,
// each credential its own, as the fake keeps a usage limit per credential
function signed(dir: string): string {
  const own = crypto.randomUUID().slice(0, 8);
  fs.mkdirSync(path.join(dir, "claude-sub"), { recursive: true });
  fs.writeFileSync(path.join(dir, "claude-sub", ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "sk-ant-oat01-test-" + own, refreshToken: "sk-ant-ort01-test-" + own, expiresAt: 4102444800000, scopes: ["user:inference", "user:profile", "user:sessions:claude_code", "user:mcp_servers"], subscriptionType: "max" } }));
  fs.writeFileSync(path.join(dir, "keys.json"), JSON.stringify({ anthropic: "sk-ant-api03-test-" + own, openai: "sk-proj-test-" + own }));
  const auth = { "https://api.openai.com/auth": { chatgpt_account_id: own, chatgpt_plan_type: "plus" } };
  fs.writeFileSync(path.join(dir, "chatgpt.json"), JSON.stringify({ auth_mode: "chatgpt", OPENAI_API_KEY: null, tokens: { id_token: jwt({ email: "tester@example.com", ...auth }), access_token: jwt(auth), refresh_token: "rt_" + own, account_id: own }, last_refresh: new Date().toISOString() }));
  return dir;
}

signed(DIR);
config.config_reload();

// the job of each driver, on a data folder's accounts: a given one's
// blocks end with the text the fake matches
const DRIVERS: Record<string, (home: string, text: string) => Omit<Job, "dir">> = {
  "claude-code, native": (home) => ({ ...base(home, "claude", "plan", "claude-haiku-5-5"), context: { kind: "native", resume: "", first: [] }, cwd: fs.mkdtempSync(path.join(os.tmpdir(), "cwd-")) }),
  "claude-code, given" : (home, text) => ({ ...base(home, "claude", "plan", "claude-haiku-5-5"), context: { kind: "given", blocks: [{ text, mark: false }], imgs: [] } }),
  "anthropic api"      : (home) => ({ ...base(home, "claude", "key", "claude-haiku-5-5"), context: { kind: "native", resume: "", first: [] } }),
  "openai api"         : (home) => ({ ...base(home, "openai", "key", "gpt-6-luna"), context: { kind: "native", resume: "", first: [] } }),
  "chatgpt plan"       : (home) => ({ ...base(home, "openai", "plan", "gpt-6-luna"), context: { kind: "native", resume: "", first: [] } }),
};

function base(home: string, provider: string, kind: "plan" | "key", model: string): Omit<Job, "dir"> {
  const account = kind === "plan" ? { provider, id: "personal", kind, dir: path.join(home, "claude-sub") } : { provider, id: "key", kind, dir: null };
  return { account, model, effort: "low", speed: "slow", system: "You are a test agent.", own: "", context: { kind: "native", resume: "", first: [] }, cwd: null, write: true, tools: [], web: 0 };
}

// a holder run on job by hand, its first message prompt (given: none, the
// job's blocks are its context), no server linked to it but what
// meanwhile does: what it told, each with when, once its run is over; dir:
// the folder of a holder before it, whose run it goes on with
async function hold(home: string, job: Omit<Job, "dir">, prompt: string, meanwhile = (_dir: string) => Promise.resolve(), dir = fs.mkdtempSync(path.join(os.tmpdir(), "hold-"))): Promise<Told[]> {
  const ends = () => Hold.told(dir).filter((x) => x.ev.k === "end").length;
  const before = ends();
  fs.writeFileSync(path.join(dir, "start.json"), JSON.stringify({ driver: "provider", job, prompt: job.context.kind === "given" ? "" : prompt, resume: "", rules: [], sock: path.join(dir, "hold.sock") }));
  const p = Bun.spawn(["bun", path.join(ROOT, "Cli.ts"), "hold", dir], { env: { ...process.env, KNY_DIR: home }, stdio: ["ignore", "ignore", "ignore"] });
  await meanwhile(dir);
  // with no server to take what it told, it would wait a minute to exit
  await until("its run over", () => ends() > before, 25000);
  p.kill("SIGKILL");
  await p.exited;
  return Hold.told(dir);
}

// what the server sends a holder: its hello, then msgs
async function tell(dir: string, ...msgs: object[]): Promise<void> {
  const sock = path.join(dir, "hold.sock");
  await until("its socket", () => fs.existsSync(sock));
  const c = await Bun.connect({ unix: sock, socket: { data: () => {} } });
  c.write([{ $: "hello", ack: 0 }, ...msgs].map((m) => JSON.stringify(m) + "\n").join(""));
}

const evs = (told: Told[]): Ev[] => told.map((x) => x.ev);

for (const [name, of] of Object.entries(DRIVERS)) {
  test.concurrent(name + ": a tool call of Kunumy's runs in the holder, its result goes back to the model", async () => {
    const t = tag();
    const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
    await fake.next(t + ": work", { what: "tool", calls: [["report", { result: t + " result" }]] });

    const told = evs(await hold(home, of(home, t + ": work"), t + ": work"));
    expect(told.some((e) => e.k === "tool" && e.name.endsWith("report"))).toBe(true);
    expect(told as unknown[]).toContainEqual({ k: "report", text: t + " result" });
    expect(told as unknown[]).toContainEqual(expect.objectContaining({ k: "result", text: "Reported. End your turn now.", error: false }));
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
    await fake.next(t + ": work", { what: "tool", calls: [["ask_owner", { question: t + " which one?" }]] });

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
    const job = { ...DRIVERS[name](home, ""), context: { kind: "native" as const, resume: "", first: [{ text: "The view " + t + ".\n", mark: true }, { text: "Devices: none.\n", mark: false }] } };

    expect(evs(await hold(home, job, t + ": work")).at(-1)).toEqual({ k: "end", ok: true, text: "ok" });
    const first = ((await fake.body(t + ": work")) as { messages: Array<{ content: Array<{ text?: string; cache_control?: unknown }> }> }).messages[0].content.filter((b) => !(b.text ?? "").startsWith("<system-reminder>"));
    expect(first.map((b) => b.text)).toEqual(["The view " + t + ".\n", "Devices: none.\n", t + ": work"]);
    expect(first[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });
}

test.concurrent("anthropic api: a later holder resumes the conversation from its transcript", async () => {
  const t = tag();
  const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hold-"));
  const job = DRIVERS["anthropic api"](home, "");
  await fake.next(t + ": one", { what: "reply", text: t + " first answer" });
  const began = evs(await hold(home, job, t + ": one", undefined, dir)).find((e) => e.k === "began");
  await fake.next(t + ": two", { what: "reply", text: t + " second answer" });

  const told = evs(await hold(home, { ...job, context: { kind: "native", resume: String(began?.sdk), first: [] } }, t + ": two", undefined, dir));
  expect(told.at(-1)).toEqual({ k: "end", ok: true, text: t + " second answer" });
  expect((await fake.last(t + ": two")).map((m) => [m.role, m.text])).toEqual([["user", t + ": one"], ["assistant", t + " first answer"], ["user", t + ": two"]]);
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
for (const name of ["claude-code, native", "claude-code, given", "chatgpt plan"]) {
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

// Kunumy's tools on an endpoint of the test's own, as the server's own
// path reaches them (Tools.answer lists them so)
function endpoint(tools: Spec[]): string {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) {
    const msg = (await req.json().catch(() => ({}))) as { id?: unknown; method?: string; params?: { protocolVersion?: string } };
    if (msg.id === undefined) {
      return new Response(null, { status: 202 });
    }
    const listed = tools.map((t) => ({ name: t.name, description: t.info, inputSchema: t.schema, ...(t.defer === true ? { _meta: { "anthropic/alwaysLoad": false } } : {}) }));
    const result = msg.method === "initialize" ? { protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "kunumy", version: "1" } } : msg.method === "tools/list" ? { tools: listed } : {};
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
