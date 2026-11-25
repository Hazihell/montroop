import "../home.ts";
import { beforeEach, expect, test } from "bun:test";
import * as Pins from "../../Pins.ts";

beforeEach(() => {
  Pins.tool({ action: "unpin", ids: Pins.read().map((p) => p.id) });
});

test("a pin added gets the next id and shows with where it came from and till when", () => {
  expect(Pins.tool({ action: "add", text: "Call him Sam.", from: 9 }, "2026-11-01")).toEqual({ text: "Pinned 1|Call him Sam. (#9)", fail: false });
  expect(Pins.tool({ action: "add", text: "Deals  only\nnew ones.", until: "2026-11-30" }, "2026-11-01")).toEqual({ text: "Pinned 2|Deals only new ones. until 2026-11-30", fail: false });
});

test("a pin needs its text on one short line, and until as a date", () => {
  expect(Pins.tool({ action: "add", text: "  " })).toEqual({ text: "A pin needs its text.", fail: true });
  expect(Pins.tool({ action: "add", text: "x".repeat(401) })).toEqual({ text: "A pin is one line of at most 400 bytes: shorten it.", fail: true });
  expect(Pins.tool({ action: "add", text: "ok", until: "next week" })).toEqual({ text: "until is a date, YYYY-MM-DD.", fail: true });
  expect(Pins.read()).toEqual([]);
});

test("at 60 pins no more are added", () => {
  for (let n = 0; n < 60; n++) {
    Pins.tool({ action: "add", text: "pin " + n });
  }
  expect(Pins.tool({ action: "add", text: "one more" })).toEqual({ text: "There are 60 pins, the most kept: propose merges or drops to the user first.", fail: true });
});

test("a pin replaced keeps where it came from and its until unless given new ones", () => {
  Pins.tool({ action: "add", text: "Old rule.", from: 3, until: "2026-12-01" }, "2026-11-01");
  expect(Pins.tool({ action: "replace", id: 1, text: "New rule." }, "2026-11-02")).toEqual({ text: "Replaced 1|Old rule. (#3) until 2026-12-01\nwith 1|New rule. (#3) until 2026-12-01", fail: false });
});

test("a temporary pin leaves after its until, a lasting one when unused for 45 days", () => {
  Pins.tool({ action: "add", text: "Till November.", until: "2026-11-30" }, "2026-10-01");
  Pins.tool({ action: "add", text: "Unused." }, "2026-10-15");
  Pins.tool({ action: "add", text: "Used lately." }, "2026-10-15");
  Pins.tool({ action: "used", ids: [3] }, "2026-11-20");
  expect(Pins.sweep("2026-11-30").map(({ pin, why }) => [pin.text, why])).toEqual([["Unused.", "unused 45d"]]);
  expect(Pins.sweep("2026-12-01").map(({ pin, why }) => [pin.text, why])).toEqual([["Till November.", "expired 2026-11-30"]]);
  expect(Pins.read().map((p) => p.text)).toEqual(["Used lately."]);
});

test("a subagent with no pins gets no pins block; the lead agent is told there are none yet", () => {
  expect(Pins.block(false).text).toBe("");
  expect(Pins.block(true).text).toEndWith("\n(None yet.)\n\n");
});
