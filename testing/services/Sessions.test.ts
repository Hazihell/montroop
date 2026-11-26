import { DIR } from "../home.ts";
import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Session } from "../../Session.ts";
import { Sessions } from "../../Sessions.ts";
import type { Ev } from "../../Wire.ts";

const mine = Session.add({ id: "0123abcd", name: "mine", agent: "owner1", repo: "/repo", base: "main", branch: "troop/mine", worktree: "/repo-mine", provider: "claude", account: "", model: "claude-haiku-5-5", effort: "low", memory: 0, write: 1, device: "", dir: path.join(DIR, "sessions", "0123abcd") }, "the first message");

test("an agent's subagent tool lists only its own subagents", () => {
  expect(Sessions.act("owner1", { action: "list" }).text.split("\n")[0]).toBe("mine: running, branch troop/mine");
  expect(Sessions.act("other1", { action: "list" }).text.split("\n")[0]).toBe("You have no subagents.");
});

test("another agent can't read, send to, stop or archive a subagent", () => {
  for (const action of ["read", "send", "stop", "archive"]) {
    expect([action, Sessions.act("other1", { action, name: "mine", text: "hello", request: "r-1" })]).toEqual([action, { text: "You have no subagent \"mine\". Yours: none.", fail: true }]);
  }
  expect(Session.get(mine.id)).toMatchObject({ status: "running", archived: 0 });
  expect(Session.says(mine.id)).toEqual([]);
});

test("a message sent with the subagent tool needs a request, so a retry sends it once", () => {
  expect(Sessions.act("owner1", { action: "send", name: "mine", text: "hello" })).toEqual({ text: "send needs a request: an id of your own for this message (any new text); on a retry, the same one, so it's sent once.", fail: true });
});

test("a subagent's read shows the usage limit its run waits out", () => {
  fs.mkdirSync(mine.dir, { recursive: true });
  fs.writeFileSync(path.join(mine.dir, "log.jsonl"), JSON.stringify({ seq: 1, at: 1, ev: { k: "limit", until: Date.now() + 3600e3 } }) + "\n");
  expect(Sessions.act("owner1", { action: "read", name: "mine" }).text).toMatch(/\n1 limit: waits for a usage limit, till .*\d\d:\d\d$/);
});

// a subagent on a ChatGPT plan, its log as given, as the app lists it
function listed(id: string, log: Ev[]): ReturnType<typeof Sessions.row> {
  const s = Session.add({ id, name: "s-" + id, agent: "owner2", repo: "", base: "", branch: "", worktree: "/scratch/owner2/sessions/s-" + id, provider: "openai", account: "chatgpt", model: "gpt-6.2-astra", effort: "high", memory: 0, write: 1, device: "", dir: path.join(DIR, "sessions", id) }, "tally the herons");
  fs.mkdirSync(s.dir, { recursive: true });
  fs.writeFileSync(path.join(s.dir, "log.jsonl"), log.map((ev, k) => JSON.stringify({ seq: k + 1, at: Date.now() + k, ev }) + "\n").join(""));
  return Sessions.row(s);
}

test("one waiting out a usage limit lists as waiting on it, with its reset, and how full its context was at its latest request, in its plan's window", () => {
  expect(listed("89abcd01", [{ k: "used", tokens: 68000 }, { k: "text", text: "Counting." }, { k: "limit", until: 1795620000000 }])).toMatchObject({
    task: "tally the herons", model: "gpt-6.2-astra", effort: "high", status: "running", waits: "limit", until: 1795620000000, meter: { tokens: 68000, window: 272000 },
  });
});

test("one that went on after a usage limit no longer lists as waiting on it", () => {
  expect(listed("89abcd02", [{ k: "limit", until: 1795620000000 }, { k: "text", text: "Going on." }])).toMatchObject({ status: "running", waits: null, until: null, meter: null, last: "Going on." });
});
