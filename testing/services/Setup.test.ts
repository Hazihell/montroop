import "../home.ts";
import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Sessions } from "../../Sessions.ts";

// a git repo with one commit, by its top folder
function repo(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "repo-")));
  const git = (...args: string[]) => Bun.spawnSync(["git", "-C", dir, ...args]);
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "README.md"), "# Test app\n");
  git("add", ".");
  git("-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-qm", "start");
  return dir;
}

test("a mon's worktree setup for a repo is set, shown, listed and cleared with its tools, and no other mon's", () => {
  const r = repo();
  const command = "cp \"$TROOP_REPO\"/.env* . 2>/dev/null; bun install --frozen-lockfile";
  expect(Sessions.tool("setter1", { action: "setup", repo: r })).toEqual({ text: "No worktree setup for " + r + ".", fail: false });
  expect(Sessions.act("setter1", "subagent", { action: "setup", repo: r + "/", command }).text).toStartWith("Set: ");
  expect(Sessions.tool("setter1", { action: "setup", repo: r })).toEqual({ text: "Worktree setup for " + r + ": " + command, fail: false });
  expect(Sessions.act("setter1", "subagent", { action: "list" }).text).toContain("\nWorktree setup for " + r + ": " + command);
  expect(Sessions.tool("setter1", { action: "list" }).text).toContain("\nWorktree setup for " + r + ": " + command);
  expect(Sessions.tool("setter2", { action: "setup", repo: r })).toEqual({ text: "No worktree setup for " + r + ".", fail: false });
  expect(Sessions.tool("setter2", { action: "list" })).toEqual({ text: "You have no sessions.", fail: false });

  expect(Sessions.tool("setter1", { action: "setup", repo: r, command: "" })).toEqual({ text: "Cleared the worktree setup for " + r + ".", fail: false });
  expect(Sessions.tool("setter1", { action: "setup", repo: r })).toEqual({ text: "No worktree setup for " + r + ".", fail: false });
});

test("a setup is for a git repo only", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plain-"));
  const out = Sessions.tool("setter3", { action: "setup", repo: dir, command: "true" });
  expect(out.fail).toBe(true);
  expect(out.text).toStartWith(dir + " is no git repository");
});
