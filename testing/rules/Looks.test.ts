import { expect, test } from "bun:test";
import { look_wrong } from "../../Looks.ts";

test("a drawn look is one the app draws: each part one it has, the colors any", () => {
  expect(look_wrong("av:heart.goo.none.crown.123abc.ffc93c")).toBeNull();
  expect(look_wrong("av:cube.goo.none.crown.ff5fa2.ffc93c")).toStartWith("No shape cube in a drawn look; one of: ");
  expect(look_wrong("av:heart.goo.none.cape.ff5fa2.ffc93c")).toStartWith("No extra cape in a drawn look; one of: ");
  expect(look_wrong("head-07")).toBeNull();
});
