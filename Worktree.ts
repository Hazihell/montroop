// Worktree
// ========
// A work session's own branch and worktree of a repo: made from a base ref
// when it starts, kept when it ends, removed when it's archived, but not
// while it holds work found nowhere else (unless forced).

import * as fs from "node:fs";
import { run } from "./Service.ts";

export namespace Worktree {

  export function git(dir: string, args: string[]): { ok: boolean; out: string } {
    const r = run(["git", "-C", dir, ...args], { GIT_TERMINAL_PROMPT: "0" });
    return { ok: r.code === 0, out: (r.out + "\n" + r.err).trim() };
  }

  // the repo's top folder, or why it's none
  export function top(repo: string): { dir: string } | { why: string } {
    const r = Worktree.git(repo, ["rev-parse", "--show-toplevel"]);
    return r.ok ? { dir: r.out } : { why: repo + " is no git repository: " + r.out };
  }

  // null: made; else why not
  export function make(repo: string, base: string, branch: string, dir: string): string | null {
    if (fs.existsSync(dir)) {
      return dir + " exists already";
    }
    const r = Worktree.git(repo, ["worktree", "add", "-b", branch, dir, base]);
    return r.ok ? null : "git worktree add failed: " + r.out;
  }

  // the commits of ref that are neither on a remote branch nor on base
  export function ahead(dir: string, ref: string, base: string): number {
    const r = Worktree.git(dir, ["rev-list", "--count", ref, "--not", "--remotes", base]);
    return r.ok ? Number(r.out) || 0 : 0;
  }

  // what removing it would lose: its commits found nowhere else, and
  // changes not committed
  export function unsaved(dir: string, base: string): string[] {
    const changes = Worktree.git(dir, ["status", "--porcelain"]);
    const [c, f] = [Worktree.ahead(dir, "HEAD", base), changes.ok && changes.out !== "" ? changes.out.split("\n").length : 0];
    return [...(c > 0 ? [c + " commit" + (c === 1 ? "" : "s") + " not pushed"] : []), ...(f > 0 ? [f + " file" + (f === 1 ? "" : "s") + " not committed"] : [])];
  }

  // the worktree and its branch removed; null: done (or gone already),
  // else why not
  export function remove(repo: string, base: string, dir: string, branch: string, force: boolean): string | null {
    if (fs.existsSync(dir)) {
      const lost = Worktree.unsaved(dir, base);
      if (lost.length > 0 && !force) {
        return dir + " has " + lost.join(" and ") + ": push it first, or force";
      }
      const r = Worktree.git(repo, ["worktree", "remove", "--force", dir]);
      if (!r.ok) {
        return "git worktree remove failed: " + r.out;
      }
    }
    Worktree.git(repo, ["worktree", "prune"]);
    if (Worktree.git(repo, ["rev-parse", "--verify", "--quiet", "refs/heads/" + branch]).ok && (force || Worktree.ahead(repo, branch, base) === 0)) {
      Worktree.git(repo, ["branch", "-D", branch]);
    }
    return null;
  }

}
