import { expect, test } from "bun:test";
import { wake_read, wake_relayed, wake_text } from "../../Wake.ts";

test("a wake names its sender in brackets: a tag and name, a timer's and a subagent's text on the next line", () => {
  expect(wake_text("session", "fix", "done: ok")).toBe("[Session fix] done: ok");
  expect(wake_text("subagent", "scout", "question: Which one?")).toBe("[Subagent scout] question: Which one?");
  expect(wake_text("timer", "t1", "Water the plants.")).toBe("[Timer t1]\nWater the plants.");
  expect(wake_text("sub", "scout", "Found it.")).toBe("[scout]\nFound it.");
  expect(wake_text("agent", "Ops", "Deployed.")).toBe("[Ops] Deployed.");
});

test("a wake read back gives its kind, sender and text; a subagent's or agent's has no kind", () => {
  expect(wake_read("[Session fix] done: ok\n")).toEqual({ kind: "session", who: "Session fix", text: "done: ok" });
  expect(wake_read("[Subagent scout] failed: no model")).toEqual({ kind: "subagent", who: "Subagent scout", text: "failed: no model" });
  expect(wake_read("[scout]\nFound it.")).toEqual({ kind: null, who: "scout", text: "Found it." });
  expect(wake_read("no brackets")).toBeNull();
});

test("a job's wake relayed to another chat says whose job it is", () => {
  expect(wake_relayed("[Job build] done: ok", "Ops")).toBe("[Job build] Ops's job, done: ok");
});
