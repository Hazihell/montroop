import { expect, test } from "bun:test";
import { Room } from "../../Room.ts";

const GB = 2 ** 30;
const IDLE = { cores: 16, busy: 0, free: 64 * GB, total: 64 * GB, running: 0, fresh: 0, most: 0 };

test("the room is what free memory leaves past a reserve, at half a GB each", () => {
  expect(Room.fit({ ...IDLE, free: 4 * GB, total: 16 * GB })).toBe(4);
  expect(Room.fit({ ...IDLE, free: 7.2 * GB, total: 32 * GB })).toBe(8);
});

test("the room is a core each of the cores not busy", () => {
  expect(Room.fit({ ...IDLE, busy: 1.6, free: 16 * GB, total: 24 * GB, running: 3 })).toBe(14);
});

test("the room stops at two running per core", () => {
  expect(Room.fit({ ...IDLE, cores: 4, running: 7 })).toBe(1);
});

test("one started lately takes its memory and core from the room before the computer shows it", () => {
  expect(Room.fit({ ...IDLE, busy: 1.6, free: 16 * GB, total: 24 * GB, running: 13, fresh: 10 })).toBe(4);
  expect(Room.fit({ ...IDLE, free: 4 * GB, total: 16 * GB, running: 3, fresh: 3 })).toBe(1);
});

test("a computer short of memory or cores has no room, never less", () => {
  expect(Room.fit({ ...IDLE, busy: 16 })).toBe(0);
  expect(Room.fit({ ...IDLE, free: 1 * GB, total: 16 * GB })).toBe(0);
});

test("a most set in the config is the room beside those running, whatever the computer has", () => {
  expect(Room.fit({ ...IDLE, cores: 2, busy: 2, free: 0, running: 3, fresh: 3, most: 5 })).toBe(2);
  expect(Room.fit({ ...IDLE, running: 6, most: 5 })).toBe(0);
});

test("the room is told with the numbers it comes from", () => {
  expect(Room.said({ ...IDLE, busy: 1.62, free: 16.05 * GB, total: 24 * GB, running: 3 })).toBe("16 cores, CPU 10% busy, 16.1 GB of memory free, 3 subagents and work sessions running across all agents: room for 14 more now");
  expect(Room.said({ ...IDLE, running: 1, most: 4 })).toBe("16 cores, CPU 0% busy, 64.0 GB of memory free, 1 subagent or work session running across all agents: room for 3 more now; Montroop's config lets 4 run at once");
});

// /proc/stat's cpu lines: user nice system idle iowait irq softirq steal
// guest guest_nice; THEN is 10000 ticks in all, 1500 busy
const THEN = "cpu  1000 0 500 8000 500 0 0 0 0 0";

test("the cores busy are the share of the CPU's time between two readings spent but idle or waiting on IO", () => {
  // 2000 ticks more, 800 of them idle and 200 iowait; guest is in user
  expect(Room.busy(THEN, "cpu  1500 100 700 8800 700 100 50 50 50 0", 0, 16)).toBe(8);
  expect(Room.busy(THEN, "cpu  1000 0 500 8500 1500 0 0 0 0 0", 0, 16)).toBe(0);
});

test("with one reading, the cores busy are its share since the computer started; with none, the load average, at most every core", () => {
  expect(Room.busy(null, THEN, 99, 16)).toBe(2.4);
  expect(Room.busy(null, null, 3.5, 16)).toBe(3.5);
  expect(Room.busy(null, null, 45, 16)).toBe(16);
});

test("a high load average with the CPU mostly idle leaves room", () => {
  // 1500 ticks more, 150 busy: a tenth of 16 cores
  const busy = Room.busy(THEN, "cpu  1150 0 500 9350 500 0 0 0 0 0", 45, 16);
  expect(busy).toBe(1.6);
  expect(Room.fit({ ...IDLE, busy, free: 16 * GB, total: 24 * GB })).toBe(14);
});
