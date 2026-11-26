// Setup
// =====
// An agent's setup for the new worktrees of a repo, so its subagents don't
// start in a bare checkout (no dependencies, no gitignored env files). Each
// agent keeps one shell command per repo (its top folder) in montroop.db,
// set with its subagent tool. When one of its workers gets a new worktree
// of that repo, the setup is armed in the worker's folder; its holder,
// before the first turn, copies the repo's gitignored files that the repo's
// .worktreeinclude names (as Claude Code does), then runs the command in
// the worktree with TROOP_REPO (the repo's main checkout) and
// TROOP_WORKTREE set, for at most MINUTES. The output's last lines go into
// the worker's log; a setup that failed is told in its first message (again
// by the next holder, if one ends before the provider has that message), so
// it can fix what it needs. An agent that starts its first worker on a repo
// with no setup is told once to agree one with the user.

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Database } from "bun:sqlite";
import type { Out } from "./Agent.ts";
import { text_of } from "./Json.ts";
import { Machine } from "./Machine.ts";
import { Owner } from "./Owner.ts";
import type { Ev } from "./Wire.ts";
import { Worktree } from "./Worktree.ts";

// what a holder runs: the repo's main checkout, the new worktree, the
// command ("": only the .worktreeinclude copy)
type Armed = { repo: string; worktree: string; command: string };

const FILE = "setup.json";

// what a failed setup tells the run's first message, kept till the run
// began
const FAILED = "setup-failed.txt";

const INCLUDE = ".worktreeinclude";

export const MINUTES = 10;

// how long the output's pipes may stay open after the command exits,
// held by something it left running
const DRAIN = 2000;

// the output kept, and the lines of it logged and told
const KEPT = 8000;
const LINES = 30;

const SCHEMA = "create table if not exists setups (agent text not null, repo text not null, command text not null, primary key (agent, repo))";
// the repos each agent was told to agree a setup for
const ASKED = "create table if not exists setup_asks (agent text not null, repo text not null, primary key (agent, repo))";

let MADE = false;

export namespace Setup {

  function opened(): Database {
    const db = Owner.open();
    if (!MADE) {
      db.run(SCHEMA);
      db.run(ASKED);
      MADE = true;
    }
    return db;
  }

  // the agent's command for the repo's new worktrees; "": none
  function command(agent: string, repo: string): string {
    const row = opened().query("select command from setups where agent = ? and repo = ?").get(agent, repo) as { command: string } | null;
    return row?.command ?? "";
  }

  // each of the agent's setups, as list shows them
  export function listed(agent: string): string[] {
    const rows = opened().query("select repo, command from setups where agent = ? order by repo").all(agent) as Array<{ repo: string; command: string }>;
    return rows.map((r) => "Worktree setup for " + r.repo + ": " + r.command);
  }

  // the subagent tool's setup action: repo's command
  // shown (no command given), set, or cleared (an empty one)
  export function tool(agent: string, args: Record<string, unknown>): Out {
    const given = text_of(args.repo, "").trim();
    if (given === "" && args.command !== undefined && args.command !== null) {
      return { text: "A setup is for a repo: give repo with command.", fail: true };
    }
    if (given === "") {
      const all = Setup.listed(agent);
      return { text: all.length === 0 ? "You have no worktree setups. Set one with repo and command." : all.join("\n"), fail: false };
    }
    const top = Worktree.top(Machine.home(given));
    if ("why" in top) {
      return { text: top.why, fail: true };
    }
    const repo = top.dir;
    const include = fs.existsSync(path.join(repo, INCLUDE)) ? " Its " + INCLUDE + "'s gitignored files are copied in first." : "";
    if (args.command === undefined || args.command === null) {
      const now = command(agent, repo);
      return { text: (now === "" ? "No worktree setup for " + repo + "." : "Worktree setup for " + repo + ": " + now) + include, fail: false };
    }
    const next = text_of(args.command).trim();
    if (next === "") {
      opened().query("delete from setups where agent = ? and repo = ?").run(agent, repo);
      return { text: "Cleared the worktree setup for " + repo + "." + include, fail: false };
    }
    opened().query("insert into setups (agent, repo, command) values (?, ?, ?) on conflict (agent, repo) do update set command = excluded.command").run(agent, repo, next);
    return { text: "Set: each new worktree of " + repo + " that a subagent of yours gets runs this in it before its first turn, with TROOP_REPO=" + repo + " and TROOP_WORKTREE its path, for at most " + MINUTES + " minutes: " + next + include, fail: false };
  }

  // the agent, starting a worker on repo, marked as told to agree a setup
  // for it with the user: true the first time, unless it has one
  export function mark_asked(agent: string, repo: string): boolean {
    return command(agent, repo) === "" && opened().query("insert into setup_asks (agent, repo) values (?, ?) on conflict do nothing").run(agent, repo).changes > 0;
  }

  // an agent gone: its setups with it
  export function drop(agent: string): void {
    opened().query("delete from setups where agent = ?").run(agent);
    opened().query("delete from setup_asks where agent = ?").run(agent);
  }

  // a new worktree of repo, made for a subagent or session of agent's
  // whose folder is dir: its setup armed for its holder, if it has any
  export function arm(agent: string, repo: string, worktree: string, dir: string): void {
    const armed: Armed = { repo, worktree, command: command(agent, repo) };
    if (armed.command !== "" || fs.existsSync(path.join(repo, INCLUDE))) {
      fs.writeFileSync(path.join(dir, FILE), JSON.stringify(armed) + "\n", { mode: 0o600 });
    }
  }

  // in the holder, before the run's first turn: the setup armed in its
  // folder dir done, and disarmed, each step told; what the first message
  // starts with, "" for nothing (none armed, or it went well). A holder
  // that dies midway leaves it armed, so the next one runs it again; one
  // that dies after it failed, before the provider had its first message,
  // leaves the failure to tell again
  export async function run(dir: string, emit: (ev: Ev) => void): Promise<string> {
    let armed: Armed;
    try {
      armed = JSON.parse(fs.readFileSync(path.join(dir, FILE), "utf8")) as Armed;
    } catch {
      return told(dir);
    }
    fs.rmSync(path.join(dir, FAILED), { force: true });
    emit({ k: "setup", ok: null, text: armed.command });
    const copy = included(armed.repo, armed.worktree);
    const ran = armed.command === "" ? { why: null, out: "" } : await shell(armed);
    const out = last([copy, ran.out].filter((t) => t !== "").join("\n"));
    const why = ran.why ?? (copy === "" ? null : "copying the files " + INCLUDE + " names failed");
    const note = why === null ? "" : "The setup of your worktree failed (" + why + "). Your agent sets it to run in each new worktree of " + armed.repo + (armed.command === "" ? "" : ": " + armed.command) + "\nIts last lines:\n" + (out || "(none)") + "\n\nFix what your task needs of it (dependencies, env files) before you go on.";
    if (note !== "") {
      fs.writeFileSync(path.join(dir, FAILED), note, { mode: 0o600 });
    }
    fs.rmSync(path.join(dir, FILE), { force: true });
    emit({ k: "setup", ok: why === null, text: out });
    return note;
  }

  // the run in dir began, or its model answered: its first message, with a
  // failure told, is the provider's now
  export function taken(dir: string): void {
    fs.rmSync(path.join(dir, FAILED), { force: true });
  }

  // a failure a holder before this one told, its run not begun yet
  function told(dir: string): string {
    try {
      return fs.readFileSync(path.join(dir, FAILED), "utf8");
    } catch {
      return "";
    }
  }

  // the repo's untracked, gitignored files that its .worktreeinclude
  // names, copied into the worktree unless there already; "" when all
  // went well, else what failed
  function included(repo: string, worktree: string): string {
    const list = path.join(repo, INCLUDE);
    if (!fs.existsSync(list)) {
      return "";
    }
    const named = git(repo, ["ls-files", "-z", "--others", "--ignored", "--exclude-from=" + list], "");
    const ignored = named.ok && named.out !== "" ? git(repo, ["check-ignore", "-z", "--stdin"], named.out) : named;
    if (!ignored.ok) {
      return "git couldn't list the files " + INCLUDE + " names: " + ignored.out;
    }
    const failed: string[] = [];
    for (const rel of ignored.out.split("\0").filter((f) => f !== "")) {
      const to = path.join(worktree, rel);
      try {
        if (!fs.existsSync(to)) {
          fs.mkdirSync(path.dirname(to), { recursive: true });
          fs.cpSync(path.join(repo, rel), to, { preserveTimestamps: true });
        }
      } catch (err) {
        failed.push(rel + ": " + String(err));
      }
    }
    return failed.join("\n");
  }

  // git in dir on input; check-ignore exits 1 when it found none
  function git(dir: string, args: string[], input: string): { ok: boolean; out: string } {
    const p = Bun.spawnSync(["git", "-C", dir, ...args], { stdin: Buffer.from(input), stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    const ok = p.exitCode === 0 || (args[0] === "check-ignore" && p.exitCode === 1);
    return { ok, out: ok ? p.stdout.toString() : p.stderr.toString().trim() };
  }

  // the command run with the user's shell in the worktree, its errors on
  // its output's one pipe so their lines keep their order, in a process
  // group of its own, killed whole when it exits or runs out of time; why:
  // how it failed, null if it didn't
  function shell(a: Armed): Promise<{ why: string | null; out: string }> {
    return new Promise((done) => {
      let out = "";
      let why: string | null = null;
      const p = spawn("/bin/sh", ["-c", "exec \"$0\" -c \"$1\" 2>&1", process.env.SHELL || "/bin/sh", a.command], { cwd: a.worktree, env: { ...process.env, TROOP_REPO: a.repo, TROOP_WORKTREE: a.worktree }, detached: true, stdio: ["ignore", "pipe", "ignore"] });
      p.stdout.on("data", (b: Buffer) => void (out = (out + b.toString("utf8")).slice(-KEPT)));
      const kill = () => {
        try {
          if (p.pid !== undefined) {
            process.kill(-p.pid, "SIGKILL");
          }
        } catch {}
      };
      const finish = () => {
        clearTimeout(timer);
        p.stdout.destroy();
        done({ why, out });
      };
      const timer = setTimeout(() => {
        why = "it was stopped after " + MINUTES + " minutes";
        kill();
      }, MINUTES * 60e3);
      p.on("error", (err) => {
        why = "it couldn't start: " + String(err);
        finish();
      });
      p.on("exit", (code, signal) => {
        clearTimeout(timer);
        why ??= code === 0 ? null : code !== null ? "it exited with " + code : "it was killed by " + String(signal);
        kill();
        setTimeout(finish, DRAIN).unref();
      });
      p.on("close", finish);
    });
  }

  // the last LINES lines of what it printed
  function last(text: string): string {
    return text.trimEnd().split("\n").slice(-LINES).join("\n");
  }

}
