import "../home.ts";
import { beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import { DIR } from "../home.ts";
import { Brief } from "../../Brief.ts";
import * as Pins from "../../Pins.ts";
import { Team } from "../../Team.ts";

Team.open();
const lead = Team.first().id;
const fields = { about: "", picture: "head-01", prompt: null, claude: "" };
const deals = Team.add({ name: "Deals", ...fields }).id;
const mail = Team.add({ name: "Mail", ...fields }).id;
const inbox = Team.add({ name: "Inbox", ...fields }).id;

const texts = (mon: string, boss: boolean) => Pins.block(mon, boss).text;

beforeEach(() => {
  fs.rmSync(DIR + "/pins.json", { force: true });
});

test("a pin added gets the next id, holds for the agent that added it unless for says otherwise, and shows with where it came from and till when", () => {
  expect(Pins.tool({ action: "add", text: "Call him Sam.", from: 9, for: ["all"] }, lead, "2026-11-01")).toEqual({ text: "Pinned for the whole team: 1|Call him Sam. (#9)", fail: false });
  expect(Pins.tool({ action: "add", text: "Deals  only\nnew ones.", until: "2026-11-30" }, deals, "2026-11-01")).toEqual({ text: "Pinned for Deals: 2|Deals only new ones. until 2026-11-30", fail: false });
});

test("a pin needs its text on one short line, until as a date, and agents of the team to hold for", () => {
  expect(Pins.tool({ action: "add", text: "  " }, lead)).toEqual({ text: "A pin needs its text.", fail: true });
  expect(Pins.tool({ action: "add", text: "x".repeat(401) }, lead)).toEqual({ text: "A pin is one line of at most 400 bytes: shorten it.", fail: true });
  expect(Pins.tool({ action: "add", text: "ok", until: "next week" }, lead)).toEqual({ text: "until is a date, YYYY-MM-DD.", fail: true });
  expect(Pins.tool({ action: "add", text: "ok", for: ["Deals", "Nobody"] }, lead)).toEqual({ text: "No agent Nobody in the team.", fail: true });
  expect(Pins.tool({ action: "add", text: "ok", for: ["all", "Mail"] }, lead)).toEqual({ text: "for is \"all\" alone, or agents' names.", fail: true });
  expect(Pins.read()).toEqual([]);
});

test("a pin for one agent reaches it and its workers, and no other agent or theirs", () => {
  Pins.tool({ action: "add", text: "Track the TV price." }, deals);
  expect(texts(deals, true)).toContain("Pinned for you:\n1|Track the TV price.");
  expect(texts(deals, false)).toContain("1|Track the TV price.");
  expect(texts(mail, true)).not.toContain("Track the TV price.");
  expect(texts(mail, false)).toBe("");
});

test("a shared pin reaches every agent and every agent's workers", () => {
  Pins.tool({ action: "add", text: "Brazilian time.", for: "all" }, mail);
  for (const mon of [lead, deals, mail]) {
    expect(texts(mon, true)).toContain("Pinned for the whole team:\n1|Brazilian time.\nPinned for you:\n(None yet.)");
    expect(texts(mon, false)).toContain("1|Brazilian time.");
  }
});

test("a pin for a few agents reaches each of them, named to each with the others it holds for", () => {
  expect(Pins.tool({ action: "add", text: "No mailbox rules.", for: ["me", "Inbox"] }, mail).text).toBe("Pinned for Mail, Inbox: 1|No mailbox rules.");
  expect(texts(mail, true)).toContain("1|No mailbox rules. (also for Inbox)");
  expect(texts(inbox, true)).toContain("1|No mailbox rules. (also for Mail)");
  expect(texts(deals, true)).not.toContain("No mailbox rules.");
});

test("a work session's and a subagent's prompts carry their agent's pins and not another agent's", () => {
  Pins.tool({ action: "add", text: "Deals rule." }, deals);
  Pins.tool({ action: "add", text: "Mail rule." }, mail);
  const session = Brief.append({ id: deals, name: "Deals" }, null, "the brief", null);
  const sub = Brief.subagent({ id: mail, name: "Mail" }, [], false, "own", null).system;
  expect([session.includes("Deals rule."), session.includes("Mail rule.")]).toEqual([true, false]);
  expect([sub.includes("Deals rule."), sub.includes("Mail rule.")]).toEqual([false, true]);
});

test("an agent sees and changes only the pins shared or held for it", () => {
  Pins.tool({ action: "add", text: "Deals rule." }, deals);
  expect(Pins.tool({ action: "replace", id: 1, text: "Taken over." }, mail)).toEqual({ text: "No pin 1.", fail: true });
  expect(Pins.tool({ action: "unpin", ids: [1] }, mail)).toEqual({ text: "No pin 1.", fail: true });
  expect(Pins.tool({ action: "used", ids: [1] }, mail)).toEqual({ text: "No pin 1.", fail: true });
  expect(Pins.read().map((p) => p.text)).toEqual(["Deals rule."]);
});

test("ids run in one sequence across every agent's pins", () => {
  Pins.tool({ action: "add", text: "a" }, deals);
  Pins.tool({ action: "add", text: "b" }, mail);
  Pins.tool({ action: "add", text: "c", for: ["all"] }, lead);
  expect(Pins.read().map((p) => p.id)).toEqual([1, 2, 3]);
});

test("a pin replaced keeps where it came from, its until and who it holds for unless given new ones", () => {
  Pins.tool({ action: "add", text: "Old rule.", from: 3, until: "2026-12-01" }, deals, "2026-11-01");
  expect(Pins.tool({ action: "replace", id: 1, text: "New rule." }, deals, "2026-11-02")).toEqual({ text: "Replaced 1|Old rule. (#3) until 2026-12-01\nwith 1|New rule. (#3) until 2026-12-01, for Deals", fail: false });
});

test("a pin replaced with for moves to who it names", () => {
  Pins.tool({ action: "add", text: "Every agent should know this." }, deals);
  Pins.tool({ action: "replace", id: 1, for: ["all"] }, deals);
  expect(texts(mail, true)).toContain("Pinned for the whole team:\n1|Every agent should know this.");
  Pins.tool({ action: "replace", id: 1, for: ["Mail"] }, deals);
  expect(texts(mail, true)).toContain("Pinned for you:\n1|Every agent should know this.");
  expect(texts(deals, true)).not.toContain("Every agent should know this.");
});

test("each group holds 60 pins: one full refuses more, the others still take them", () => {
  for (let n = 0; n < 60; n++) {
    Pins.tool({ action: "add", text: "deal " + n }, deals);
    Pins.tool({ action: "add", text: "team " + n, for: ["all"] }, lead);
  }
  expect(Pins.tool({ action: "add", text: "one more" }, deals)).toEqual({ text: "Deals has 60 pins of its own, the most kept: propose merges or drops to the user first.", fail: true });
  expect(Pins.tool({ action: "add", text: "for both", for: ["Mail", "Deals"] }, mail)).toEqual({ text: "Deals has 60 pins of its own, the most kept: propose merges or drops to the user first.", fail: true });
  expect(Pins.tool({ action: "add", text: "one more", for: ["all"] }, lead)).toEqual({ text: "There are 60 pins for the whole team, the most kept: propose merges or drops to the user first.", fail: true });
  expect(Pins.tool({ action: "replace", id: 1, text: "deal 0, reworded" }, deals).fail).toBe(false);
  expect(Pins.tool({ action: "add", text: "a mail rule" }, mail).fail).toBe(false);
  expect(Pins.tool({ action: "replace", id: 121, for: ["Deals"] }, mail)).toEqual({ text: "Deals has 60 pins of its own, the most kept: propose merges or drops to the user first.", fail: true });
});

test("a temporary pin leaves after its until, a lasting one when unused for 45 days", () => {
  Pins.tool({ action: "add", text: "Till November.", until: "2026-11-30" }, lead, "2026-10-01");
  Pins.tool({ action: "add", text: "Unused." }, lead, "2026-10-15");
  Pins.tool({ action: "add", text: "Used lately." }, lead, "2026-10-15");
  Pins.tool({ action: "used", ids: [3] }, lead, "2026-11-20");
  expect(Pins.sweep("2026-11-30").map(({ pin, why }) => [pin.text, why])).toEqual([["Unused.", "unused 45d"]]);
  expect(Pins.sweep("2026-12-01").map(({ pin, why }) => [pin.text, why])).toEqual([["Till November.", "expired 2026-11-30"]]);
  expect(Pins.read().map((p) => p.text)).toEqual(["Used lately."]);
});

test("news of a pin goes to the active agents it held for, else to the first agent", () => {
  const gone = Team.add({ name: "Gone", ...fields }).id;
  Pins.tool({ action: "add", text: "mail and inbox", for: ["Mail", "Inbox"] }, mail);
  Pins.tool({ action: "add", text: "shared", for: ["all"] }, mail);
  Pins.tool({ action: "add", text: "gone and mail", for: ["Gone", "Mail"] }, mail);
  Pins.tool({ action: "add", text: "gone alone" }, gone);
  Team.archive(gone, true);
  expect(Pins.read().map(Pins.homes)).toEqual([[mail, inbox], [lead], [mail], [lead]]);
});

test("an agent deleted leaves its pins: one held for it alone goes, one it shared stays for the others", () => {
  Pins.tool({ action: "add", text: "Deals alone." }, deals);
  Pins.tool({ action: "add", text: "Deals and Mail.", for: ["me", "Mail"] }, deals);
  Pins.drop(deals);
  expect(Pins.read().map((p) => [p.text, p.mons])).toEqual([["Deals and Mail.", [mail]]]);
});

test("a pin saved before pins had a scope holds for the whole team", () => {
  fs.writeFileSync(DIR + "/pins.json", JSON.stringify([{ id: 4, text: "Old pin.", from: null, until: null, made: "2026-01-01", used: "2026-01-01" }]));
  expect(texts(mail, true)).toContain("Pinned for the whole team:\n4|Old pin.");
});

test("a subagent with no pins gets no pins block; the lead agent is told there are none yet", () => {
  expect(texts(lead, false)).toBe("");
  expect(texts(lead, true)).toContain("Pinned for the whole team:\n(None yet.)\nPinned for you:\n(None yet.)");
});
