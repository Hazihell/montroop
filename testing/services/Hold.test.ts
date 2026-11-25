import "../home.ts";
import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Hold } from "../../Hold.ts";

const line = (seq: number, text: string) => JSON.stringify({ seq, at: seq, ev: { k: "text", text } });

test("a session's log reads as what its holder told, a line cut short left out till it's whole", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hold-"));
  const log = path.join(dir, "log.jsonl");
  const third = line(3, "three");
  fs.writeFileSync(log, line(1, "one") + "\nnot json\n" + line(2, "two") + "\n" + third.slice(0, 10));
  expect(Hold.told(dir).map((t) => t.seq)).toEqual([1, 2]);
  fs.appendFileSync(log, third.slice(10) + "\n");
  expect(Hold.told(dir).map((t) => t.ev)).toEqual([{ k: "text", text: "one" }, { k: "text", text: "two" }, { k: "text", text: "three" }]);
});

test("a session with no log yet has told nothing", () => {
  expect(Hold.told(fs.mkdtempSync(path.join(os.tmpdir(), "hold-")))).toEqual([]);
});
