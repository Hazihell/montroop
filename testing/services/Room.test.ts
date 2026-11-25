import { DIR } from "../home.ts";
import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Room } from "../../Room.ts";
import { halt, transient } from "../../Service.ts";
import { Session } from "../../Session.ts";
import { until } from "../rig.ts";

// a subagent's use as its agent is told it: cores and GB now, then at most
const TOLD = /^uses now (\d+\.\d) cores and (\d+\.\d) GB; at most (\d+\.\d) cores and (\d+\.\d) GB so far$/;

test("a running subagent uses what its process tree uses now, and at most what it used at a reading in its run, which is told after the run too, not as a new run's", async () => {
  const id = crypto.randomUUID().slice(0, 8);
  const dir = path.join(DIR, "sessions", id);
  fs.mkdirSync(dir, { recursive: true });
  Session.add({ id, name: "heavy", agent: "agent1", repo: "", base: "", branch: "", worktree: "/scratch/agent1/sessions/heavy", provider: "claude", account: "", model: "claude-haiku-5-5", effort: "low", memory: 0, write: 1, device: "", dir }, "the task");
  const unit = { name: "troop-hold-" + id + "-1", dir };
  Session.set(id, { unit: unit.name });
  const [held, drop, gone] = ["held", "drop", "gone"].map((f) => path.join(dir, f));
  // its shell's child holds 256 MB and keeps a core busy till it's let go
  const child = path.join(dir, "child.ts");
  fs.writeFileSync(child, [
    "const fs = require(\"node:fs\");",
    "const held = Buffer.alloc(256 * 2 ** 20, 1);",
    "fs.writeFileSync(" + JSON.stringify(held) + ", \"\");",
    "for (let i = 0; !fs.existsSync(" + JSON.stringify(drop) + "); i++) held[i % held.length]++;",
  ].join("\n"));
  expect(transient(unit, "a test unit", ["sh", "-c", process.execPath + " " + child + "; touch " + gone + "; sleep 300"], {})).toBeNull();
  try {
    await until("it holds its memory", () => fs.existsSync(held));
    expect(Room.used(id)).toMatch(/^uses now 0\.3 GB \(CPU not measured yet\); at most 0\.3 GB \(CPU not measured yet\) so far$/);
    const busy = await until("its CPU measured", () => TOLD.exec(Room.used(id) ?? ""));
    expect(Number(busy[1])).toBeGreaterThan(0.2);
    expect(busy[2]).toBe("0.3");

    fs.writeFileSync(drop, "");
    await until("its child ended", () => fs.existsSync(gone));
    const after = await until("its child's memory gone", () => {
      const got = TOLD.exec(Room.used(id) ?? "");
      return got?.[2] === "0.0" && got;
    });
    expect(Number(after[3])).toBeGreaterThanOrEqual(Number(busy[1]));
    expect(after[4]).toBe("0.3");

    halt(unit);
    Session.move(id, "stop", "", null);
    expect(await until("its run told as ended", () => Room.used(id)?.startsWith("used ") && Room.used(id))).toBe("used at most " + after[3] + " cores and 0.3 GB in its last run");

    // a new run, its holder not read yet: none of the last run's use is its
    expect(Session.again(id, "go on")).not.toBeNull();
    Session.set(id, { unit: "troop-hold-" + id + "-2" });
    expect(Room.used(id)).toBeNull();
  } finally {
    halt(unit);
  }
});
