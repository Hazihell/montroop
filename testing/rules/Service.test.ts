import { expect, test } from "bun:test";
import { spent } from "../../Service.ts";

test("the CPU time a unit spent between two readings is what each counter grew, a process started since counted whole, one ended not at all", () => {
  expect(spent(new Map([["", 1e6]]), new Map([["", 3e6]]))).toBe(2e6);
  // 1 spent half a second, 3 started and spent 1.5 s, 2 ended
  expect(spent(new Map([["1@5", 2e6], ["2@6", 1e6]]), new Map([["1@5", 2.5e6], ["3@9", 1.5e6]]))).toBe(2e6);
  expect(spent(new Map([["", 5e6]]), new Map([["", 4e6]]))).toBe(0);
});
