// Setup
// =====
// A mon's setup for the new worktrees of a repo, so its submons don't start
// in a bare checkout (no dependencies, no gitignored env files). Each mon
// keeps one shell command per repo (its top folder) in montroop.db, set
// with its session or subagent tool. When one of its submons gets a new
// worktree of that repo, the setup is armed in the submon's folder; its
// holder, before the first turn, copies the repo's gitignored files that
// the repo's .worktreeinclude names (as Claude Code does), then runs the
// command in the worktree with TROOP_REPO (the repo's main checkout) and
// TROOP_WORKTREE set, for at most TIMEOUT. The output's last lines go into
// the submon's log; a setup that failed is told to the submon in its first
// message, so it can fix what it needs.

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

const INCLUDE = ".worktreeinclude";

const TIMEOUT = 10 * 60e3;

// how long the output's pipes may stay open after the command exits,
// held by something it left running
const DRAIN = 2000;

// the output kept, and the lines of it logged and told
const KEPT = 8000;
const LINES = 30;

const SCHEMA = "create table if not exists setups (agent text not null, repo text not null, command text not null, primary key (agent, repo))";

let MADE = false;

export namespace Setup {

  function opened(): Database {
    const db = Owner.open();
    if (!MADE) {
      db.run(SCHEMA);
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

  // the setup action of the session and subagent tools: repo's command
  // shown (no command given), set, or cleared (an empty one)
  export function tool(agent: string, args: Record<string, unknown>): Out {
    const given = text_of(args.repo, "").trim();
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
    return { text: "Set: each new worktree of " + repo + " that a submon of yours gets runs this in it before the submon's first turn, with TROOP_REPO=" + repo + " and TROOP_WORKTREE its path, for at most " + TIMEOUT / 60e3 + " minutes: " + next + include, fail: false };
  }

  // an agent gone: its setups with it
  export function drop(agent: string): void {
    opened().query("delete from setups where agent = ?").run(agent);
  }

  // a new worktree of repo, made for a submon of agent's whose folder is
  // dir: its setup armed for the submon's holder, if it has any
  export function arm(agent: string, repo: string, worktree: string, dir: string): void {
    const armed: Armed = { repo, worktree, command: command(agent, repo) };
    if (armed.command !== "" || fs.existsSync(path.join(repo, INCLUDE))) {
      fs.writeFileSync(path.join(dir, FILE), JSON.stringify(armed) + "\n", { mode: 0o600 });
    }
  }

  // in the holder, before the run's first turn: the setup armed in its
  // folder dir done, and disarmed, each step told; what the first message
  // starts with, "" for nothing (none armed, or it went well). A holder
  // that dies midway leaves it armed, so the next one runs it again
  export async function run(dir: string, emit: (ev: Ev) => void): Promise<string> {
    const file = path.join(dir, FILE);
    let armed: Armed;
    try {
      armed = JSON.parse(fs.readFileSync(file, "utf8")) as Armed;
    } catch {
      return "";
    }
    emit({ k: "setup", ok: null, text: armed.command });
    const copy = included(armed.repo, armed.worktree);
    const ran = armed.command === "" ? { code: 0, out: "" } : await shell(armed);
    const out = last([copy, ran.out].filter((t) => t !== "").join("\n"));
    const ok = ran.code === 0 && copy === "";
    fs.rmSync(file, { force: true });
    emit({ k: "setup", ok, text: out });
    if (ok) {
      return "";
    }
    const how = ran.code === null ? "it was stopped after " + TIMEOUT / 60e3 + " minutes" : ran.code !== 0 ? "it exited with " + ran.code : "copying the files " + INCLUDE + " names failed";
    return "The setup of your worktree failed (" + how + "). Your agent sets it to run in each new worktree of " + armed.repo + (armed.command === "" ? "" : ": " + armed.command) + "\nIts last lines:\n" + (out || "(none)") + "\n\nFix what your task needs of it (dependencies, env files) before you go on.";
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

  // the command run with the user's shell in the worktree, in a process
  // group of its own, killed whole when it exits or runs out of time;
  // code null: it ran out of time
  function shell(a: Armed): Promise<{ code: number | null; out: string }> {
    return new Promise((done) => {
      let out = "";
      let late = false;
      let exited: number | null = null;
      const p = spawn(process.env.SHELL || "/bin/sh", ["-c", a.command], { cwd: a.worktree, env: { ...process.env, TROOP_REPO: a.repo, TROOP_WORKTREE: a.worktree }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
      const keep = (b: Buffer) => void (out = (out + b.toString("utf8")).slice(-KEPT));
      p.stdout.on("data", keep);
      p.stderr.on("data", keep);
      const kill = () => {
        try {
          if (p.pid !== undefined) {
            process.kill(-p.pid, "SIGKILL");
          }
        } catch {}
      };
      const finish = () => {
        clearTimeout(timer);
        done({ code: late ? null : exited ?? 1, out });
      };
      const timer = setTimeout(() => {
        late = true;
        kill();
      }, TIMEOUT);
      p.on("error", (err) => {
        out += String(err);
        finish();
      });
      p.on("exit", (code) => {
        exited = code;
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
