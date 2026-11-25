import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Worktree } from "../../Worktree.ts";
import { git, repo } from "../rig.ts";

function place(r: string, name: string): string {
  return path.join(path.dirname(r), name);
}

test("a session's worktree is made on the branch it names, from its base", () => {
  const r = repo();
  const dir = place(r, "wt");
  expect(Worktree.make(r, "main", "feat/42-custom", dir)).toBeNull();
  expect(git(dir, "symbolic-ref", "--short", "HEAD")).toBe("feat/42-custom");
  expect(git(dir, "rev-parse", "HEAD")).toBe(git(r, "rev-parse", "main"));
});

test("a branch name git refuses is refused", () => {
  const r = repo();
  expect(Worktree.make(r, "main", "bad..name", place(r, "wt"))).toBe("bad..name is no valid branch name (see git check-ref-format): pick another, or leave branch out for the default");
  expect(fs.existsSync(place(r, "wt"))).toBe(false);
});

test("a branch the repo has already, locally or on a remote, is refused", () => {
  const r = repo();
  git(r, "branch", "fix/taken", "main");
  git(r, "push", "-q", "origin", "main:feat/remote-only");
  git(r, "fetch", "-q", "origin");
  expect(Worktree.make(r, "main", "fix/taken", place(r, "a"))).toBe("The repo has a branch fix/taken already: a session works on a new branch, so pick another name");
  expect(Worktree.make(r, "main", "feat/remote-only", place(r, "b"))).toBe("The repo has a branch origin/feat/remote-only already: a session works on a new branch, so pick another name");
});

test("a branch git couldn't keep beside one the repo or its remote has, a folder of it or its parent, is refused", () => {
  const r = repo();
  git(r, "branch", "feat/x", "main");
  git(r, "push", "-q", "origin", "main:release/1");
  git(r, "fetch", "-q", "origin");
  expect(Worktree.make(r, "main", "feat", place(r, "a"))).toBe("The repo has a branch feat/x already, so git can't keep feat beside it: pick another name");
  expect(Worktree.make(r, "main", "release/1/hotfix", place(r, "b"))).toBe("The repo has a branch origin/release/1 already, so release/1/hotfix couldn't be pushed to origin: pick another name");
  expect(Worktree.make(r, "main", "feat-x", place(r, "c"))).toBeNull();
});

test("a session started from HEAD starts from the repo's branch", () => {
  const r = repo();
  expect(Worktree.named(r, "HEAD")).toBe("main");
});

test("archiving removes the worktree and its branch, and no other branch", () => {
  const r = repo();
  git(r, "branch", "keep", "main");
  const dir = place(r, "wt");
  Worktree.make(r, "main", "troop/done", dir);
  expect(Worktree.remove(r, "main", "troop/done", dir, false)).toBeNull();
  expect(fs.existsSync(dir)).toBe(false);
  expect(git(r, "branch", "--format=%(refname:short)").split("\n")).toEqual(["keep", "main"]);
});

test("archiving refuses to lose work found nowhere else, unless forced", () => {
  const r = repo();
  const dir = place(r, "wt");
  Worktree.make(r, "main", "troop/work", dir);
  git(dir, "commit", "-q", "--allow-empty", "-m", "mine");
  fs.writeFileSync(path.join(dir, "draft.txt"), "draft\n");
  expect(Worktree.remove(r, "main", "troop/work", dir, false)).toBe(dir + " has 1 commit not pushed and 1 file not committed: push it first, or force");
  expect(fs.existsSync(path.join(dir, "draft.txt"))).toBe(true);
  expect(Worktree.remove(r, "main", "troop/work", dir, true)).toBeNull();
  expect([fs.existsSync(dir), git(r, "branch", "--list", "troop/work")]).toEqual([false, ""]);
});

test("a branch pushed to a remote counts as saved", () => {
  const r = repo();
  const dir = place(r, "wt");
  Worktree.make(r, "main", "troop/pushed", dir);
  git(dir, "commit", "-q", "--allow-empty", "-m", "mine");
  git(dir, "push", "-q", "origin", "troop/pushed");
  expect(Worktree.remove(r, "main", "troop/pushed", dir, false)).toBeNull();
});
