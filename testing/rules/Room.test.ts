import { expect, test } from "bun:test";
import { Room } from "../../Room.ts";

const GB = 2 ** 30;
const IDLE = { cores: 16, load: 0, free: 64 * GB, total: 64 * GB, running: 0, fresh: 0, most: 0 };

test("the room is what free memory leaves past a reserve, at half a GB each", () => {
  expect(Room.fit({ ...IDLE, free: 4 * GB, total: 16 * GB })).toBe(4);
  expect(Room.fit({ ...IDLE, free: 7.2 * GB, total: 32 * GB })).toBe(8);
});

test("the room is a core each of the cores the load leaves free", () => {
  expect(Room.fit({ ...IDLE, load: 1.6, free: 16 * GB, total: 24 * GB, running: 3 })).toBe(14);
});

test("the room stops at two running per core", () => {
  expect(Room.fit({ ...IDLE, cores: 4, running: 7 })).toBe(1);
});

test("one started lately takes its memory and core from the room before the computer shows it", () => {
  expect(Room.fit({ ...IDLE, load: 1.6, free: 16 * GB, total: 24 * GB, running: 13, fresh: 10 })).toBe(4);
  expect(Room.fit({ ...IDLE, free: 4 * GB, total: 16 * GB, running: 3, fresh: 3 })).toBe(1);
});

test("a computer short of memory or cores has no room, never less", () => {
  expect(Room.fit({ ...IDLE, load: 20 })).toBe(0);
  expect(Room.fit({ ...IDLE, free: 1 * GB, total: 16 * GB })).toBe(0);
});

test("a most set in the config is the room beside those running, whatever the computer has", () => {
  expect(Room.fit({ ...IDLE, cores: 2, load: 8, free: 0, running: 3, fresh: 3, most: 5 })).toBe(2);
  expect(Room.fit({ ...IDLE, running: 6, most: 5 })).toBe(0);
});

test("the room is told with the numbers it comes from", () => {
  expect(Room.said({ ...IDLE, load: 1.62, free: 16.05 * GB, total: 24 * GB, running: 3 })).toBe("16 cores at load 1.6, 16.1 GB of memory free, 3 subagents and work sessions running across all agents: room for 14 more now");
  expect(Room.said({ ...IDLE, running: 1, most: 4 })).toBe("16 cores at load 0.0, 64.0 GB of memory free, 1 subagent or work session running across all agents: room for 3 more now; Montroop's config lets 4 run at once");
});
