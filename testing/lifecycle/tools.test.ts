import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { TOOLS } from "../../Wire.ts";
import { chat, down, fake, gate, Troop, older, procs, repo, tag, until, VIAS, waiting } from "../rig.ts";

afterAll(down);

type Log = Array<{ ev: { k: string; text?: string } }>;

// the results the session's log has with text in them
function results(log: Log, text: string): Log {
  return log.filter((x) => x.ev.k === "result" && x.ev.text?.includes(text) === true);
}

for (const via of VIAS) {
  test.concurrent(via + ": Montroop's shell runs on a device, in its agent's scratch folder there, a delete inside it asking no one", async () => {
    const k = await Troop.on(via);
    const t = tag();
    const box = await k.device("box");
    const mine = path.join(box.scratch, k.agent);
    await fake.next(t + ": work", { what: "tool", calls: [["shell", { device: "box", command: "touch gone-" + t + " && rm -f " + mine + "/gone-" + t + " && pwd && echo " + t + "-ran" }]] });
    await fake.next(t + "-ran", { what: "reply", text: t + " done" });
    const s = await k.work(via, "sh", t + ": work", repo());

    const done = await s.status("done");
    const ran = results(done.log, t + "-ran");
    expect(ran).toHaveLength(1);
    expect(ran[0].ev.text).toStartWith(mine + "\n" + t + "-ran\n(exit 0 in ");
    expect(fs.existsSync(path.join(mine, "gone-" + t))).toBe(false);
    expect(k.cards()).toEqual([]);
  });

  test.concurrent(via + ": Montroop's search finds its agent's chat", async () => {
    const k = await Troop.on(via);
    const t = tag();
    await fake.next(t + ": remember", { what: "reply", text: "Noted." });
    await k.tell(t + ": remember the heron-" + t);
    await until("the agent's answer", async () => (await chat(k)).some((m) => m.text === "Noted."));
    await fake.next(t + ": work", { what: "tool", calls: [["search", { query: "heron-" + t }]] });
    await fake.next("remember the heron-" + t, { what: "reply", text: t + " found" });
    const s = await k.work(via, "se", t + ": work", repo(), { memory: true });

    const done = await s.status("done");
    expect(results(done.log, "remember the heron-" + t)).toHaveLength(1);
    expect(k.cards()).toEqual([]);
  });

  test.concurrent(via + ": a server killed in the middle of its shell call on a device gives it the result once it's back, the command run once", async () => {
    const k = await Troop.on(via);
    const t = tag();
    const box = await k.device("box");
    const go = path.join(box.home, "go-" + t);
    const count = path.join(box.home, "count-" + t);
    await fake.next(t + ": work", { what: "tool", calls: [["shell", { device: "box", command: "until [ -f " + go + " ]; do sleep 0.05; done; echo once >> " + count + "; echo " + t + "-ran" }]] });
    await fake.next(t + "-ran", { what: "reply", text: t + " done" });
    const s = await k.work(via, "kc", t + ": work", repo());
    const running = () => procs().some((p) => p.cmd.includes("until [ -f " + go + " ]"));
    await until("the command running", running);
    await k.kill();
    box.forget();
    await k.start();
    await until("the device back", () => box.used());
    expect(running()).toBe(true);
    fs.writeFileSync(go, "");

    const done = await s.status("done");
    expect(results(done.log, t + "-ran")).toHaveLength(1);
    expect(fs.readFileSync(count, "utf8")).toBe("once\n");
  });

  test.concurrent(via + ": its shell call on a device that an ask rule names waits in its holder across a server restart, and runs once approved", async () => {
    const k = await Troop.on(via, { ask: [{ what: "Count something", tools: "shell", args: "count-" }] });
    const t = tag();
    const box = await k.device("box");
    const count = path.join(box.home, "count-" + t);
    await fake.next(t + ": work", { what: "tool", calls: [["shell", { device: "box", command: "echo once >> " + count + " && echo " + t + "-ran" }]] });
    await fake.next(t + "-ran", { what: "reply", text: t + " done" });
    const s = await k.work(via, "gk", t + ": work", repo());
    expect((await s.status("waiting")).waits).toBe("approval");
    await k.kill();
    await k.start();

    const back = await s.page();
    expect([back.status, back.waits, back.parked.map((p) => p.tool)]).toEqual(["waiting", "approval", ["shell"]]);
    expect(fs.existsSync(count)).toBe(false);
    const card = await until("its card", () => k.cards().find((c) => c.input.includes(count)));
    expect((await k.api("POST", "/api/approve", { id: card.id, ok: true, note: "" })).status).toBe(200);
    const done = await s.status("done");
    expect(results(done.log, t + "-ran")).toHaveLength(1);
    expect(fs.readFileSync(count, "utf8")).toBe("once\n");
  });
}

test.concurrent("a session's call of Montroop's tools while a server from before they ran in sessions owns its holder is told that server runs none", async () => {
  const k = await Troop.up();
  const t = tag();
  await fake.next(t + ": work", { what: "tool", calls: [["Bash", { command: gate(t) }]] });
  await fake.next(t + "-done", { what: "tool", calls: [["search", { query: "heron-" + t }]] });
  const s = await k.session("ol", t + ": work", repo());
  await until("the command running", () => waiting(t));
  await k.kill();
  k.root = older(TOOLS);
  await k.start();
  s.open(t);

  const done = await s.status("done");
  expect(results(done.log, "runs no tools for work sessions")).toHaveLength(1);
});

test.concurrent("a session's call of Montroop's tools approved under a server from before they ran in sessions is told that server runs none", async () => {
  const k = await Troop.up({ ask: [{ what: "Zoom", tools: "zoom", args: "" }] });
  const t = tag();
  await fake.next(t + ": work", { what: "tool", calls: [["zoom", { id: 1 }]] });
  const s = await k.session("oa", t + ": work", repo());
  await s.status("waiting");
  await k.kill();
  k.root = older(TOOLS);
  await k.start();
  const card = await until("its card", () => k.cards()[0]);
  expect((await k.api("POST", "/api/approve", { id: card.id, ok: true, note: "" })).status).toBe(200);

  const done = await s.status("done");
  expect(results(done.log, "runs no tools for work sessions")).toHaveLength(1);
});

test.concurrent("a chain of messages between two mons goes on as long as they send them, a hops setting left in the config ignored", async () => {
  const k = await Troop.up({ hops: 1 });
  const t = tag();
  const other = ((await k.api("POST", "/api/agents", { name: "Other", about: "Another agent.", prompt: "You are Other." })).json as { agent: { id: string } }).agent.id;
  const to = (n: number) => (n % 2 === 1 ? "Other" : "Montroop");
  await fake.next(t + ": start the chain", { what: "tool", calls: [["message", { agent: "Other", text: t + "-m1" }]] });
  for (let n = 1; n < 7; n++) {
    await fake.next(t + "-m" + n, { what: "tool", calls: [["message", { agent: to(n + 1), text: t + "-m" + (n + 1) }]] });
  }
  await k.tell(t + ": start the chain");

  const landed = async (agent: string) => (await chat(k, agent)).filter((m) => m.kind === "work" && m.text.includes(t + "-m")).map((m) => m.text.match(/-m(\d)/)?.[1]);
  await until("the 7th message", async () => (await landed(other)).includes("7"));
  expect(await landed(other)).toEqual(["1", "3", "5", "7"]);
  expect(await landed(k.agent)).toEqual(["2", "4", "6"]);
});
