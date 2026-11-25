import { expect, test } from "bun:test";
import { Wire } from "../../Wire.ts";

function cut(chunks: string[]): Array<Record<string, unknown>> {
  const got: Array<Record<string, unknown>> = [];
  const take = Wire.lines((msg) => got.push(msg));
  chunks.forEach(take);
  return got;
}

test("a message that arrives in pieces is read once it's whole", () => {
  expect(cut(["{\"$\":\"ack\",", "\"seq\":4}", "\n"])).toEqual([{ $: "ack", seq: 4 }]);
});

test("several messages in one piece are read in order", () => {
  expect(cut(["{\"$\":\"ack\",\"seq\":1}\n{\"$\":\"ack\",\"seq\":2}\n{\"$\":\"hel"])).toEqual([{ $: "ack", seq: 1 }, { $: "ack", seq: 2 }]);
});

test("a line that is no JSON object is dropped", () => {
  expect(cut(["garbage\n[1,2]\n\"text\"\nnull\n{\"$\":\"ack\",\"seq\":3}\n"])).toEqual([{ $: "ack", seq: 3 }]);
});

test("what a holder tells is numbered on from where its log left off, and kept till acked", () => {
  const box = Wire.outbox(7);
  Wire.push(box, { k: "text", text: "a" }, 100);
  Wire.push(box, { k: "text", text: "b" }, 200);
  Wire.push(box, { k: "turn", ok: true, text: "b" }, 300);
  Wire.ack(box, 9);
  expect(box).toEqual({ seq: 10, kept: [{ seq: 10, at: 300, ev: { k: "turn", ok: true, text: "b" } }] });
});

test("an ack older than what was acked keeps nothing back", () => {
  const box = Wire.outbox(0);
  Wire.push(box, { k: "text", text: "a" }, 1);
  Wire.ack(box, 1);
  Wire.ack(box, 0);
  expect(box.kept).toEqual([]);
});

test("a text told is cut to 2000 characters", () => {
  expect(Wire.clip("x".repeat(2000))).toBe("x".repeat(2000));
  expect(Wire.clip("x".repeat(2001))).toBe("x".repeat(2000) + "…");
});
