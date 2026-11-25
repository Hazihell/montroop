import { expect, test } from "bun:test";
import { Room } from "../../Room.ts";

const GB = 2 ** 30;
const NONE = { cores: 0, memory: 0, missing: 0 };
const IDLE = { cores: 16, busy: 0, available: 64 * GB, total: 64 * GB, running: 0, mine: 0, used: NONE, own: NONE };
const HEAD = "16 cores, 0% busy; memory 64.0 GB available of 64.0 GB; ";

test("the computer is told as its cores, how busy, its memory, and what the subagents and work sessions running use, in all and the agent's own", () => {
  expect(Room.said({ ...IDLE, busy: 3.68, available: 18.42 * GB, total: 31.2 * GB, running: 5, mine: 2, used: { cores: 2.34, memory: 3.1 * GB, missing: 0 }, own: { cores: 0.8, memory: 1.25 * GB, missing: 0 } })).toBe("16 cores, 23% busy; memory 18.4 GB available of 31.2 GB; 5 subagents and work sessions running across all agents, 2 of them yours: they use 2.3 cores and 3.1 GB, yours 0.8 cores and 1.3 GB");
  expect(Room.said({ ...IDLE, running: 3, mine: 3, used: { cores: 1, memory: 2 * GB, missing: 0 }, own: { cores: 1, memory: 2 * GB, missing: 0 } })).toBe(HEAD + "3 subagents and work sessions running across all agents, all of them yours: they use 1.0 cores and 2.0 GB");
  expect(Room.said(IDLE)).toBe(HEAD + "no subagents or work sessions running");
});

test("what isn't measured yet is told so, not as nothing used", () => {
  expect(Room.said({ ...IDLE, running: 1, used: { cores: null, memory: 0.3 * GB, missing: 0 } })).toBe(HEAD + "1 subagent or work session running across all agents, none of them yours: it uses 0.3 GB (CPU not measured yet)");
  expect(Room.said({ ...IDLE, running: 2, mine: 1, used: { cores: null, memory: null, missing: 2 }, own: { cores: null, memory: null, missing: 1 } })).toBe(HEAD + "2 subagents and work sessions running across all agents, 1 of them yours: their use isn't measured yet");
  expect(Room.said({ ...IDLE, running: 3, mine: 1, used: { cores: 0.5, memory: 0.5 * GB, missing: 2 }, own: { cores: null, memory: null, missing: 1 } })).toBe(HEAD + "3 subagents and work sessions running across all agents, 1 of them yours: they use 0.5 cores and 0.5 GB (2 of them not measured yet), yours not measured yet");
});

test("nothing starts with under 1 GB of memory available, saying so with the computer's facts", () => {
  expect(Room.refused({ ...IDLE, available: 0.96 * GB })).toBe("Only 983 MB of memory is available on this computer, under the 1 GB kept free so it doesn't run out. Nothing started: wait for some subagents or work sessions to end, or do the work yourself. This computer: 16 cores, 0% busy; memory 0.9 GB available of 64.0 GB; no subagents or work sessions running.");
  expect(Room.refused({ ...IDLE, available: 1 * GB })).toBeNull();
});

test("however many run and however busy the cores, a start isn't refused while memory is available", () => {
  expect(Room.refused({ ...IDLE, busy: 16, available: 1.5 * GB, running: 500, mine: 200, used: { cores: 16, memory: 60 * GB, missing: 0 }, own: NONE })).toBeNull();
});

// /proc/stat's cpu lines: user nice system idle iowait irq softirq steal
// guest guest_nice; THEN is 10000 ticks in all, 1500 busy
const THEN = "cpu  1000 0 500 8000 500 0 0 0 0 0";

test("the cores busy are the share of the CPU's time between two readings spent but idle or waiting on IO", () => {
  // 2000 ticks more, 800 of them idle and 200 iowait; guest is in user
  expect(Room.busy(THEN, "cpu  1500 100 700 8800 700 100 50 50 50 0", 0, 16)).toBe(8);
  expect(Room.busy(THEN, "cpu  1000 0 500 8500 1500 0 0 0 0 0", 0, 16)).toBe(0);
  // a high load average with the CPU mostly idle: 1500 ticks more, 150 busy
  expect(Room.busy(THEN, "cpu  1150 0 500 9350 500 0 0 0 0 0", 45, 16)).toBe(1.6);
});

test("counters that went back keep the cores busy between none and all", () => {
  // user 100 less, idle 200 more: less busy than nothing
  expect(Room.busy(THEN, "cpu  900 0 500 8200 500 0 0 0 0 0", 0, 16)).toBe(0);
  // iowait 200 less: 300 busy in 200 ticks
  expect(Room.busy(THEN, "cpu  1300 0 500 8100 300 0 0 0 0 0", 0, 16)).toBe(16);
});

test("with one reading, the cores busy are its share since the computer started; with none, the load average, at most every core", () => {
  expect(Room.busy(null, THEN, 99, 16)).toBe(2.4);
  expect(Room.busy(null, null, 3.5, 16)).toBe(3.5);
  expect(Room.busy(null, null, 45, 16)).toBe(16);
});
