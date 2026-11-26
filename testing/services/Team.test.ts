import "../home.ts";
import { expect, test } from "bun:test";
import { Team, type Agent } from "../../Team.ts";

Team.open();

test("an edit's text fields are text", () => {
  expect(Team.edit(Team.first(), { picture: 7 })).toBe("picture is text.");
  expect(Team.edit(Team.first(), { about: ["a"] })).toBe("about is text.");
});

test("a look saved before stays through an edit of another field, though the app no longer draws one of its parts", () => {
  const old = "av:cube.goo.none.crown.ff5fa2.ffc93c";
  const a = Team.set(Team.first().id, { name: "Montroop", about: "First.", picture: old, prompt: null, claude: "" }, null) as Agent;
  expect(Team.edit(a, { about: "Still first." })).toMatchObject({ about: "Still first.", picture: old });
});

test("an agent sets its own name, look, prompt, model, effort, Leader mode and submons, but not what only the owner changes", () => {
  expect(Team.mine_refused({ name: "Nova", about: "x", picture: "head-01", prompt: "p", model: "m", effort: "e", leader: true, lines: 3 }, false)).toBeNull();
  expect(Team.mine_refused({ manage: true }, false)).toBe("Manage mons, which gives power over the other mons, is the user's to turn on or off, in your settings in the app. Nothing was changed.");
  expect(Team.mine_refused({ claude: "work", name: "Nova" }, false)).toBe("Your Claude account is the user's to pick, in your settings in the app. Nothing was changed.");
  expect(Team.mine_refused({ mcp: { gmail: false } }, false)).toBe("The MCP servers are switched for every mon at once, by the user in the app. Nothing was changed.");
  expect(Team.mine_refused({ mood: "sunny" }, false)).toBe("No setting mood: set takes name, about, picture, prompt, model, effort, leader, lines.");
});

test("an agent sets Leader mode's lines only with Leader mode on, or turned on with them", () => {
  const off = "lines is Leader mode's: set it with leader true, or once Leader mode is on.";
  expect(Team.mine_refused({ lines: 3 }, false)).toBe(off);
  expect(Team.mine_refused({ lines: 3, leader: false }, true)).toBe(off);
  expect(Team.mine_refused({ lines: 3 }, true)).toBeNull();
  expect(Team.mine_refused({ lines: 3, leader: true }, false)).toBeNull();
});
