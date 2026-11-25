import "../home.ts";
import { expect, test } from "bun:test";
import { Team, type Agent } from "../../Team.ts";

Team.open();

test("a drawn look is one the app draws: each part one it has, the colors any", () => {
  const a = Team.first();
  expect(Team.edit(a, { picture: "av:heart.goo.none.crown.123abc.ffc93c" })).toMatchObject({ picture: "av:heart.goo.none.crown.123abc.ffc93c" });
  expect(Team.edit(a, { picture: "av:cube.goo.none.crown.ff5fa2.ffc93c" })).toBe("No shape cube in a drawn look; one of: scallop, circle, squircle, pill, triangle, bear, flower, clover, heart, ghost.");
  expect(Team.edit(a, { picture: "av:heart.goo.none.cape.ff5fa2.ffc93c" })).toBe("No extra cape in a drawn look; one of: none, pom, antenna, phones, bow, cap, beret, crown, sprout, halo.");
});

test("a look saved before stays through an edit of another field, though the app no longer draws one of its parts", () => {
  const old = "av:cube.goo.none.crown.ff5fa2.ffc93c";
  const a = Team.set(Team.first().id, { name: "Montroop", about: "First.", picture: old, prompt: null, claude: "" }, null) as Agent;
  expect(Team.edit(a, { about: "Still first." })).toMatchObject({ about: "Still first.", picture: old });
});
