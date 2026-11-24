// Worktree
// ========
// A work session's own branch and worktree of a repo: made from a base ref
// when it starts, kept when it ends, removed when it's archived, but not
// while it holds work found nowhere else (unless forced).

import * as fs from "node:fs";
import { output, run } from "./Service.ts";

export namespace Worktree {

  export function git(dir: string, args: string[]): { ok: boolean; out: string } {
    const r = run(["git", "-C", dir, ...args], { GIT_TERMINAL_PROMPT: "0" });
    return { ok: r.code === 0, out: output(r) };
  }

  // the repo's top folder, or why it's none
  export function top(repo: string): { dir: string } | { why: string } {
    const r = Worktree.git(repo, ["rev-parse", "--show-toplevel"]);
    return r.ok ? { dir: r.out } : { why: repo + " is no git repository: " + r.out };
  }

  // the ref a session starts from, as one that means the same in its
  // worktree: HEAD is the repo's branch (its commit when detached), a ref
  // relative to HEAD its commit; so archive later counts the session's own
  // commits, not the ones its branch adds to HEAD
  export function named(repo: string, ref: string): string {
    if (!/^HEAD([~^@]|$)/.test(ref)) {
      return ref;
    }
    const branch = ref === "HEAD" ? Worktree.git(repo, ["symbolic-ref", "--quiet", "--short", "HEAD"]) : { ok: false, out: "" };
    const commit = branch.ok ? branch : Worktree.git(repo, ["rev-parse", "--verify", ref + "^{commit}"]);
    return commit.ok ? commit.out : ref;
  }

  // null: made; else why not
  export function make(repo: string, base: string, branch: string, dir: string): string | null {
    if (fs.existsSync(dir)) {
      return dir + " exists already";
    }
    const r = Worktree.git(repo, ["worktree", "add", "-b", branch, dir, base]);
    return r.ok ? null : "git worktree add failed: " + r.out;
  }

  // the commits of ref that are neither on a remote branch nor on base;
  // null: git couldn't count them (base gone, say)
  export function ahead(dir: string, ref: string, base: string): number | null {
    const r = Worktree.git(dir, ["rev-list", "--count", ref, "--not", "--remotes", base]);
    return r.ok ? Number(r.out) || 0 : null;
  }

  // what removing it would lose: its commits found nowhere else, and
  // changes not committed (what git couldn't check counts as lost)
  export function unsaved(dir: string, base: string): string[] {
    const changes = Worktree.git(dir, ["status", "--porcelain"]);
    const [c, f] = [Worktree.ahead(dir, "HEAD", base), !changes.ok ? null : changes.out === "" ? 0 : changes.out.split("\n").length];
    const count = (n: number | null, what: string, not: string) => (n === null ? [what + "s not checkable"] : n > 0 ? [n + " " + what + (n === 1 ? "" : "s") + " " + not] : []);
    return [...count(c, "commit", "not pushed"), ...count(f, "file", "not committed")];
  }

  // the worktree and its branch removed; null: done (or gone already),
  // else why not
  export function remove(repo: string, base: string, branch: string, dir: string, force: boolean): string | null {
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
