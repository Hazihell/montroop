import "../home.ts";
import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Sessions } from "../../Sessions.ts";
import { Setup } from "../../Setup.ts";
import type { Ev } from "../../Wire.ts";

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

test("a setup command needs its repo", () => {
  expect(Sessions.tool("setter4", { action: "setup", command: "true" })).toEqual({ text: "A setup is for a repo: give repo with command.", fail: true });
});

test("a failed setup runs once, and is told again to each holder till its run began", async () => {
  const r = repo();
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holder-"));
  Sessions.tool("setter5", { action: "setup", repo: r, command: "echo ran >> ../runs-" + path.basename(worktree) + "; echo broken >&2; exit 2" });
  Setup.arm("setter5", r, worktree, dir);
  const told: Ev[] = [];

  const first = await Setup.run(dir, (ev) => told.push(ev));
  expect(first).toStartWith("The setup of your worktree failed (it exited with 2).");
  expect(first).toContain("\nIts last lines:\nbroken\n");
  expect(await Setup.run(dir, (ev) => told.push(ev))).toBe(first);
  expect(fs.readFileSync(path.join(path.dirname(worktree), "runs-" + path.basename(worktree)), "utf8")).toBe("ran\n");
  expect(told).toEqual([{ k: "setup", ok: null, text: "echo ran >> ../runs-" + path.basename(worktree) + "; echo broken >&2; exit 2" }, { k: "setup", ok: false, text: "broken" }]);
  Setup.began(dir);
  expect(await Setup.run(dir, () => {})).toBe("");
});
