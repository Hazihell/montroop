import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Gate, type Asked } from "../../Gate.ts";

const PUSH = { command: "git push --force origin main" };
const WHAT = "Delete files or data outside the scratch folder";

function opened(): { file: string; gate: Gate } {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gate-")), "asks.json");
  return { file, gate: Gate.open(file, () => {}) };
}

function ask(gate: Gate, args: Record<string, unknown> = PUSH, signal = new AbortController().signal): { said: ReturnType<typeof Gate.wait>; cards: Asked[] } {
  const cards: Asked[] = [];
  const said = Gate.wait(gate, "agent1", "Subagent fix", "subagent", "shell", args, WHAT, signal, (a) => cards.push(a));
  return { said, cards };
}

test("a call a rule names waits for the owner's answer", async () => {
  const { gate } = opened();
  const { said, cards } = ask(gate);
  expect(cards.map((c) => [c.who, c.tool, c.input, c.what])).toEqual([["Subagent fix", "shell", "{\"command\":\"git push --force origin main\"}", WHAT]]);
  expect(Gate.decide(gate, cards[0].id, { ok: true, note: "once" })).toMatchObject({ waited: true });
  expect(await said).toEqual({ ok: true, note: "once" });
});

test("an answer counts once", () => {
  const { gate } = opened();
  const { cards } = ask(gate);
  expect(Gate.decide(gate, cards[0].id, { ok: false, note: "" })).not.toBeNull();
  expect(Gate.decide(gate, cards[0].id, { ok: true, note: "" })).toBeNull();
});

test("a card is kept across a restart, and the same call waits on it again", async () => {
  const { file, gate } = opened();
  const first = ask(gate).cards[0];
  const again = Gate.open(file, () => {});
  expect(Gate.shown(again, "agent1").map((c) => c.id)).toEqual([first.id]);
  const { said, cards } = ask(again);
  expect(cards).toEqual([]);
  Gate.decide(again, first.id, { ok: false, note: "" });
  expect(await said).toEqual({ ok: false, note: "" });
});

test("a yes given while no call waits holds for the same caller's next same call, and only that", async () => {
  const { file, gate } = opened();
  const card = ask(gate).cards[0];
  const again = Gate.open(file, () => {});
  expect(Gate.decide(again, card.id, { ok: true, note: "go" })).toMatchObject({ waited: false });
  expect(ask(again, { command: "git push --force origin other" }).cards).toHaveLength(1);
  const { said, cards } = ask(again);
  expect(cards).toEqual([]);
  expect(await said).toEqual({ ok: true, note: "go" });
});

test("a no given while no call waits is dropped: the next same call asks anew", () => {
  const { file, gate } = opened();
  const card = ask(gate).cards[0];
  const again = Gate.open(file, () => {});
  Gate.decide(again, card.id, { ok: false, note: "" });
  expect(ask(again).cards).toHaveLength(1);
});

test("a call stopped while it waits takes its card down", async () => {
  const { gate } = opened();
  const stop = new AbortController();
  const { said } = ask(gate, PUSH, stop.signal);
  stop.abort();
  expect(await said).toBeNull();
  expect(Gate.shown(gate, "agent1")).toEqual([]);
});

test("the answers to a question given while no call waits come with the yes its next same call gets", async () => {
  const { file, gate } = opened();
  const questions = { questions: [{ question: "Which bird?", header: "Bird", options: [{ label: "heron", description: "" }, { label: "wren", description: "" }], multiSelect: false }] };
  const card = ask(gate, questions).cards[0];
  const again = Gate.open(file, () => {});
  Gate.decide(again, card.id, { ok: true, note: "", answers: { "Which bird?": "heron" } });
  expect(await ask(again, questions).said).toEqual({ ok: true, note: "", answers: { "Which bird?": "heron" } });
});
