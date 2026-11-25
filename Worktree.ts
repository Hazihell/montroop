// Worktree
// ========
// A work session's own branch and worktree of a repo: made from a base ref
// when it starts, kept when it ends, removed when it's archived, but not
// while it holds work found nowhere else (unless forced); or a worktree on
// no branch, for work that keeps nothing.

import * as fs from "node:fs";
import { output, run } from "./Service.ts";

export namespace Worktree {

  function git(dir: string, args: string[]): { ok: boolean; out: string } {
    const r = run(["git", "-C", dir, ...args], { GIT_TERMINAL_PROMPT: "0" });
    return { ok: r.code === 0, out: output(r) };
  }

  // the repo's top folder, or why it's none
  export function top(repo: string): { dir: string } | { why: string } {
    const r = git(repo, ["rev-parse", "--show-toplevel"]);
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
    const branch = ref === "HEAD" ? git(repo, ["symbolic-ref", "--quiet", "--short", "HEAD"]) : { ok: false, out: "" };
    const commit = branch.ok ? branch : git(repo, ["rev-parse", "--verify", ref + "^{commit}"]);
    return commit.ok ? commit.out : ref;
  }

  // why branch can't be a session's new branch: no valid name, or one
  // the repo has already, locally or on a remote; null: it can
  export function taken(repo: string, branch: string): string | null {
    const name = git(repo, ["check-ref-format", "--branch", branch]);
    if (!name.ok || name.out !== branch) {
      return branch + " is no valid branch name (see git check-ref-format): pick another, or leave branch out for the default";
    }
    const remotes = git(repo, ["remote"]).out.split("\n").filter((r) => r !== "");
    const refs = ["refs/heads/" + branch, ...remotes.map((r) => "refs/remotes/" + r + "/" + branch)];
    const had = refs.find((ref) => git(repo, ["rev-parse", "--verify", "--quiet", ref]).ok);
    return had === undefined ? null : "The repo has a branch " + had.replace(/^refs\/(heads|remotes)\//, "") + " already: a session works on a new branch, so pick another name";
  }

  // null: made; else why not
  export function make(repo: string, base: string, branch: string, dir: string): string | null {
    const why = taken(repo, branch);
    if (why !== null) {
      return why;
    }
    if (fs.existsSync(dir)) {
      return dir + " exists already";
    }
    const r = git(repo, ["worktree", "add", "-b", branch, dir, base]);
    return r.ok ? null : "git worktree add failed: " + r.out;
  }

  // a worktree at base on no branch, for work that keeps nothing (a
  // review); null: made, else why not
  export function detach(repo: string, base: string, dir: string): string | null {
    if (fs.existsSync(dir)) {
      return dir + " exists already";
    }
    const r = git(repo, ["worktree", "add", "--detach", dir, base]);
    return r.ok ? null : "git worktree add failed: " + r.out;
  }

  // the commits of ref that are neither on a remote branch nor on base;
  // null: git couldn't count them (base gone, say)
  function ahead(dir: string, ref: string, base: string): number | null {
    const r = git(dir, ["rev-list", "--count", ref, "--not", "--remotes", base]);
    return r.ok ? Number(r.out) || 0 : null;
  }

  // what removing it would lose: its commits found nowhere else, and
  // changes not committed (what git couldn't check counts as lost)
  function unsaved(dir: string, base: string): string[] {
    const changes = git(dir, ["status", "--porcelain"]);
    const [c, f] = [ahead(dir, "HEAD", base), !changes.ok ? null : changes.out === "" ? 0 : changes.out.split("\n").length];
    const count = (n: number | null, what: string, not: string) => (n === null ? [what + "s not checkable"] : n > 0 ? [n + " " + what + (n === 1 ? "" : "s") + " " + not] : []);
    return [...count(c, "commit", "not pushed"), ...count(f, "file", "not committed")];
  }

  // the worktree and its branch removed; null: done (or gone already),
  // else why not
  export function remove(repo: string, base: string, branch: string, dir: string, force: boolean): string | null {
    if (fs.existsSync(dir)) {
      const lost = unsaved(dir, base);
      if (lost.length > 0 && !force) {
        return dir + " has " + lost.join(" and ") + (lost.some((l) => l.endsWith("not checkable")) ? ": check them, then force" : ": push it first, or force");
      }
      const r = git(repo, ["worktree", "remove", "--force", dir]);
      if (!r.ok) {
        return "git worktree remove failed: " + r.out;
      }
    }
    git(repo, ["worktree", "prune"]);
    if (git(repo, ["rev-parse", "--verify", "--quiet", "refs/heads/" + branch]).ok && (force || ahead(repo, branch, base) === 0)) {
      git(repo, ["branch", "-D", branch]);
    }
    return null;
  }

}
