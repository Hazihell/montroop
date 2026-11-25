import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { chat, down, fake, gate, git, Troop, repo, ROOT, said, SUB, tag, until, VIAS, waiting } from "../rig.ts";

afterAll(down);

type Log = Array<{ ev: { k: string; text?: string; error?: boolean; input?: string } }>;

// the results its log has with text in them
function results(log: Log, text: string): Log {
  return log.filter((x) => x.ev.k === "result" && x.ev.text?.includes(text) === true);
}

// the earliest model call whose newest message has match, as ms since 1970
async function asked(match: string): Promise<number> {
  return Math.min(...(await fake.seen(match)).map((s) => Date.parse(s.at)));
}

// its chat on claude-sub, which lists Montroop's tools through Claude Code
test.concurrent("the subagent tool is offered, in place of spawn, tell, stop and session, only to an agent whose setting turns it on", async () => {
  const k = await Troop.up(SUB);
  const [off, on] = [tag(), tag()];
  await k.tell(off + ": hello");
  await until("its turn", async () => (await fake.seen(off + ": hello")).length > 0);
  await k.api("POST", "/api/agents/" + k.agent, { subagents: true });
  await k.tell(on + ": hello");
  await until("its turn", async () => (await fake.seen(on + ": hello")).length > 0);

  const tools = async (t: string) => (await fake.seen(t + ": hello"))[0].tools.map((n) => n.replace(/^mcp__montroop__/, "")).filter((n) => ["subagent", "spawn", "tell", "stop", "session"].includes(n)).sort();
  expect(await tools(off)).toEqual(["session", "spawn", "stop", "tell"]);
  expect(await tools(on)).toEqual(["subagent"]);
});

// its chat on claude-sub, which calls Montroop's subagent tool through Claude Code
test.concurrent("one with no repo starts with its agent's view, in a folder of its own, and zooms its agent's memory", async () => {
  const k = await Troop.up(SUB);
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
  const k = await Troop.up();
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
  const k = await Troop.up();
  const t = tag();
  const r = repo();
  const file = path.join(k.dir, "scratch", k.agent, "sessions", "rv", "written-" + t);
  await fake.next(t + ": review", { what: "tool", calls: [["Write", { file_path: file, content: "x" }]] });
  const [s] = await k.subagents({ task: t + ": review", name: "rv", repo: r, base: "main", write: false });

  const done = await s.status("done");
  expect(done.log.find((x) => x.ev.k === "result")?.ev).toMatchObject({ error: true });
  await until("its worktree removed", () => !fs.existsSync(done.worktree));
  expect(fs.existsSync(file)).toBe(false);
  expect(git(r, "branch", "--list", "troop/rv")).toBe("");
  await until("the done wake", async () => await said(k, s.woke("done:")) === 1);
});

test.concurrent("one given a branch works on that new branch, its start says so, and archive removes it", async () => {
  const k = await Troop.up();
  const t = tag();
  const r = repo();
  const branch = "feat/" + t + "-named";
  const [s] = await k.subagents({ task: t + ": work", name: "nb", repo: r, base: "main", branch });

  await s.status("done");
  expect(git(s.worktree, "symbolic-ref", "--short", "HEAD")).toBe(branch);
  expect(git(r, "branch", "--list", "troop/nb")).toBe("");
  expect(await fake.seen("branch " + branch + " in " + r + ")")).not.toEqual([]);
  await fake.next(t + ": archive", { what: "tool", calls: [["subagent", { action: "archive", name: "nb" }]] });
  await k.tell(t + ": archive");
  await until("its branch removed", () => git(r, "branch", "--list", branch) === "");
});

test.concurrent("a start with a task whose branch can't be made starts none of its tasks, and says why", async () => {
  const k = await Troop.up();
  await k.api("POST", "/api/agents/" + k.agent, { subagents: true });
  const t = tag();
  const r = repo();
  const linked = path.join(path.dirname(r), "linked");
  git(r, "worktree", "add", "-q", "-b", "side-" + t, linked, "main");
  git(r, "branch", "troop/kept", "main");
  const fine = { task: t + ": fine", name: "fine", repo: r, base: "main" };
  const starts: Array<[Array<Record<string, unknown>>, string]> = [
    [[fine, { task: t + ": kept", name: "kept", repo: r }], "Task 2 (\"" + t + ": kept\"): The repo has a branch troop/kept already"],
    [[fine, { task: t + ": invalid", repo: r, branch: "bad.." + t }], "Task 2 (\"" + t + ": invalid\"): bad.." + t + " is no valid branch name"],
    [[fine, { task: t + ": twice", repo: r, branch: "troop/fine" }], "Task 2 (\"" + t + ": twice\"): another of these tasks works on branch troop/fine in this repo already: give each its own. Nothing started."],
    [[{ task: t + ": here", repo: r, branch: "feat/" + t }, { task: t + ": linked", repo: linked, branch: "feat/" + t }], "Task 2 (\"" + t + ": linked\"): another of these tasks works on branch feat/" + t + " in this repo already: give each its own. Nothing started."],
    [[{ task: t + ": parent", repo: r, branch: "feat/" + t }, { task: t + ": child", repo: r, branch: "feat/" + t + "/more" }], "Task 2 (\"" + t + ": child\"): another of these tasks works on branch feat/" + t + " in this repo, so git can't keep feat/" + t + "/more beside it: pick another name. Nothing started."],
    [[{ task: t + ": review", repo: r, write: false, branch: "feat/" + t }], "Task 1 (\"" + t + ": review\"): branch needs write true: with write false it works on no branch. Nothing started."],
    [[{ task: t + ": folder", branch: "feat/" + t }], "Task 1 (\"" + t + ": folder\"): branch needs a repo: without one it works in a folder of its own. Nothing started."],
  ];
  await fake.next(t + ": start", { what: "tool", calls: starts.map(([tasks]) => ["subagent", { action: "start", tasks: tasks.map((x) => ({ model: "haiku-5.5", ...x })) }]) });
  await k.tell(t + ": start");

  const told = await until("the starts' answers", async () => (await fake.last("(\"" + t + ": ")).map((m) => m.text).join("\n") || null);
  for (const [, why] of starts) {
    expect(told).toContain(why);
  }
  expect((await k.api("GET", "/api/sessions?agent=" + k.agent)).json as unknown).toEqual([]);
  expect(git(r, "branch", "--format=%(refname:short)").split("\n")).toEqual(["main", "side-" + t, "troop/kept"]);
});

test.concurrent("a review stopped mid-run has its worktree removed once its holder has ended", async () => {
  const k = await Troop.up();
  const t = tag();
  await fake.next(t + ": review", { what: "tool", calls: [["Bash", { command: gate(t) }]] });
  const [s] = await k.subagents({ task: t + ": review", name: "rs", repo: repo(), base: "main", write: false });
  await until("the command running", () => waiting(t));
  expect((await k.api("POST", "/api/sessions/" + s.id + "/stop", {})).status).toBe(200);

  await until("its worktree removed", () => !fs.existsSync(s.worktree));
  expect(waiting(t)).toBe(false);
});

test.concurrent("one lists with its task, model and effort, and how full its context was at its latest request", async () => {
  const k = await Troop.up();
  const t = tag();
  await fake.next(t + ": count the herons", { what: "reply", text: "Twelve.", used: { input: 1200, read: 30000, write: 800 } });
  const [s] = await k.subagents({ task: t + ": count the herons", name: "ls", model: "haiku-5.5", effort: "low", memory: false });

  expect(await s.status("done")).toMatchObject({ task: t + ": count the herons", model: "haiku-5.5", effort: "low", meter: { tokens: 32000, window: 1e6 } });
});

test.concurrent("one waiting out a usage limit lists as waiting on it, with its reset, till it is stopped, and not once resumed", async () => {
  const k = await Troop.up();
  const t = tag();
  const reset = Date.now() + 3600e3;
  await fake.next(t + ": work", { what: "error", kind: "usage-limit", reset });
  const [s] = await k.subagents({ task: t + ": work", name: "lw", memory: false });

  const parked = await until("it waits on the limit", async () => {
    const p = await s.page();
    return p.waits === "limit" ? p : null;
  });
  expect(parked).toMatchObject({ status: "running", meter: null });
  // the reset as Claude Code tells it, in whole seconds
  expect(Math.abs((parked.until ?? 0) - reset)).toBeLessThan(1000);
  expect((await k.api("POST", "/api/sessions/" + s.id + "/stop", {})).status).toBe(200);
  expect(await s.status("stopped")).toMatchObject({ waits: null, until: null });
  await fake.lift(reset);
  await fake.next(t + ": work", { what: "stall", ms: 3000 });
  await until("its holder gone", () => s.holder() === null);
  expect((await k.api("POST", "/api/sessions/" + s.id + "/resume", {})).status).toBe(200);

  expect(await s.status("running")).toMatchObject({ waits: null, until: null });
});

test.concurrent("a usage limit is waited out in its holder, and it goes on by itself at the reset", async () => {
  const k = await Troop.up();
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

test.concurrent("a long usage limit wakes its agent once, and the user's word that it was reset early (resume) has it ask again", async () => {
  const k = await Troop.up();
  const t = tag();
  const reset = Date.now() + 3600e3;
  await fake.next(t + ": work", { what: "error", kind: "usage-limit", reset });
  const [s] = await k.subagents({ task: t + ": work", name: "lr", memory: false });
  await until("the limit's wake", async () => await said(k, s.woke("waiting: a usage limit, till ")) === 1);
  await fake.lift(reset);
  await fake.next(t + ": it was reset", { what: "tool", calls: [["resume", {}]] });
  await k.tell(t + ": it was reset");

  expect((await s.status("done")).runs).toMatchObject([{ n: 1, status: "done", attempts: 1 }]);
  await until("the done wake", async () => await said(k, s.woke("done:")) === 1);
  expect(await said(k, s.woke("waiting:"))).toBe(1);
});

test.concurrent("one at work through a server restart goes on in the same holder, and wakes its agent once", async () => {
  const k = await Troop.up();
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

test.concurrent("one on an API key runs Montroop's loop, and its calls of Montroop's tools, on a device and on its agent's memory, are answered; its latest request's tokens make its meter", async () => {
  const model = "claude-api:haiku-5.5:low:slow";
  const k = await Troop.up({ vendors: "claude-api", pick: model, compactor: model }, ROOT, { anthropic: "sk-ant-api03-test-" + tag() });
  const t = tag();
  await k.device("box");
  await fake.next(t + ": work", { what: "tool", calls: [["shell", { device: "box", command: "echo " + t + "-ran" }], ["search", { query: "heron-" + t }]] });
  await fake.next(t + "-ran", { what: "reply", text: t + " finished", used: { input: 900, read: 40000, write: 600 } });
  const [s] = await k.subagents({ task: t + ": work", name: "ak" });

  const done = await s.status("done");
  expect(results(done.log, t + "-ran").map((x) => x.ev.error)).toEqual([false]);
  expect(results(done.log, "Nothing in this chat matches.").map((x) => x.ev.error)).toEqual([false]);
  expect(new Set((await fake.seen(t + ": work")).map((x) => x.vendor))).toEqual(new Set(["claude-api"]));
  expect(done.runs[0].report).toBe(t + " finished");
  expect(done.meter).toEqual({ tokens: 41500, window: 1e6 });
});

for (const via of VIAS) {
  test.concurrent(via + ": <scratch> in a rule is the scratch folder of the computer its own tools run on: a delete there (its worktree too) asks no one, one outside it asks", async () => {
    const k = await Troop.up();
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

// what the computer is told as, with whatever numbers it has now
const FACTS = /\d+ cores, \d+% busy; memory \d+\.\d GB available of \d+\.\d GB; /;

test.concurrent("the subagent tool starts every task it's given, however many, an old config's most at once ignored, and its start and list tell the computer's resources", async () => {
  const k = await Troop.up({ submons: 1 });
  await k.api("POST", "/api/agents/" + k.agent, { subagents: true });
  const t = tag();
  const names = Array.from({ length: 11 }, (_, n) => "w" + n + "-" + t);
  await fake.next(t + ": start", { what: "tool", calls: [["subagent", { action: "start", tasks: names.map((name) => ({ task: t + ": " + name, name, model: "gpt-6-luna", memory: false })) }]] });
  await fake.next("Started w0-" + t, { what: "tool", calls: [["subagent", { action: "list" }]] });
  await k.tell(t + ": start");

  const started = await until("the start", async () => (await fake.last("Started w0-" + t)).at(-1)?.text);
  expect(started).toStartWith("Started w0-" + t + " (gpt-6-luna");
  expect(started).toMatch(new RegExp("This computer now: " + FACTS.source));
  const listed = await until("the list", async () => (await fake.last("w10-" + t + ": ")).at(-1)?.text);
  expect(listed).toMatch(new RegExp("This computer: " + FACTS.source));
  expect(((await k.api("GET", "/api/sessions?agent=" + k.agent)).json as unknown as Array<{ name: string }>).map((x) => x.name).sort()).toEqual([...names].sort());
});

test.concurrent("a mon whose subagents run on the engine is told to split work into subagents and judge how many from the computer's resources, which each turn tells; one whose don't, to use them only when asked", async () => {
  const k = await Troop.up();
  const [off, on] = [tag(), tag()];
  await k.tell(off + ": hello");
  await until("its turn", async () => (await fake.seen(off + ": hello")).length > 0);
  await k.api("POST", "/api/agents/" + k.agent, { subagents: true });
  await k.tell(on + ": hello");
  await until("its turn", async () => (await fake.seen(on + ": hello")).length > 0);

  const asked = async (t: string) => JSON.stringify(await fake.body(t + ": hello"));
  expect(await asked(off)).toContain("Use subagents only when the user asks for them.");
  expect(await asked(off)).not.toContain("This computer as this turn started");
  expect(await asked(on)).not.toContain("Use subagents only when the user asks for them.");
  expect(await asked(on)).toContain("Split large or parallel work into subagents:");
  expect(await asked(on)).toContain("How many to start is your judgment.");
  expect(await asked(on)).toMatch(new RegExp("This computer as this turn started: " + FACTS.source));
});
