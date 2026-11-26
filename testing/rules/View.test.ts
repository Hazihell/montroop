import { expect, test } from "bun:test";
import { asker } from "../../View.ts";

test("the owner reads a work session or subagent that asks as a submon", () => {
  expect(asker({ who: "Session typo", from: "session" })).toBe("Submon typo");
  expect(asker({ who: "Subagent tally", from: "session" })).toBe("Submon tally");
});
