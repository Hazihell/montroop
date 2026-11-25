import { afterAll, beforeAll, expect, test } from "bun:test";
import { down, Kny } from "../rig.ts";

let k: Kny;

beforeAll(async () => {
  k = await Kny.up();
});

afterAll(down);

const CALLS = [["GET", ""], ["GET", "/0123abcd"], ["POST", "/0123abcd/say"], ["POST", "/0123abcd/stop"], ["POST", "/0123abcd/archive"], ["POST", "/0123abcd/resume"], ["POST", ""]];

test("work sessions answer only the signed-in owner", async () => {
  const stranger = "0".repeat(43);
  for (const [method, p] of CALLS) {
    for (const cookie of ["", "kunumy=" + stranger, "ki=" + stranger]) {
      const res = await fetch(k.url + "/api/sessions" + p, { method, headers: { cookie, "content-type": "application/json" }, body: method === "POST" ? JSON.stringify({ text: "hello", request: "r-1", force: true }) : undefined });
      expect([method, p, cookie, res.status]).toEqual([method, p, cookie, 401]);
    }
  }
});

test("a sign-in cookie from before the rename still signs in, and is moved to the new name", async () => {
  const token = k.cookie.slice("kunumy=".length);
  const res = await fetch(k.url + "/api/sessions", { headers: { cookie: "ki=" + token } });
  expect(res.status).toBe(200);
  const set = res.headers.getSetCookie().map((c) => c.split(";")[0]);
  expect(set).toContain("kunumy=" + token);
  expect(set).toContain("ki=");
});
