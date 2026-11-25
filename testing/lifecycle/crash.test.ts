import { expect, test } from "bun:test";
import { fake, kill, Kny, procs, repo, running, said, until } from "../rig.ts";

const GONE = "its holder ended before the run did";

test.concurrent("a holder killed mid-run fails the run once, leaves nothing of it running, and a resume finishes it", async () => {
  const k = await Kny.up();
  await fake.next("hk: work", { what: "tool", calls: [["Bash", { command: "echo start && sleep 41 && echo end" }]] });
  const s = await k.session("hk", "hk: work", repo());
  await until("the command running", () => running(/^sleep 41$/).length > 0);
  const holder = s.holder();
  kill(holder);

  expect((await s.status("failed")).runs[0].why).toBe(GONE);
  await until("nothing of the holder left", () => procs().every((p) => p.group !== holder));
  expect(running(/^sleep 41$/)).toEqual([]);
  expect((await k.api("POST", "/api/sessions/" + s.id + "/resume", {})).status).toBe(200);
  expect((await s.status("done")).runs).toMatchObject([{ n: 1, status: "done", attempts: 2 }]);
  await until("the done wake", async () => await said(k, "[Session hk] done:") === 1);
  expect(await said(k, "[Session hk] failed: " + GONE)).toBe(1);
  await k.kill();
});

test.concurrent("Claude Code killed under its holder fails the run, its holder exits, and a resume finishes it", async () => {
  const k = await Kny.up();
  await fake.next("cc: work", { what: "tool", calls: [["Bash", { command: "echo start && sleep 42 && echo end" }]] });
  const s = await k.session("cc", "cc: work", repo());
  await until("the command running", () => running(/^sleep 42$/).length > 0);
  const holder = s.holder();
  kill(procs().find((p) => p.ppid === holder)?.pid);

  expect((await s.status("failed")).runs[0].why).toBe("Claude Code process terminated by signal SIGKILL");
  await until("nothing of the holder left", () => procs().every((p) => p.group !== holder));
  expect(running(/^sleep 42$/)).toEqual([]);
  expect((await k.api("POST", "/api/sessions/" + s.id + "/resume", {})).status).toBe(200);
  await s.status("done");
  await until("the done wake", async () => await said(k, "[Session cc] done:") === 1);
  expect(await said(k, "[Session cc] failed:")).toBe(1);
  await k.kill();
});

test.concurrent("a question asked while the server is down reaches it once it's back, and is answered; each wake comes once across restarts", async () => {
  const k = await Kny.up();
  await fake.next("q: work", { what: "tool", calls: [["Bash", { command: "sleep 2.1 && echo q-slept" }]] });
  await fake.next("q-slept", { what: "tool", calls: [["ask_owner", { question: "Which word should it be?" }]] });
  await fake.next("The answer: heron", { what: "reply", text: "It is heron." });
  const s = await k.session("q", "q: work", repo());
  await until("the command running", () => running(/^sleep 2.1$/).length > 0);
  await k.kill();
  await until("the question asked", () => s.logged().some((t) => t.ev.k === "question"));
  await k.start();

  const waiting = await s.status("waiting");
  expect(waiting.waits).toBe("answer");
  expect(waiting.questions.map((q) => q.text)).toEqual(["Which word should it be?"]);
  expect((await s.say("heron", "ans-1")).status).toBe(200);
  await s.status("done");
  await until("the done wake", async () => await said(k, "[Session q] done: It is heron.") === 1);
  await k.kill();
  await k.start();
  await Bun.sleep(1000);
  expect(await said(k, "[Session q] question: Which word should it be?")).toBe(1);
  expect(await said(k, "[Session q] done:")).toBe(1);
  await k.kill();
});

test.concurrent("a run that ends while the server is down is taken from its log at the next start, and the message queued for it runs next", async () => {
  const k = await Kny.up();
  await fake.next("qd: work", { what: "tool", calls: [["Bash", { command: "sleep 2.2 && echo qd-slept" }]] });
  const s = await k.session("qd", "qd: work", repo());
  await until("the command running", () => running(/^sleep 2.2$/).length > 0);
  expect((await s.say("qd: next", "q-1", "queue")).json.sent).toBe("Queued: it starts the session's next run once this one ends.");
  await k.kill();
  await until("the run's end logged", () => s.logged().some((t) => t.ev.k === "end"));
  kill(s.holder());
  await k.start();

  const done = await until("the queued message's run done", async () => {
    const p = await s.page();
    return p.status === "done" && p.runs.length === 2 ? p : null;
  });
  expect(done.runs.map((r) => r.status)).toEqual(["done", "done"]);
  await until("both done wakes", async () => await said(k, "[Session qd] done:") === 2);
  expect(await said(k, "[Session qd] failed:")).toBe(0);
  await k.kill();
});

test.concurrent("a new server waits for the running one's lock, then takes over its sessions' holders", async () => {
  const k = await Kny.up();
  await fake.next("up: work", { what: "tool", calls: [["Bash", { command: "sleep 3.1 && echo up-slept" }]] });
  const s = await k.session("up", "up: work", repo());
  await until("the command running", () => running(/^sleep 3.1$/).length > 0);
  const next = k.spawn();
  await Bun.sleep(1000);
  expect(next.exitCode).toBeNull();
  await k.kill("SIGTERM");
  k.proc = next;
  await until("the new server", () => k.up());

  await s.status("done");
  await until("the done wake", async () => await said(k, "[Session up] done:") === 1);
  await k.kill();
});
