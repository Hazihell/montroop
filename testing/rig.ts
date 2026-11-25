// What the suite's tests that run Montroop itself share: a Montroop server of
// their own (its own data folder and port, signed in), the fake models
// (testing/fake, started by test.sh) steered as `fake` does, test repos,
// and the processes running.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Hold } from "../Hold.ts";
import { wake_text } from "../Wake.ts";
import { ACCOUNT, EMAIL, type Order } from "./fake/server.ts";

export const ROOT = path.resolve(import.meta.dir, "..");
const CONTROL = "http://127.0.0.1:9999";

type Json = Record<string, unknown>;

type Told = { seq: number; at: number; ev: Json & { k: string } };

// how a test starts its work: a work session (the app's form, the session
// tool's start), or a subagent its agent starts with the subagent tool
type Via = "session" | "subagent";
export const VIAS: Via[] = ["session", "subagent"];

// the servers and devices a test file started, killed after it
// (afterAll(down)), so a failed test leaves none running
const UP: Troop[] = [];
const DEVICES: Bun.Subprocess[] = [];

type Page = {
  status: string; waits: string | null; until: number | null; worktree: string;
  task: string; model: string; effort: string; meter: { tokens: number; window: number } | null;
  runs: Array<{ n: number; status: string; attempts: number; why: string; report: string }>;
  parked: Array<{ id: string; tool: string; input: string }>; questions: Array<{ id: string; text: string }>;
  says: Array<{ id: string; heard: number }>; log: Told[];
};

export async function until<T>(what: string, f: () => T | null | undefined | false | Promise<T | null | undefined | false>, ms = 20000): Promise<T> {
  const end = Date.now() + ms;
  let last = "";
  while (Date.now() < end) {
    try {
      const v = await f();
      if (v !== null && v !== undefined && v !== false) {
        return v;
      }
    } catch (err) {
      last = ": " + (err instanceof Error ? err.message : JSON.stringify(err));
    }
    await Bun.sleep(50);
  }
  throw new Error("timed out waiting for " + what + last);
}

export const fake = {
  // the next model call whose newest message has match gets order
  async next(match: string, order: Order): Promise<void> {
    await fetch(CONTROL + "/queue", { method: "POST", body: JSON.stringify({ ...order, match }) });
  },
  // the requests whose newest message (a connector's: its tool call) has
  // match, with the first 120 characters of it and the tools offered;
  // model "" for a connector's
  async seen(match: string): Promise<Array<{ at: string; vendor: string; model: string; latest: string; tools: string[] }>> {
    const res = await fetch(CONTROL + "/log?match=" + encodeURIComponent(match));
    return ((await res.json()) as { log: Array<{ at: string; vendor: string; model: string; latest: string; tools: string[] }> }).log;
  },
  // what the latest model call whose newest message has match was sent,
  // message by message
  async last(match: string): Promise<Array<{ role: string; text: string }>> {
    const r = (await (await fetch(CONTROL + "/last?match=" + encodeURIComponent(match))).json()) as { log: Array<{ said: Array<{ role: string; text: string }> }> };
    return r.log[0]?.said ?? [];
  },
  // the usage limits a test's order set to reset at until reset now
  async lift(until: number): Promise<void> {
    await fetch(CONTROL + "/lift?until=" + until);
  },
  // the whole body of the latest model call whose newest message has match
  async body(match: string): Promise<unknown> {
    const r = (await (await fetch(CONTROL + "/last?match=" + encodeURIComponent(match))).json()) as { log: Array<{ body: unknown }> };
    return r.log[0]?.body ?? null;
  },
};

// a port no other test server takes (claimed with a folder in the suite's
// temp folder, which every test file shares), below the range connections
// take theirs from
function port(): number {
  const claimed = path.join(os.tmpdir(), "ports");
  fs.mkdirSync(claimed, { recursive: true });
  for (let p = 20000; p < 32768; p++) {
    try {
      fs.mkdirSync(path.join(claimed, String(p)));
      return p;
    } catch {}
  }
  throw new Error("no port left");
}

// the agent's chat and compactor run on Montroop's own loop, so a turn starts
// no Claude Code and a usage limit on claude-sub doesn't stop them: work
// sessions and subagents (subagents()) run Claude Code on claude-sub all
// the same. A test of the chat on claude-sub passes SUB.
const CHAT = "openai-api:gpt-6-luna:low:slow";
const SUB_MODEL = "claude-sub:haiku-5.5:low:slow";
export const SUB = { pick: SUB_MODEL, compactor: SUB_MODEL };

// a Montroop server on a data folder of its own, with fake sign-ins to
// Claude; root: the checkout it runs (another version's, see older())
export class Troop {
  proc: Bun.Subprocess | null = null;
  cookie = "";
  agent = "";
  readonly url: string;
  readonly home: string;

  private constructor(readonly dir: string, readonly port: number, public root: string) {
    this.url = "http://127.0.0.1:" + port;
    this.home = path.dirname(dir);
  }

  // more: config.json's settings beyond the suite's own; root: the checkout
  // the server runs from; keys: its API keys (keys.json)
  static async up(more: Json = {}, root = ROOT, keys: Json = {}): Promise<Troop> {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "troop-"));
    const k = new Troop(path.join(home, ".montroop"), port(), root);
    UP.push(k);
    // a sign-in and key of its own, as the fake keeps a usage limit per credential
    const own = tag();
    claude_signed(path.join(k.dir, "claude-sub"), own);
    // a fixed room for submons: the suite's own load would leave the
    // computer's room for them to chance
    fs.writeFileSync(path.join(k.dir, "config.json"), JSON.stringify({ owner: "tester@example.com", vendors: "claude-sub,openai-api", pick: CHAT, compactor: CHAT, submons: 100, ...more }));
    fs.writeFileSync(path.join(k.dir, "keys.json"), JSON.stringify({ openai: "sk-proj-test-" + own, ...keys }));
    await k.start();
    await k.login();
    const agents = (await k.api("GET", "/api/agents")).json as { agents: Array<{ id: string }> };
    k.agent = agents.agents[0].id;
    return k;
  }

  env(): Record<string, string> {
    return { ...(process.env as Record<string, string>), HOME: this.home, TROOP_DIR: this.dir };
  }

  // a server started on this data folder; up: once it serves
  spawn(): Bun.Subprocess {
    const log = fs.openSync(path.join(this.home, "serve.log"), "a");
    const proc = Bun.spawn(["bun", path.join(this.root, "Cli.ts"), "serve", String(this.port)], { cwd: this.home, env: this.env(), stdio: ["ignore", log, log] });
    fs.closeSync(log);
    return proc;
  }

  async start(): Promise<void> {
    this.proc = this.spawn();
    await until("the server on " + this.port, () => this.up());
  }

  async up(): Promise<boolean> {
    return (await fetch(this.url + "/").catch(() => null))?.status === 200;
  }

  async kill(sig: "SIGKILL" | "SIGTERM" = "SIGKILL"): Promise<void> {
    const p = this.proc;
    this.proc = null;
    p?.kill(sig);
    await p?.exited;
  }

  async login(): Promise<void> {
    const out = Bun.spawnSync(["bun", path.join(this.root, "Cli.ts"), "serve", "login"], { env: this.env() }).stdout.toString();
    const code = /\b(\d{6})\b/.exec(out)?.[1] ?? "";
    const res = await fetch(this.url + "/auth", { method: "POST", body: new URLSearchParams({ code }), redirect: "manual" });
    this.cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("montroop=")) ?? "";
    if (this.cookie === "") {
      throw new Error("sign-in failed: " + res.status + " " + out);
    }
  }

  async api(method: string, p: string, body?: unknown): Promise<{ status: number; json: Json }> {
    const res = await fetch(this.url + p, { method, headers: { cookie: this.cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json: unknown = { text };
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json: json as Json };
  }

  // a message from the owner into an agent's chat, as the app sends one
  async tell(text: string, agent = this.agent): Promise<void> {
    const res = await fetch(this.url + "/api/act?$=say&id=" + crypto.randomUUID() + "&sizes=&agent=" + agent, { method: "POST", headers: { cookie: this.cookie }, body: text });
    if (res.status !== 200) {
      throw new Error("tell: " + res.status + " " + await res.text());
    }
  }

  // the calls waiting on the owner's approval, and those answered
  cards(): Array<{ id: string; tool: string; input: string }> {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir, "asks.json"), "utf8")) as Array<{ id: string; tool: string; input: string }>;
    } catch {
      return [];
    }
  }

  // a device of this server's: troop device in a home of its own, signed in,
  // once the server has used it
  async device(name: string): Promise<Device> {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "device-"));
    const conf = path.join(home, ".config");
    fs.mkdirSync(path.join(conf, "montroop"), { recursive: true });
    fs.writeFileSync(path.join(conf, "montroop", "device.json"), JSON.stringify({ name, work: path.join(home, "work") }));
    const proc = Bun.spawn(["bun", path.join(this.root, "Cli.ts"), "device", this.url], { cwd: home, env: { ...process.env as Record<string, string>, HOME: home, TROOP_DIR: path.join(home, ".montroop"), XDG_CONFIG_HOME: conf }, stdio: ["ignore", "pipe", "ignore"] });
    DEVICES.push(proc);
    let out = "";
    void (async () => {
      for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
        out += chunk;
      }
    })();
    const [, t, code] = await until("its sign-in", () => /auth\?t=(\S+)[\s\S]*type this code: (\d+)/.exec(out));
    await fetch(this.url + "/auth", { method: "POST", headers: { cookie: this.cookie }, body: new URLSearchParams({ t, code }), redirect: "manual" });
    const d = new Device(home);
    await until("the server using " + name, () => d.used());
    return d;
  }

  async session(name: string, prompt: string, repo: string, more: Json = {}): Promise<Session> {
    const r = await this.api("POST", "/api/sessions", { agent: this.agent, repo, base: "main", name, brief: "", prompt, ...more });
    if (r.status !== 200) {
      throw new Error("start " + name + ": " + JSON.stringify(r.json));
    }
    const s = new Session(this, String(r.json.id), name, "session");
    s.worktree = (await s.page()).worktree;
    return s;
  }

  // a subagent or several its agent starts in one call of the subagent
  // tool (its setting turned on first), each on its task's options, by
  // default on claude-sub's haiku-5.5
  async subagents(...tasks: Json[]): Promise<Session[]> {
    await this.api("POST", "/api/agents/" + this.agent, { subagents: true });
    const t = tag();
    await fake.next(t + ": start", { what: "tool", calls: [["subagent", { action: "start", tasks: tasks.map((task) => ({ model: "haiku-5.5", ...task })) }]] });
    await this.tell(t + ": start");
    return await Promise.all(tasks.map(async (task) => {
      const row = await until("subagent " + String(task.name), async () => ((await this.api("GET", "/api/sessions?agent=" + this.agent)).json as unknown as Array<{ id: string; name: string }>).find((x) => x.name === task.name));
      const s = new Session(this, row.id, row.name, "subagent");
      s.worktree = (await s.page()).worktree;
      return s;
    }));
  }

  // a work session, or a subagent its agent starts on the same repo,
  // from main
  async work(via: Via, name: string, prompt: string, repo: string, more: Json = {}): Promise<Session> {
    return via === "session" ? await this.session(name, prompt, repo, more) : (await this.subagents({ task: prompt, name, repo, base: "main", ...more }))[0];
  }
}

// a device's home, and its scratch folder, where its jobs run
class Device {
  readonly scratch: string;

  constructor(readonly home: string) {
    this.scratch = path.join(home, ".montroop", "scratch");
  }

  // whether a server has run a job on it since forget()
  used(): boolean {
    return fs.existsSync(path.join(this.scratch, "main"));
  }

  forget(): void {
    fs.rmSync(path.join(this.scratch, "main"), { recursive: true, force: true });
  }
}

class Session {
  worktree = "";

  constructor(readonly k: Troop, readonly id: string, readonly name: string, readonly via: Via) {}

  // the start of a wake it sends its agent
  woke(body: string): string {
    return wake_text(this.via, this.name, body);
  }

  get dir(): string {
    return path.join(this.k.dir, "sessions", this.id);
  }

  async page(): Promise<Page> {
    const r = await this.k.api("GET", "/api/sessions/" + this.id + "?n=1000");
    if (r.status !== 200) {
      throw new Error("session " + this.id + ": " + r.status);
    }
    return r.json as unknown as Page;
  }

  async status(want: string, ms?: number): Promise<Page> {
    return await until(this.name + " " + want, async () => {
      const p = await this.page();
      return p.status === want ? p : null;
    }, ms);
  }

  async say(text: string, request: string, mode = "steer"): Promise<{ status: number; json: Json }> {
    return await this.k.api("POST", "/api/sessions/" + this.id + "/say", { text, request, mode });
  }

  // what its holder logged, read with the server down too
  logged(): Array<{ ev: { k: string } }> {
    return Hold.told(this.dir);
  }

  // a command waiting, see gate(), let go (the server may be down)
  open(gate: string): void {
    fs.writeFileSync(path.join(this.worktree, gate), "");
  }

  // its holder's process, while one runs
  holder(): number | null {
    return procs().find((p) => p.cmd.includes(" hold " + this.dir))?.pid ?? null;
  }
}

// the product was named Kunumy, its CLI kny, before Montroop: a checkout from
// then gets the same rename, so it speaks to this one by the names it uses
function renamed(dir: string): void {
  for (const rel of fs.readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    const file = path.join(dir, rel);
    if (!fs.statSync(file).isFile()) {
      continue;
    }
    const text = fs.readFileSync(file, "utf8");
    const now = text.replace(/KNY_/g, "TROOP_").replace(/Kunumy/g, "Montroop").replace(/kunumy/g, "montroop").replace(/\bKny\b/g, "Troop").replace(/\bkny\b/g, "troop");
    if (now !== text) {
      fs.writeFileSync(file, now);
    }
    if (/kunumy/i.test(rel)) {
      fs.renameSync(file, path.join(dir, rel.replace(/Kunumy/g, "Montroop").replace(/kunumy/g, "montroop")));
    }
  }
}

// a checkout of the last commit whose holders spoke the wire's version
// before version (by default this one's, Wire's VERSION), so a test can
// start its server and holders; made once per test file
const OLDER = new Map<number, string>();
export function older(version = Number(/export const VERSION = (\d+);/.exec(fs.readFileSync(path.join(ROOT, "Wire.ts"), "utf8"))?.[1])): string {
  const had = OLDER.get(version);
  if (had !== undefined) {
    return had;
  }
  const raised = git(ROOT, "log", "--reverse", "--format=%H", "-S", "export const VERSION = " + version + ";", "--", "Wire.ts").split("\n")[0];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "older-"));
  const r = Bun.spawnSync(["sh", "-c", "git -C \"$1\" archive \"$2^\" | tar -x -C \"$3\"", "sh", ROOT, raised, dir], { stderr: "pipe" });
  if (r.exitCode !== 0 || raised === "") {
    throw new Error("no checkout of the version before " + version + ": " + r.stderr.toString());
  }
  renamed(dir);
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"));
  fs.mkdirSync(path.join(dir, "ui"), { recursive: true });
  fs.symlinkSync(path.join(ROOT, "ui", "dist"), path.join(dir, "ui", "dist"));
  OLDER.set(version, dir);
  return dir;
}

export async function down(): Promise<void> {
  DEVICES.splice(0).forEach((p) => p.kill("SIGKILL"));
  await Promise.all(UP.splice(0).map((k) => k.kill()));
}

// a Claude Code config folder signed in to the fake's account, with the
// account as `claude auth login` keeps it: without it, Claude Code fetches
// it while its first requests go out, which then lack it
export function claude_signed(dir: string, own: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "sk-ant-oat01-test-" + own, refreshToken: "sk-ant-ort01-test-" + own, expiresAt: 4102444800000, scopes: ["user:inference", "user:profile", "user:sessions:claude_code", "user:mcp_servers"], subscriptionType: "max" } }));
  fs.writeFileSync(path.join(dir, ".claude.json"), JSON.stringify({ oauthAccount: { accountUuid: ACCOUNT, emailAddress: EMAIL, organizationUuid: ACCOUNT } }));
}

// a text of the test's own, so the fake's orders reach only its calls
export function tag(): string {
  return crypto.randomUUID().slice(0, 8);
}

// a shell command that runs till its session is let go (open), then prints
// name-done: a session at work for as long as the test needs
export function gate(name: string): string {
  return "until [ -f " + name + " ]; do sleep 0.05; done; echo " + name + "-done";
}

// whether a gate()'s command runs
export function waiting(name: string): boolean {
  return running(new RegExp("until \\[ -f " + name + " \\]")).length > 0;
}

// every process running (the suite has a process namespace of its own)
export function procs(): Array<{ pid: number; ppid: number; cmd: string }> {
  return fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d)).flatMap((d) => {
    try {
      const stat = fs.readFileSync("/proc/" + d + "/stat", "utf8");
      const [state, ppid] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const cmd = fs.readFileSync("/proc/" + d + "/cmdline", "utf8").replaceAll("\0", " ").trim();
      return state === "Z" ? [] : [{ pid: Number(d), ppid: Number(ppid), cmd }];
    } catch {
      return [];
    }
  });
}

// SIGKILLed; none found fails the test (process.kill(0) would kill the suite)
export function kill(pid: number | null | undefined): void {
  if (pid === null || pid === undefined || pid <= 0) {
    throw new Error("no such process");
  }
  process.kill(pid, "SIGKILL");
}

function running(pattern: RegExp): number[] {
  return procs().filter((p) => pattern.test(p.cmd)).map((p) => p.pid);
}

export function git(dir: string, ...args: string[]): string {
  const r = Bun.spawnSync(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" });
  return (r.stdout.toString() + r.stderr.toString()).trim();
}

// a repo with one commit on main, pushed to a bare origin beside it
export function repo(): string {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), "repo-"));
  const dir = path.join(top, "app");
  git(top, "init", "-q", "--bare", "-b", "main", "origin.git");
  git(top, "init", "-q", "-b", "main", "app");
  fs.writeFileSync(path.join(dir, "README.md"), "# Test app\n");
  for (const [k, v] of [["user.email", "test@example.com"], ["user.name", "test"]]) {
    git(dir, "config", k, v);
  }
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "start");
  git(dir, "remote", "add", "origin", path.join(top, "origin.git"));
  git(dir, "push", "-q", "origin", "main");
  return dir;
}

// an agent's chat as the app shows it: each message's kind and text
export async function chat(k: Troop, agent = k.agent): Promise<Array<{ kind: string; text: string }>> {
  const meta = (await k.api("GET", "/api/tree?agent=" + agent)).json as { count: number };
  if (meta.count === 0) {
    return [];
  }
  const keys = Array.from({ length: meta.count }, (_, i) => "-1." + i).join(",");
  const cards = (await k.api("GET", "/api/tree?agent=" + agent + "&get=" + keys)).json as unknown as Array<{ k?: string; t: string } | null>;
  return cards.flatMap((c) => (c === null ? [] : [{ kind: c.k ?? "", text: c.t }]));
}

// how many messages in an agent's chat start with text
export async function said(k: Troop, text: string, agent = k.agent): Promise<number> {
  return (await chat(k, agent)).filter((m) => m.text.startsWith(text)).length;
}
