import { afterAll, expect, test } from "bun:test";
import { wake_text } from "../../Wake.ts";
import { chat, down, fake, gate, kill, Kny, procs, repo, said, tag, until, waiting } from "../rig.ts";

const GONE = "its holder ended before the run did";

afterAll(down);

test.concurrent("a holder killed mid-run fails the run once, leaves nothing of it running, and a resume finishes it", async () => {
  const k = await Kny.up();
  const t = tag();
  await fake.next(t + ": work", { what: "tool", calls: [["Bash", { command: gate(t) }]] });
  const s = await k.session("hk", t + ": work", repo());
  await until("the command running", () => waiting(t));
  kill(s.holder());

  expect((await s.status("failed")).runs[0].why).toBe(GONE);
  await until("its holder gone", () => s.holder() === null);
  expect(waiting(t)).toBe(false);
  expect((await k.api("POST", "/api/sessions/" + s.id + "/resume", {})).status).toBe(200);
  expect((await s.status("done")).runs).toMatchObject([{ n: 1, status: "done", attempts: 2 }]);
  await until("the done wake", async () => await said(k, wake_text("session", "hk", "done:")) === 1);
  expect(await said(k, wake_text("session", "hk", "failed: ") + GONE)).toBe(1);
});

test.concurrent("Claude Code killed under its holder fails the run, and its holder exits leaving nothing running", async () => {
  const k = await Kny.up();
  const t = tag();
  await fake.next(t + ": work", { what: "tool", calls: [["Bash", { command: gate(t) }]] });
  const s = await k.session("cc", t + ": work", repo());
  await until("the command running", () => waiting(t));
  const holder = s.holder();
  kill(procs().find((p) => p.ppid === holder && /\/claude(\s|$)/.test(p.cmd))?.pid);

  expect((await s.status("failed")).runs[0].why).toBe("Claude Code process terminated by signal SIGKILL");
  await until("its holder gone", () => s.holder() === null);
  expect(waiting(t)).toBe(false);
  await until("the failed wake", async () => await said(k, wake_text("session", "cc", "failed: Claude Code process terminated by signal SIGKILL")) === 1);
});

test.concurrent("a question asked while the server is down reaches it once it's back, and is answered; each wake comes once across restarts", async () => {
  const k = await Kny.up();
  const t = tag();
  await fake.next(t + ": work", { what: "tool", calls: [["Bash", { command: gate(t) }]] });
  await fake.next(t + "-done", { what: "tool", calls: [["ask_owner", { question: "Which word should it be?" }]] });
  await fake.next("The answer: heron " + t, { what: "reply", text: "It is heron." });
  await fake.next(t + ": after", { what: "reply", text: t + " after" });
  const s = await k.session("q", t + ": work", repo());
  await until("the command running", () => waiting(t));
  await k.kill();
  s.open(t);
  await until("the question asked", () => s.logged().some((x) => x.ev.k === "question"));
  await k.start();

  const asked = await s.status("waiting");
  expect(asked.waits).toBe("answer");
  expect(asked.questions.map((q) => q.text)).toEqual(["Which word should it be?"]);
  expect((await s.say("heron " + t, "ans-1")).status).toBe(200);
  await s.status("done");
  await until("the done wake", async () => await said(k, wake_text("session", "q", "done: It is heron.")) === 1);
  await k.kill();
  await k.start();
  // what the restart delivers again comes before this message's answer
  await k.tell(t + ": after");
  await until("the answer after the restart", async () => (await chat(k)).some((m) => m.text === t + " after"));
  expect(await said(k, wake_text("session", "q", "question: Which word should it be?"))).toBe(1);
  expect(await said(k, wake_text("session", "q", "done:"))).toBe(1);
});

test.concurrent("a run that ends while the server is down is taken from its log at the next start, and the message queued for it runs next", async () => {
  const k = await Kny.up();
  const t = tag();
  await fake.next(t + ": work", { what: "tool", calls: [["Bash", { command: gate(t) }]] });
  const s = await k.session("qd", t + ": work", repo());
  await until("the command running", () => waiting(t));
  expect((await s.say(t + ": next", "q-1", "queue")).json.sent).toBe("Queued: it starts the session's next run once this one ends.");
  await k.kill();
  s.open(t);
  await until("the run's end logged", () => s.logged().some((x) => x.ev.k === "end"));
  // it would wait a minute for a server to take its end, then exit
  kill(s.holder());
  await k.start();

  const done = await until("the queued message's run done", async () => {
    const p = await s.page();
    return p.status === "done" && p.runs.length === 2 ? p : null;
  });
  expect(done.runs.map((r) => r.status)).toEqual(["done", "done"]);
  await until("both done wakes", async () => await said(k, wake_text("session", "qd", "done:")) === 2);
  expect(await said(k, wake_text("session", "qd", "failed:"))).toBe(0);
});

test.concurrent("a holder whose run ended while the server was down is adopted while it waits to be acked, and its end wakes the agent once", async () => {
  const k = await Kny.up();
  const t = tag();
  await fake.next(t + ": work", { what: "tool", calls: [["Bash", { command: gate(t) }]] });
  await fake.next(t + "-done", { what: "reply", text: t + " finished" });
  const s = await k.session("ld", t + ": work", repo());
  await until("the command running", () => waiting(t));
  const holder = s.holder();
  await k.kill();
  s.open(t);
  await until("the run's end logged", () => s.logged().some((x) => x.ev.k === "end"));
  expect(s.holder()).toBe(holder);
  await k.start();

  expect((await s.status("done")).runs).toMatchObject([{ n: 1, status: "done", attempts: 1 }]);
  await until("its holder ended, all it told taken", () => s.holder() === null);
  await until("the done wake", async () => await said(k, wake_text("session", "ld", "done: ") + t + " finished") === 1);
});

test.concurrent("a new server waits for the running one's lock, then takes over its sessions' running holders", async () => {
  const k = await Kny.up();
  const t = tag();
  await fake.next(t + ": work", { what: "tool", calls: [["Bash", { command: gate(t) }]] });
  const s = await k.session("up", t + ": work", repo());
  await until("the command running", () => waiting(t));
  const holder = s.holder();
  const next = k.spawn();
  await Bun.sleep(1000);
  expect(next.exitCode).toBeNull();
  await k.kill("SIGTERM");
  k.proc = next;
  await until("the new server", () => k.up());

  expect((await s.page()).status).toBe("running");
  expect(s.holder()).toBe(holder);
  s.open(t);
  await s.status("done");
  await until("the done wake", async () => await said(k, wake_text("session", "up", "done:")) === 1);
});
