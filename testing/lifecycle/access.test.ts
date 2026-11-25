import { afterAll, beforeAll, expect, test } from "bun:test";
import { down, Kny } from "../rig.ts";

let k: Kny;

beforeAll(async () => {
  k = await Kny.up();
});

afterAll(down);

const CALLS = [["GET", ""], ["GET", "/0123abcd"], ["POST", "/0123abcd/say"], ["POST", "/0123abcd/stop"], ["POST", "/0123abcd/archive"], ["POST", "/0123abcd/resume"], ["POST", ""]];

test("work sessions answer only the signed-in owner; a malformed sign-in cookie reads as signed out", async () => {
  const stranger = "0".repeat(43);
  for (const [method, p] of CALLS) {
    for (const cookie of ["", "kunumy=" + stranger, "kunumy=%E0%A4%A"]) {
      const res = await fetch(k.url + "/api/sessions" + p, { method, headers: { cookie, "content-type": "application/json" }, body: method === "POST" ? JSON.stringify({ text: "hello", request: "r-1", force: true }) : undefined });
      expect([method, p, cookie, res.status]).toEqual([method, p, cookie, 401]);
    }
  }
});
