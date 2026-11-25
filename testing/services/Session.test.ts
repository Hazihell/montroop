import { DIR } from "../home.ts";
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Owner } from "../../Owner.ts";
import { Session, type Effect } from "../../Session.ts";
import { wake_text } from "../../Wake.ts";
import type { Ev } from "../../Wire.ts";

let made = 0;

function session(name = "s" + ++made): Session {
  const id = crypto.randomUUID().slice(0, 8);
  return Session.add({ id, name, agent: "agent1", repo: "/repo", base: "main", branch: "kny/" + name, worktree: "/repo-" + name, account: "", model: "", dir: path.join(DIR, "sessions", id) }, "the first message");
}

// a subagent's record, as the subagent tool makes it
function subagent(name: string): Session {
  const id = crypto.randomUUID().slice(0, 8);
  return Session.add({ id, name, agent: "agent1", repo: "", base: "", branch: "", worktree: "/scratch/agent1/sessions/" + name, provider: "claude", account: "", model: "claude-haiku-5-5", effort: "low", memory: 1, write: 1, device: "", dir: path.join(DIR, "sessions", id) }, "the task");
}

function told(s: Session, seq: number, ev: Ev): Effect[] {
  return Session.apply(s.id, { seq, at: 1000 + seq, ev });
}

function woke(fx: Effect[]): string[] {
  return fx.flatMap((f) => (f.do === "wake" ? [f.wake.text] : []));
}

// a call parked, its id Claude Code's tool use id, unique to it
function push(id = crypto.randomUUID()): Ev {
  return { k: "ask", id, tool: "shell", input: { command: "git push --force" }, what: "Delete files or data outside the scratch folder" };
}

test("a run that ends well is done, and wakes its agent with its report", () => {
  const s = session("tidy");
  told(s, 1, { k: "report", text: "All set: 3 files changed." });
  expect(woke(told(s, 2, { k: "end", ok: true, text: "ok" }))).toEqual([wake_text("session", "tidy", "done: All set: 3 files changed.")]);
  expect(Session.get(s.id)?.status).toBe("done");
  expect(Session.run(s.id)).toMatchObject({ n: 1, status: "done", report: "All set: 3 files changed." });
});

test("a run that ends well with no report wakes its agent with its last words", () => {
  const s = session("quiet");
  expect(woke(told(s, 1, { k: "end", ok: true, text: "Finished." }))).toEqual([wake_text("session", "quiet", "done: Finished.")]);
});

test("a run that ends badly fails, saying why", () => {
  const s = session("broke");
  expect(woke(told(s, 1, { k: "end", ok: false, text: "Claude Code process terminated by signal SIGKILL" }))).toEqual([wake_text("session", "broke", "failed: Claude Code process terminated by signal SIGKILL")]);
  expect(Session.run(s.id)).toMatchObject({ status: "failed", why: "Claude Code process terminated by signal SIGKILL" });
});

test("a subagent's run that ends well has its last reply as its result, and wakes its agent as a subagent", () => {
  const s = subagent("scout");
  told(s, 1, { k: "text", text: "Looking." });
  expect(woke(told(s, 2, { k: "end", ok: true, text: "Found 3 files." }))).toEqual([wake_text("subagent", "scout", "done: Found 3 files.")]);
  expect(Session.run(s.id)).toMatchObject({ status: "done", report: "Found 3 files." });
});

test("a subagent's question wakes its agent to answer with the subagent tool", () => {
  const s = subagent("asker");
  expect(woke(told(s, 1, { k: "question", id: crypto.randomUUID(), text: "Which one?" }))).toEqual([wake_text("subagent", "asker", "question: Which one?\n\nIt waits for your answer: give it with subagent send. If only the user knows, ask them first.")]);
});

test("a run at work is tried again on a new holder, its attempts counted, unless it waits on someone", () => {
  const s = subagent("again");
  expect(Session.retry(s.id)).toMatchObject({ n: 1, status: "running", attempts: 2 });
  expect(Session.get(s.id)?.status).toBe("running");
  told(s, 1, push());
  expect(Session.retry(s.id)).toBeNull();
  expect(Session.run(s.id)?.attempts).toBe(2);
});

test("an event told again, or one older than the last taken, changes nothing", () => {
  const s = session();
  told(s, 1, { k: "text", text: "first" });
  told(s, 2, { k: "end", ok: true, text: "ok" });
  expect(told(s, 2, { k: "end", ok: true, text: "ok" })).toEqual([]);
  expect(told(s, 1, push())).toEqual([]);
  expect(Session.get(s.id)).toMatchObject({ status: "done", last: "first", ack: 2 });
});

test("a call parked makes the session wait, shows its card and wakes its agent", () => {
  const s = session("gate");
  const fx = told(s, 1, push());
  expect(fx.filter((f) => f.do === "card")).toHaveLength(1);
  expect(woke(fx)).toEqual([wake_text("session", "gate", "waiting: the user's approval in the app, for: delete files or data outside the scratch folder (shell)")]);
  expect(Session.get(s.id)?.status).toBe("waiting");
});

test("a second call parked while one waits shows its card but wakes no one again", () => {
  const s = session();
  told(s, 1, push());
  const fx = told(s, 2, push());
  expect(fx.map((f) => f.do)).toEqual(["card"]);
});

test("the session is at work again once every call parked is answered", () => {
  const s = session();
  const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
  told(s, 1, push(a));
  told(s, 2, push(b));
  told(s, 3, { k: "answered", id: a, ok: true });
  expect(Session.get(s.id)?.status).toBe("waiting");
  told(s, 4, { k: "dropped", id: b });
  expect(Session.get(s.id)?.status).toBe("running");
  expect(Session.parked(s.id)).toEqual([]);
});

test("a question makes the session wait for its agent's answer, and wakes it with the question", () => {
  const s = session("curious");
  const q = crypto.randomUUID();
  expect(woke(told(s, 1, { k: "question", id: q, text: "Which word?" }))).toEqual([wake_text("session", "curious", "question: Which word?\n\nIt waits for your answer: give it with session send. If only the user knows, ask them first.")]);
  expect(Session.get(s.id)?.status).toBe("waiting");
  told(s, 2, { k: "replied", id: q });
  expect(Session.get(s.id)?.status).toBe("running");
});

test("a run stopped by a usage limit wakes its agent, saying it goes on by itself, and stays at work", () => {
  const s = session("spent");
  const [wake] = woke(told(s, 1, { k: "limit", until: Date.now() + 2 * 3600e3 }));
  expect(wake).toMatch(/^\[Session spent\] waiting: a usage limit, till .*\d\d:\d\d\. It goes on by itself then: nothing to do\.$/);
  expect(Session.get(s.id)?.status).toBe("running");
});

test("the messages a run didn't take in start the next run on them when it ends", () => {
  const s = session("busy");
  Session.say({ id: s.id + "/r1", session: s.id, text: "Also do A.", mode: "queue", at: 1 });
  Session.say({ id: s.id + "/r2", session: s.id, text: "And B.", mode: "steer", at: 2 });
  const fx = told(s, 1, { k: "end", ok: true, text: "First part done." });
  expect(fx.map((f) => f.do)).toContain("next");
  expect(woke(fx)).toEqual([wake_text("session", "busy", "done: First part done.\n\nIt runs again now, on the messages sent to it it hadn't taken in.")]);
  expect(Session.run(s.id)).toMatchObject({ n: 2, prompt: "Also do A.\n\nAnd B.", status: "running" });
  expect(Session.unheard(s.id)).toEqual([]);
});

test("a stop drops the messages not taken in", () => {
  const s = session();
  Session.say({ id: s.id + "/r1", session: s.id, text: "Later.", mode: "queue", at: 1 });
  Session.move(s.id, "stop", "", null);
  expect(Session.get(s.id)?.status).toBe("stopped");
  expect(Session.says(s.id).map((x) => x.heard)).toEqual([-1]);
});

test("the server's own step out of work is taken once", () => {
  const s = session("lost");
  const note = { about: "gone 1.1", text: "its holder ended before the run did: send it a message to go on" };
  expect(woke(Session.move(s.id, "failed", "its holder ended before the run did", note) ?? [])).toEqual([wake_text("session", "lost", "failed: its holder ended before the run did: send it a message to go on")]);
  expect(Session.move(s.id, "failed", "its holder ended before the run did", note)).toBeNull();
});

test("a session at work can't start another run; a done one runs again as its next run, a failed one tries its run again", () => {
  const s = session();
  expect(Session.again(s.id, "More.")).toBeNull();
  told(s, 1, { k: "end", ok: true, text: "ok" });
  expect(Session.again(s.id, "More.")).toMatchObject({ n: 2, prompt: "More.", attempts: 1, status: "running" });
  told(s, 2, { k: "end", ok: false, text: "boom" });
  expect(Session.again(s.id, null)).toMatchObject({ n: 2, attempts: 2, why: "", status: "running" });
});

test("a new holder's welcome drops the calls and questions it no longer holds", () => {
  const s = session();
  const call = crypto.randomUUID();
  told(s, 1, push(call));
  told(s, 2, { k: "question", id: crypto.randomUUID(), text: "Which word?" });
  expect(Session.welcome(s.id, [], [])).toEqual([{ do: "uncard", ask: call }]);
  expect([Session.parked(s.id), Session.questions(s.id), Session.get(s.id)?.status]).toEqual([[], [], "running"]);
});

test("an event and the wake it makes are taken together, or neither is", () => {
  const s = session("brink");
  const db = Owner.open();
  db.run("create trigger no_wake before insert on work_wakes begin select raise(abort, 'no wake'); end");
  expect(() => told(s, 1, { k: "end", ok: true, text: "ok" })).toThrow("no wake");
  expect(Session.get(s.id)).toMatchObject({ status: "running", ack: 0 });
  db.run("drop trigger no_wake");
  expect(woke(told(s, 1, { k: "end", ok: true, text: "ok" }))).toEqual([wake_text("session", "brink", "done: ok")]);
});

test("a record from an earlier version's tables opens with today's columns, its rows and unknown columns kept", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "old-"));
  const db = new Database(path.join(dir, "kunumy.db"));
  db.run("create table work_sessions (id text primary key, name text not null, agent text not null, repo text not null, base text not null, branch text not null, worktree text not null, account text not null, model text not null, dir text not null, status text not null, sdk text not null default '', ack integer not null default 0, launches integer not null default 0, last text not null default '', made integer not null, at integer not null, legacy integer not null default 0)");
  db.run("create table work_runs (session text not null, n integer not null, prompt text not null, status text not null, attempts integer not null default 1, why text not null default '', started integer not null, ended integer, primary key (session, n))");
  db.run("create table work_questions (id text primary key, session text not null, at integer not null)");
  db.run("insert into work_sessions values ('a1d5e551', 'old', 'agent1', '/repo', 'main', 'ki/old', '/repo-old', '', '', '/old', 'done', '', 3, 2, 'old words', 1, 1, 7)");
  db.run("insert into work_runs values ('a1d5e551', 1, 'the old prompt', 'done', 1, '', 1, 1)");
  db.run("insert into work_questions values ('q1', 'a1d5e551', 1)");
  db.close();
  const read = "import { Session } from './Session.ts'; console.log(JSON.stringify({ s: Session.get('a1d5e551'), runs: Session.runs('a1d5e551'), questions: Session.questions('a1d5e551') }))";
  const out = Bun.spawnSync(["bun", "-e", read], { cwd: path.resolve(import.meta.dir, "../.."), env: { ...process.env, KNY_DIR: dir } });
  const got = JSON.parse(out.stdout.toString()) as { s: Record<string, unknown>; runs: Record<string, unknown>[]; questions: unknown[] };
  expect(got.s).toMatchObject({ name: "old", status: "done", ack: 3, launches: 2, archived: 0, legacy: 7, provider: "", effort: "", memory: 0, write: 1, device: "" });
  expect(got.runs).toMatchObject([{ n: 1, prompt: "the old prompt", report: "" }]);
  expect(got.questions).toEqual([]);
});
