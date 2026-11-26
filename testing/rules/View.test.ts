import { expect, test } from "bun:test";
import { asker } from "../../View.ts";

test("the owner reads a subagent that asks as a submon", () => {
  expect(asker({ who: "Subagent tally", from: "subagent" })).toBe("Submon tally");
});
