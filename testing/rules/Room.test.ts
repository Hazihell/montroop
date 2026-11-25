import { expect, test } from "bun:test";
import { Room } from "../../Room.ts";

const GB = 2 ** 30;

test("the room for submons is what free memory leaves past a reserve, at half a GB each", () => {
  expect(Room.fit({ cores: 16, load: 0, free: 4 * GB, total: 16 * GB, running: 0 }, 0)).toBe(4);
  expect(Room.fit({ cores: 16, load: 0, free: 7.2 * GB, total: 32 * GB, running: 0 }, 0)).toBe(8);
});

test("the room for submons is a core each of the cores the load leaves free", () => {
  expect(Room.fit({ cores: 16, load: 1.6, free: 16 * GB, total: 24 * GB, running: 3 }, 0)).toBe(14);
});

test("the room for submons stops at two running per core", () => {
  expect(Room.fit({ cores: 4, load: 0, free: 64 * GB, total: 64 * GB, running: 7 }, 0)).toBe(1);
});

test("a computer short of memory or cores has no room, never less", () => {
  expect(Room.fit({ cores: 16, load: 20, free: 16 * GB, total: 24 * GB, running: 0 }, 0)).toBe(0);
  expect(Room.fit({ cores: 16, load: 0, free: 1 * GB, total: 16 * GB, running: 0 }, 0)).toBe(0);
});

test("a most set in the config is the room beside those running, whatever the computer has", () => {
  expect(Room.fit({ cores: 2, load: 8, free: 0, total: 8 * GB, running: 3 }, 5)).toBe(2);
  expect(Room.fit({ cores: 64, load: 0, free: 256 * GB, total: 256 * GB, running: 6 }, 5)).toBe(0);
});
