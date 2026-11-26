import { afterAll, expect, test } from "bun:test";
import { down, fake, procs, repo, said, tag, Troop, until, type Via } from "../rig.ts";

afterAll(down);

// Claude Code's own question tool, two questions, the second taking
// several picks
function asking(t: string): [string, Record<string, unknown>] {
  return ["AskUserQuestion", { questions: [
    { question: "Which bird " + t + "?", header: "Bird", multiSelect: false, options: [{ label: "heron", description: "tall" }, { label: "wren", description: "small" }] },
    { question: "Which colors " + t + "?", header: "Colors", multiSelect: true, options: [{ label: "red", description: "" }, { label: "blue", description: "" }, { label: "green", description: "" }] },
  ] }];
}

// a session or subagent whose model asks the user, and the card it waits on
async function asked(k: Troop, via: Via, name: string, t: string) {
  await fake.next(t + ": work", { what: "tool", calls: [asking(t)] });
  const s = await k.work(via, name, t + ": work", repo());
  const card = await until("its card", () => k.cards().find((c) => c.input.includes("Which bird " + t)));
  return { s, card };
}

// whether a model request's newest message has text
async function heard(text: string): Promise<boolean> {
  return (await fake.seen(text)).some((x) => x.model !== "");
}

test.concurrent("a question Claude Code asks the user waits on the owner's card, and their picks go back to the model as its answer", async () => {
  const k = await Troop.up();
  const t = tag();
  const { s, card } = await asked(k, "session", "qa", t);

  expect(card.tool).toBe("AskUserQuestion");
  expect((await s.status("waiting")).waits).toBe("question");
  await until("the waiting wake", async () => await said(k, s.woke("waiting: the user's answer in the app, to: Which bird " + t + "? · Which colors " + t + "?")) === 1);
  const answers = { ["Which bird " + t + "?"]: "heron", ["Which colors " + t + "?"]: "red, green" };
  expect((await k.api("POST", "/api/approve", { id: card.id, ok: true, note: "", answers })).status).toBe(200);

  await until("the model told the answers", () => heard('"Which bird ' + t + '?"="heron"'));
  expect(await heard('"Which colors ' + t + '?"="red, green"')).toBe(true);
  await s.status("done");
});

test.concurrent("a question the owner dismisses tells the model it went unanswered", async () => {
  const k = await Troop.up();
  const t = tag();
  const { s, card } = await asked(k, "subagent", "qd", t);

  expect((await k.api("POST", "/api/approve", { id: card.id, ok: false, note: "" })).status).toBe(200);
  const done = await s.status("done");
  expect(done.log.filter((x) => x.ev.k === "result").map((x) => x.ev.text)).toEqual([expect.stringContaining("The user dismissed the question without answering it.")]);
});

test.concurrent("a question still waits on its card across a server restart, and the answer given after it reaches the model", async () => {
  const k = await Troop.up();
  const t = tag();
  const { s } = await asked(k, "subagent", "qr", t);
  await k.kill();
  await k.start();

  const card = await until("its card again", () => k.cards().find((c) => c.input.includes("Which bird " + t)));
  expect((await s.status("waiting")).waits).toBe("question");
  expect((await k.api("POST", "/api/approve", { id: card.id, ok: true, note: "", answers: { ["Which bird " + t + "?"]: "wren", ["Which colors " + t + "?"]: "blue" } })).status).toBe(200);
  await until("the model told the answer", () => heard('"Which bird ' + t + '?"="wren"'));
  await s.status("done");
});

test.concurrent("a session stopped while its question waits takes its card down, and its holder and Claude Code end", async () => {
  const k = await Troop.up();
  const t = tag();
  const { s } = await asked(k, "session", "qs", t);
  const holder = await until("its holder", () => s.holder());

  expect((await k.api("POST", "/api/sessions/" + s.id + "/stop", {})).status).toBe(200);
  await s.status("stopped");
  await until("its card gone", () => !k.cards().some((c) => c.input.includes("Which bird " + t)));
  await until("its holder and Claude Code gone", () => !procs().some((p) => p.pid === holder || p.ppid === holder));
});
