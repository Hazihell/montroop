// What the suite's tests that run Kunumy itself share: a Kunumy server of
// their own (its own data folder and port, signed in), the fake models
// (testing/fake, started by test.sh) steered as `fake` does, test repos,
// and the processes running.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Hold } from "../Hold.ts";
import type { Order } from "./fake/server.ts";

const ROOT = path.resolve(import.meta.dir, "..");
const CONTROL = "http://127.0.0.1:9999";

type Json = Record<string, unknown>;

type Told = { seq: number; at: number; ev: Json & { k: string } };

// the servers a test file started, killed after it (afterAll(down)), so a
// failed test leaves none running
const UP: Kny[] = [];

type Page = {
  status: string; waits: string | null; worktree: string;
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

// a Kunumy server on a data folder of its own, with fake sign-ins to
// Claude; root: the checkout it runs (another version's, see older())
export class Kny {
  proc: Bun.Subprocess | null = null;
  cookie = "";
  agent = "";
  readonly url: string;
  readonly home: string;

  private constructor(readonly dir: string, readonly port: number, public root: string) {
    this.url = "http://127.0.0.1:" + port;
    this.home = path.dirname(dir);
  }

  static async up(root = ROOT): Promise<Kny> {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "kny-"));
    const k = new Kny(path.join(home, ".kunumy"), port(), root);
    UP.push(k);
    fs.mkdirSync(path.join(k.dir, "claude-sub"), { recursive: true });
    const model = "claude-sub:haiku-5.5:low:slow";
    fs.writeFileSync(path.join(k.dir, "config.json"), JSON.stringify({ owner: "tester@example.com", vendors: "claude-sub", pick: model, compactor: model, agents: model }));
    fs.writeFileSync(path.join(k.dir, "claude-sub", ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "sk-ant-oat01-test-fake", refreshToken: "sk-ant-ort01-test-fake", expiresAt: 4102444800000, scopes: ["user:inference", "user:profile", "user:sessions:claude_code"], subscriptionType: "max" } }));
    await k.start();
    await k.login();
    const agents = (await k.api("GET", "/api/agents")).json as { agents: Array<{ id: string }> };
    k.agent = agents.agents[0].id;
    return k;
  }

  env(): Record<string, string> {
    return { ...(process.env as Record<string, string>), HOME: this.home, KNY_DIR: this.dir };
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
    this.cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("kunumy=")) ?? "";
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

  async session(name: string, prompt: string, repo: string, more: Json = {}): Promise<Session> {
    const r = await this.api("POST", "/api/sessions", { agent: this.agent, repo, base: "main", name, brief: "", prompt, ...more });
    if (r.status !== 200) {
      throw new Error("start " + name + ": " + JSON.stringify(r.json));
    }
    const s = new Session(this, String(r.json.id), name);
    s.worktree = (await s.page()).worktree;
    return s;
  }
}

class Session {
  worktree = "";

  constructor(readonly k: Kny, readonly id: string, readonly name: string) {}

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

// a checkout of the last commit whose holders spoke the wire's version
// before this one (Wire's VERSION), so a test can start its server and
// holders; made once per test file
let OLDER: string | null = null;
export function older(): string {
  if (OLDER !== null) {
    return OLDER;
  }
  const version = /export const VERSION = (\d+);/.exec(fs.readFileSync(path.join(ROOT, "Wire.ts"), "utf8"))?.[1];
  const raised = git(ROOT, "log", "-1", "--format=%H", "-S", "export const VERSION = " + version + ";", "--", "Wire.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "older-"));
  const r = Bun.spawnSync(["sh", "-c", "git -C \"$1\" archive \"$2^\" | tar -x -C \"$3\"", "sh", ROOT, raised, dir], { stderr: "pipe" });
  if (r.exitCode !== 0 || raised === "") {
    throw new Error("no checkout of the version before " + version + ": " + r.stderr.toString());
  }
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"));
  fs.mkdirSync(path.join(dir, "ui"), { recursive: true });
  fs.symlinkSync(path.join(ROOT, "ui", "dist"), path.join(dir, "ui", "dist"));
  OLDER = dir;
  return dir;
}

export async function down(): Promise<void> {
  await Promise.all(UP.splice(0).map((k) => k.kill()));
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
export async function chat(k: Kny, agent = k.agent): Promise<Array<{ kind: string; text: string }>> {
  const meta = (await k.api("GET", "/api/tree?agent=" + agent)).json as { count: number };
  if (meta.count === 0) {
    return [];
  }
  const keys = Array.from({ length: meta.count }, (_, i) => "-1." + i).join(",");
  const cards = (await k.api("GET", "/api/tree?agent=" + agent + "&get=" + keys)).json as unknown as Array<{ k?: string; t: string } | null>;
  return cards.flatMap((c) => (c === null ? [] : [{ kind: c.k ?? "", text: c.t }]));
}

// how many messages in an agent's chat start with text
export async function said(k: Kny, text: string, agent = k.agent): Promise<number> {
  return (await chat(k, agent)).filter((m) => m.text.startsWith(text)).length;
}
