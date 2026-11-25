import { expect, test } from "bun:test";
import { Agent } from "../../Agent.ts";
import { Limit } from "../../Limit.ts";

const NOW = Date.parse("2026-11-25T10:00:00Z");

function reset(headers: Record<string, string>): number | null {
  return Agent.reset(new Response(null, { headers }), NOW);
}

test("a limit resets after the retry-after the vendor gives, in seconds or as a date", () => {
  expect(reset({ "retry-after": "30" })).toBe(NOW + 30e3);
  expect(reset({ "retry-after": "Wed, 25 Nov 2026 10:02:00 GMT" })).toBe(NOW + 120e3);
});

test("without a retry-after, it resets at the latest of the vendor's resets", () => {
  expect(reset({ "anthropic-ratelimit-unified-5h-reset": String(NOW / 1e3 + 600), "anthropic-ratelimit-unified-7d-reset": String(NOW / 1e3 + 3600) })).toBe(NOW + 3600e3);
  expect(reset({ "anthropic-ratelimit-requests-reset": "2026-11-25T10:01:00Z" })).toBe(NOW + 60e3);
  expect(reset({ "x-ratelimit-reset-requests": "6m0s", "x-ratelimit-reset-tokens": "20ms" })).toBe(NOW + 360e3);
});

test("retry-after comes before any other reset", () => {
  expect(reset({ "retry-after": "5", "anthropic-ratelimit-unified-reset": String(NOW / 1e3 + 600) })).toBe(NOW + 5e3);
});

test("a reset untold, past, or too far for a timer is none", () => {
  expect(reset({})).toBeNull();
  expect(reset({ "anthropic-ratelimit-unified-reset": String(NOW / 1e3 - 60) })).toBeNull();
  expect(reset({ "retry-after": String(30 * 86400) })).toBeNull();
  expect(Agent.reset(null, NOW)).toBeNull();
});

test("a call waits for the reset it was told, else backs off doubling up to its pace", () => {
  expect(Limit.wait_for(NOW + 90e3, 1, 60e3, NOW)).toEqual({ ms: 90e3, known: true });
  expect(Limit.wait_for(null, 0, 60e3, NOW)).toEqual({ ms: 1e3, known: false });
  expect(Limit.wait_for(null, 3, 60e3, NOW)).toEqual({ ms: 8e3, known: false });
  expect(Limit.wait_for(null, 10, 60e3, NOW)).toEqual({ ms: 60e3, known: false });
  expect(Limit.wait_for(NOW - 1, 2, 60e3, NOW)).toEqual({ ms: 4e3, known: false });
});

test("after its first tries, a call never waits less than its back-off, even with a nearer reset told", () => {
  expect(Limit.wait_for(NOW + 1e3, 8, 60e3, NOW)).toEqual({ ms: 60e3, known: false });
});
