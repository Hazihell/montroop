import { expect, test } from "bun:test";
import { timer_after, timer_new, timer_say, type Timer } from "../../Timer.ts";

// Wednesday 2026-11-25, 10:00 UTC
const NOW = Date.parse("2026-11-25T10:00:00Z");

function at(t: Timer | string): string {
  return typeof t === "string" ? t : t.at;
}

test("a one-off time is read in the zone given", () => {
  expect(timer_new({ message: "Stand-up", at: "2026-11-25 09:30", zone: "America/Sao_Paulo" }, NOW)).toMatchObject({ text: "Stand-up", at: "2026-11-25T12:30:00.000Z", cron: null, zone: "America/Sao_Paulo" });
  expect(at(timer_new({ message: "x", at: "2026-11-25T09:30+01:00", zone: "UTC" }, Date.parse("2026-11-25T08:00:00Z")))).toBe("2026-11-25T08:30:00.000Z");
});

test("a one-off time that has passed is refused, saying the time there now", () => {
  expect(timer_new({ message: "x", at: "2026-11-25 06:30", zone: "America/Sao_Paulo" }, NOW)).toBe("2026-11-25 06:30 America/Sao_Paulo has passed; it is 2026-11-25 07:00 there now.");
});

test("a time a daylight-saving change skips is refused", () => {
  expect(timer_new({ message: "x", at: "2027-03-28 02:30", zone: "Europe/Amsterdam" }, NOW)).toBe("2027-03-28 02:30 doesn't exist in Europe/Amsterdam: a daylight-saving change skips it.");
});

test("a day that doesn't exist is no time", () => {
  expect(timer_new({ message: "x", at: "2027-02-30 10:00", zone: "UTC" }, NOW)).toBe("No time \"2027-02-30 10:00\": give YYYY-MM-DD HH:MM.");
});

test("a cron comes next on its next matching minute in its zone", () => {
  expect(at(timer_new({ message: "x", cron: "0 9 * * mon-fri", zone: "UTC" }, Date.parse("2026-11-28T12:00:00Z")))).toBe("2026-11-30T09:00:00.000Z");
  expect(at(timer_new({ message: "x", cron: "30 8 * * *", zone: "America/Sao_Paulo" }, NOW))).toBe("2026-11-25T11:30:00.000Z");
});

test("a cron's weekday 7 is Sunday", () => {
  expect(at(timer_new({ message: "x", cron: "0 9 * * 7", zone: "UTC" }, NOW))).toBe("2026-11-29T09:00:00.000Z");
});

test("a cron with both a day of the month and a weekday comes on either", () => {
  expect(at(timer_new({ message: "x", cron: "0 12 1 * fri", zone: "UTC" }, NOW))).toBe("2026-11-27T12:00:00.000Z");
});

test("a cron is refused when its times come less than 5 minutes apart", () => {
  expect(timer_new({ message: "x", cron: "*/2 * * * *", zone: "UTC" }, NOW)).toBe("A cron's times must be at least 5 minutes apart (*/5 is the most often).");
  expect(timer_new({ message: "x", cron: "58,1 * * * *", zone: "UTC" }, NOW)).toBe("A cron's times must be at least 5 minutes apart (*/5 is the most often).");
  expect(at(timer_new({ message: "x", cron: "*/5 * * * *", zone: "UTC" }, NOW))).toBe("2026-11-25T10:05:00.000Z");
});

test("a cron that isn't five fields in range is refused, saying why", () => {
  expect(timer_new({ message: "x", cron: "0 9 * *", zone: "UTC" }, NOW)).toBe("A cron has five fields (minute hour day month weekday), not 4.");
  expect(timer_new({ message: "x", cron: "0 25 * * *", zone: "UTC" }, NOW)).toBe("No cron field \"25\": its values go from 0 to 23.");
});

test("a schedule takes either a time or a cron, a message and a real zone", () => {
  expect(timer_new({ message: "x", at: "2026-12-01 10:00", cron: "0 9 * * *", zone: "UTC" }, NOW)).toBe("Give either at (once) or cron (again and again), not both or neither.");
  expect(timer_new({ message: "x", at: "2026-12-01 10:00", zone: "Mars/Base" }, NOW)).toBe("No time zone \"Mars/Base\": give an IANA name, such as Europe/Amsterdam or UTC.");
  expect(timer_new({ message: " ", at: "2026-12-01 10:00", zone: "UTC" }, NOW)).toBe("A schedule's message has 1 to 2000 characters.");
});

test("a cron that came is set to its next time; a one-off isn't", () => {
  const daily: Timer = { id: "t1", text: "x", at: "2026-11-25T09:00:00.000Z", cron: "0 9 * * *", zone: "UTC" };
  expect(timer_after(daily, Date.parse("2026-11-25T09:00:30Z"))?.at).toBe("2026-11-26T09:00:00.000Z");
  expect(timer_after({ ...daily, cron: null }, NOW)).toBeNull();
});

test("a schedule that comes over a minute late says so", () => {
  const t: Timer = { id: "t1", text: "Water the plants.", at: "2026-11-25T09:00:00.000Z", cron: null, zone: "UTC" };
  expect(timer_say(t, Date.parse("2026-11-25T09:00:59Z"))).toBe("[Timer t1]\nWater the plants.");
  expect(timer_say(t, Date.parse("2026-11-25T09:05:00Z"))).toBe("[Timer t1]\nWater the plants.\n\n(Due 2026-11-25 09:00 UTC; it came late, at 2026-11-25 09:05.)");
});
