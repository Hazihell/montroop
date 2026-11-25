import { DIR } from "../home.ts";
import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Session } from "../../Session.ts";
import { Sessions } from "../../Sessions.ts";

const mine = Session.add({ id: "0123abcd", name: "mine", agent: "owner1", repo: "/repo", base: "main", branch: "kny/mine", worktree: "/repo-mine", account: "", model: "", dir: path.join(DIR, "sessions", "0123abcd") }, "the first message");

test("an agent's session tool lists only its own sessions", () => {
  expect(Sessions.tool("owner1", { action: "list" })).toEqual({ text: "mine: running, branch kny/mine", fail: false });
  expect(Sessions.tool("other1", { action: "list" })).toEqual({ text: "You have no sessions.", fail: false });
});

test("another agent can't read, send to, stop or archive a session", () => {
  for (const action of ["read", "send", "stop", "archive"]) {
    expect([action, Sessions.tool("other1", { action, name: "mine", text: "hello", request: "r-1" })]).toEqual([action, { text: "You have no session \"mine\". Yours: none.", fail: true }]);
  }
  expect(Session.get(mine.id)).toMatchObject({ status: "running", archived: 0 });
  expect(Session.says(mine.id)).toEqual([]);
});

test("the session tool sees an agent's sessions, and the subagent tool its subagents, another agent's none", () => {
  Session.add({ id: "4567cdef", name: "helper", agent: "owner1", repo: "", base: "", branch: "", worktree: "/scratch/owner1/sessions/helper", provider: "claude", account: "", model: "claude-haiku-5-5", effort: "low", memory: 1, write: 1, device: "", dir: path.join(DIR, "sessions", "4567cdef") }, "the task");
  expect(Sessions.act("owner1", "subagent", { action: "list" })).toEqual({ text: "helper: running", fail: false });
  expect(Sessions.tool("owner1", { action: "list" })).toEqual({ text: "mine: running, branch kny/mine", fail: false });
  expect(Sessions.tool("owner1", { action: "read", name: "helper" })).toEqual({ text: "You have no session \"helper\". Yours: mine.", fail: true });
  for (const action of ["read", "send", "stop", "archive"]) {
    expect([action, Sessions.act("other1", "subagent", { action, name: "helper", text: "hello", request: "r-1" })]).toEqual([action, { text: "You have no subagent \"helper\". Yours: none.", fail: true }]);
  }
  expect(Session.get("4567cdef")).toMatchObject({ status: "running", archived: 0 });
});

test("a message sent with the session tool needs a request, so a retry sends it once", () => {
  expect(Sessions.tool("owner1", { action: "send", name: "mine", text: "hello" })).toEqual({ text: "send needs a request: an id of your own for this message (any new text); on a retry, the same one, so it's sent once.", fail: true });
});

test("a session's read shows the usage limit its run waits out", () => {
  fs.mkdirSync(mine.dir, { recursive: true });
  fs.writeFileSync(path.join(mine.dir, "log.jsonl"), JSON.stringify({ seq: 1, at: 1, ev: { k: "limit", until: Date.now() + 3600e3 } }) + "\n");
  expect(Sessions.tool("owner1", { action: "read", name: "mine" }).text).toMatch(/\n1 limit: waits for a usage limit, till .*\d\d:\d\d$/);
});
