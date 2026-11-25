import { DIR } from "../home.ts";
import { expect, test } from "bun:test";
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

test("a message sent with the session tool needs a request, so a retry sends it once", () => {
  expect(Sessions.tool("owner1", { action: "send", name: "mine", text: "hello" })).toEqual({ text: "send needs a request: an id of your own for this message (any new text); on a retry, the same one, so it's sent once.", fail: true });
});
