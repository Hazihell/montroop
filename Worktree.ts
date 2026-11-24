// Worktree
// ========
// A work session's own branch and worktree of a repo: made from a base ref
// when it starts, kept when it ends, removed when it's archived, but not
// while it holds work found nowhere else (unless forced).

import * as fs from "node:fs";

export namespace Worktree {

  export function git(dir: string, args: string[]): { ok: boolean; out: string } {
    const run = Bun.spawnSync(["git", "-C", dir, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const out = (run.stdout.toString() + run.stderr.toString()).trim();
    return { ok: run.exitCode === 0, out };
  }

  // the repo's top folder, or why it's none
  export function top(repo: string): { dir: string } | { why: string } {
    const run = Worktree.git(repo, ["rev-parse", "--show-toplevel"]);
    return run.ok ? { dir: run.out } : { why: repo + " is no git repository: " + run.out };
  }

  // null: made; else why not
  export function make(repo: string, base: string, branch: string, dir: string): string | null {
    if (fs.existsSync(dir)) {
      return dir + " exists already";
    }
    const run = Worktree.git(repo, ["worktree", "add", "-b", branch, dir, base]);
    return run.ok ? null : "git worktree add failed: " + run.out;
  }

  // what removing it would lose: commits on no remote branch, and changes
  // not committed
  export function unsaved(dir: string): string[] {
    const commits = Worktree.git(dir, ["log", "--oneline", "HEAD", "--not", "--remotes"]);
    const changes = Worktree.git(dir, ["status", "--porcelain"]);
    const n = (run: { ok: boolean; out: string }) => (run.ok && run.out !== "" ? run.out.split("\n").length : 0);
    const [c, f] = [n(commits), n(changes)];
    return [...(c > 0 ? [c + " commit" + (c === 1 ? "" : "s") + " not pushed"] : []), ...(f > 0 ? [f + " file" + (f === 1 ? "" : "s") + " not committed"] : [])];
  }

  // the worktree and its branch removed; null: done (or gone already),
  // else why not
  export function remove(repo: string, dir: string, branch: string, force: boolean): string | null {
    if (fs.existsSync(dir)) {
      const lost = Worktree.unsaved(dir);
      if (lost.length > 0 && !force) {
        return dir + " has " + lost.join(" and ") + ": push it first, or force";
      }
      const run = Worktree.git(repo, ["worktree", "remove", "--force", dir]);
      if (!run.ok) {
        return "git worktree remove failed: " + run.out;
      }
    }
    Worktree.git(repo, ["worktree", "prune"]);
    const kept = Worktree.git(repo, ["rev-parse", "--verify", "--quiet", "refs/heads/" + branch]);
    if (kept.ok) {
      const ahead = Worktree.git(repo, ["log", "--oneline", branch, "--not", "--remotes"]);
      if (force || (ahead.ok && ahead.out === "")) {
        Worktree.git(repo, ["branch", "-D", branch]);
      }
    }
    return null;
  }

}
