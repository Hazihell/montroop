import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { chat, down, fake, gate, git, Kny, repo, ROOT, said, tag, until, VIAS, waiting } from "../rig.ts";

afterAll(down);

type Log = Array<{ ev: { k: string; text?: string; error?: boolean; input?: string } }>;

// the results its log has with text in them
function results(log: Log, text: string): Log {
  return log.filter((x) => x.ev.k === "result" && x.ev.text?.includes(text) === true);
}

// the earliest model call whose newest message has match, as ms since 1970
// (a summary of its agent's chat aside)
async function asked(match: string): Promise<number> {
  return Math.min(...(await fake.seen(match)).filter((s) => !s.latest.startsWith("Compaction:")).map((s) => Date.parse(s.at)));
}

test.concurrent("the subagent tool is offered, in place of spawn, tell, stop and session, only to an agent whose setting turns it on", async () => {
  const k = await Kny.up();
  const [off, on] = [tag(), tag()];
  await k.tell(off + ": hello");
  await until("its turn", async () => (await fake.seen(off + ": hello")).length > 0);
  await k.api("POST", "/api/agents/" + k.agent, { subagents: true });
  await k.tell(on + ": hello");
  await until("its turn", async () => (await fake.seen(on + ": hello")).length > 0);

  const tools = async (t: string) => (await fake.seen(t + ": hello"))[0].tools.map((n) => n.replace(/^mcp__kunumy__/, "")).filter((n) => ["subagent", "spawn", "tell", "stop", "session"].includes(n)).sort();
  expect(await tools(off)).toEqual(["session", "spawn", "stop", "tell"]);
  expect(await tools(on)).toEqual(["subagent"]);
});

test.concurrent("one with no repo starts with its agent's view, in a folder of its own, and zooms its agent's memory", async () => {
  const k = await Kny.up();
  const t = tag();
  await fake.next(t + ": remember", { what: "reply", text: "Noted." });
  await k.tell(t + ": remember the heron-" + t);
  await until("the agent's answer", async () => (await chat(k)).some((m) => m.text === "Noted."));
  const id = (await chat(k)).findIndex((m) => m.text.startsWith(t + ": remember"));
  await fake.next(t + ": work", { what: "tool", calls: [["zoom", { id, n: 1 }]] });
  const [s] = await k.subagents({ task: t + ": work", name: "mz" });

  const done = await s.status("done");
  expect(done.worktree).toBe(path.join(k.dir, "scratch", k.agent, "sessions", "mz"));
  expect(fs.existsSync(done.worktree)).toBe(true);
  expect(results(done.log, "remember the heron-" + t).map((x) => x.ev.error)).toEqual([false]);
  const first = JSON.stringify((await fake.body(t + ": work") as { messages: unknown[] }).messages[0]);
  expect(first).toContain("<chat>");
  expect(first).toContain("heron-" + t);
  await until("the done wake", async () => await said(k, s.woke("done:")) === 1);
});

test.concurrent("three started at once: the first at once, the others once it has begun to answer, each waking its agent once", async () => {
  const k = await Kny.up();
  const t = tag();
  await fake.next(t + ": one", { what: "stall", ms: 1500 });
  const all = await k.subagents({ task: t + ": one", name: "s1" }, { task: t + ": two", name: "s2" }, { task: t + ": three", name: "s3" });

  await Promise.all(all.map((s) => s.status("done")));
  const one = await asked(t + ": one");
  expect(await asked(t + ": two")).toBeGreaterThanOrEqual(one + 1500);
  expect(await asked(t + ": three")).toBeGreaterThanOrEqual(one + 1500);
  for (const s of all) {
    await until(s.name + "'s done wake", async () => await said(k, s.woke("done:")) === 1);
  }
});

test.concurrent("a review with write false works on a worktree on no branch, its edit tools denied, removed when its run ends", async () => {
  const k = await Kny.up();
  const t = tag();
  const r = repo();
  const file = path.join(k.dir, "scratch", k.agent, "sessions", "rv", "written-" + t);
  await fake.next(t + ": review", { what: "tool", calls: [["Write", { file_path: file, content: "x" }]] });
  const [s] = await k.subagents({ task: t + ": review", name: "rv", repo: r, base: "main", write: false });

  const done = await s.status("done");
  expect(done.log.find((x) => x.ev.k === "result")?.ev).toMatchObject({ error: true });
  await until("its worktree removed", () => !fs.existsSync(done.worktree));
  expect(fs.existsSync(file)).toBe(false);
  expect(git(r, "branch", "--list", "kny/rv")).toBe("");
  await until("the done wake", async () => await said(k, s.woke("done:")) === 1);
});

test.concurrent("a usage limit is waited out in its holder, and it goes on by itself at the reset", async () => {
  const k = await Kny.up();
  const t = tag();
  const reset = Date.now() + 3000;
  await fake.next(t + ": work", { what: "error", kind: "usage-limit", reset });
  const [s] = await k.subagents({ task: t + ": work", name: "ul", memory: false });

  const done = await s.status("done");
  expect(done.runs).toMatchObject([{ n: 1, status: "done", attempts: 1 }]);
  expect(done.log.find((x) => x.ev.k === "end")?.at ?? 0).toBeGreaterThanOrEqual(reset);
  await until("the done wake", async () => await said(k, s.woke("done:")) === 1);
  expect(await said(k, s.woke("failed:"))).toBe(0);
});

// its agent on another vendor, which the limit doesn't stop
test.concurrent("a long usage limit wakes its agent once, and the user's word that it was reset early (resume) has it ask again", async () => {
  const model = "openai-api:gpt-6-luna:low:slow";
  const k = await Kny.up({ vendors: "claude-sub,openai-api", pick: model, compactor: model, agents: model }, ROOT, { openai: "sk-proj-test-" + tag() });
  const t = tag();
  const reset = Date.now() + 3600e3;
  await fake.next(t + ": work", { what: "error", kind: "usage-limit", reset });
  const [s] = await k.subagents({ task: t + ": work", name: "lr", model: "haiku-5.5", memory: false });
  await until("the limit's wake", async () => await said(k, s.woke("waiting: a usage limit, till ")) === 1);
  await fake.lift(reset);
  await fake.next(t + ": it was reset", { what: "tool", calls: [["resume", {}]] });
  await k.tell(t + ": it was reset");

  expect((await s.status("done")).runs).toMatchObject([{ n: 1, status: "done", attempts: 1 }]);
  await until("the done wake", async () => await said(k, s.woke("done:")) === 1);
  expect(await said(k, s.woke("waiting:"))).toBe(1);
});

test.concurrent("one at work through a server restart goes on in the same holder, and wakes its agent once", async () => {
  const k = await Kny.up();
  const t = tag();
  await fake.next(t + ": work", { what: "tool", calls: [["Bash", { command: gate(t) }]] });
  await fake.next(t + "-done", { what: "reply", text: t + " finished" });
  const [s] = await k.subagents({ task: t + ": work", name: "sr", memory: false });
  await until("the command running", () => waiting(t));
  const holder = s.holder();
  await k.kill();
  await k.start();

  expect(s.holder()).toBe(holder);
  s.open(t);
  expect((await s.status("done")).runs).toMatchObject([{ n: 1, status: "done", attempts: 1, report: t + " finished" }]);
  await until("the done wake", async () => await said(k, s.woke("done: ") + t + " finished") === 1);
  expect(await said(k, s.woke("failed:"))).toBe(0);
});

test.concurrent("one on an API key runs Kunumy's loop, and its calls of Kunumy's tools, on a device and on its agent's memory, are answered", async () => {
  const model = "claude-api:haiku-5.5:low:slow";
  const k = await Kny.up({ vendors: "claude-api", pick: model, compactor: model, agents: model }, ROOT, { anthropic: "sk-ant-api03-test-" + tag() });
  const t = tag();
  await k.device("box");
  await fake.next(t + ": work", { what: "tool", calls: [["shell", { device: "box", command: "echo " + t + "-ran" }], ["search", { query: "heron-" + t }]] });
  await fake.next(t + "-ran", { what: "reply", text: t + " finished" });
  const [s] = await k.subagents({ task: t + ": work", name: "ak" });

  const done = await s.status("done");
  expect(results(done.log, t + "-ran").map((x) => x.ev.error)).toEqual([false]);
  expect(results(done.log, "Nothing in this chat matches.").map((x) => x.ev.error)).toEqual([false]);
  expect(new Set((await fake.seen(t + ": work")).map((x) => x.vendor))).toEqual(new Set(["claude-api"]));
  expect(done.runs[0].report).toBe(t + " finished");
});

for (const via of VIAS) {
  test.concurrent(via + ": <scratch> in a rule is the scratch folder of the computer its own tools run on: a delete there (its worktree too) asks no one, one outside it asks", async () => {
    const k = await Kny.up();
    const t = tag();
    const elsewhere = path.join(k.dir, "scratch", "elsewhere-" + t);
    fs.mkdirSync(elsewhere, { recursive: true });
    fs.writeFileSync(path.join(elsewhere, "f"), "x");
    const canary = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "outside-")), "canary.txt");
    fs.writeFileSync(canary, "keep\n");
    const own = path.join(k.dir, "scratch", k.agent, "sessions", "sc", "README.md");
    await fake.next(t + ": work", { what: "tool", calls: [["Bash", { command: "rm -f " + path.join(elsewhere, "f") + " " + own + " && echo " + t + "-gone" }]] });
    await fake.next(t + "-gone", { what: "tool", calls: [["Bash", { command: "rm -f " + canary }]] });
    const s = await k.work(via, "sc", t + ": work", repo());
    const card = await until("the canary's card", () => k.cards().find((c) => c.input.includes(canary)));
    expect((await k.api("POST", "/api/approve", { id: card.id, ok: false, note: "" })).status).toBe(200);

    const done = await s.status("done");
    expect(fs.existsSync(path.join(elsewhere, "f"))).toBe(false);
    expect(fs.existsSync(own)).toBe(false);
    expect(fs.existsSync(canary)).toBe(true);
    expect(done.log.filter((x) => x.ev.k === "ask").map((x) => (x.ev as { input?: Record<string, unknown> }).input?.command)).toEqual(["rm -f " + canary]);
  });
}
