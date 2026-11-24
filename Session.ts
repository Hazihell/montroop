// Session
// =======
// A work session's record in ki.db: an agent's Claude Code session on a
// repo, in its own branch and worktree, kept across server restarts. A
// session has runs (a message it works on until it's done with it), each
// tried again (an attempt) when its holder died; the calls it has parked
// for the owner's answer; the messages sent to it not yet taken in.

import { Owner } from "./Owner.ts";

export type Status = "running" | "waiting" | "done" | "failed" | "stopped";

// ask: a call parked; answered: the last parked call answered; ended,
// failed: a run's end; stop: the owner or agent stopped it; run: a new run
// or attempt began
type Step = "ask" | "answered" | "ended" | "failed" | "stop" | "run";

// account: its Claude account ("": personal); dir: its folder in Ki's,
// with its log; sdk: the Claude Code session it resumes; ack: the last of
// its holder's events taken in; launches: its holders so far (each a unit
// and socket of its own); last: its latest words
export type Session = {
  id: string; name: string; agent: string; repo: string; base: string; branch: string; worktree: string;
  account: string; model: string; dir: string; status: Status; sdk: string; ack: number; launches: number;
  last: string; made: number; at: number; archived: number;
};

type Run = { session: string; n: number; prompt: string; status: Status; attempts: number; why: string; started: number; ended: number | null };

// ok: the owner's answer, null till then; it stays till the holder says it
// took it
export type Parked = { id: string; session: string; tool: string; input: string; what: string; ok: number | null; note: string; at: number };

type Say = { id: string; session: string; text: string; at: number };

const NEXT: Record<Status, Partial<Record<Step, Status>>> = {
  running : { ask: "waiting", ended: "done", failed: "failed", stop: "stopped" },
  waiting : { ask: "waiting", answered: "running", ended: "done", failed: "failed", stop: "stopped" },
  done    : { run: "running" },
  failed  : { run: "running", stop: "stopped" },
  stopped : { run: "running" },
};

const SCHEMA = `
create table if not exists work_sessions (id text primary key, name text not null, agent text not null, repo text not null, base text not null, branch text not null, worktree text not null, account text not null, model text not null, dir text not null, status text not null, sdk text not null default '', ack integer not null default 0, launches integer not null default 0, last text not null default '', made integer not null, at integer not null, archived integer not null default 0);
create table if not exists work_runs (session text not null, n integer not null, prompt text not null, status text not null, attempts integer not null default 1, why text not null default '', started integer not null, ended integer, primary key (session, n));
create table if not exists work_asks (id text primary key, session text not null, tool text not null, input text not null, what text not null, ok integer, note text not null default '', at integer not null);
create table if not exists work_says (id text primary key, session text not null, text text not null, heard integer not null default 0, at integer not null);
`;

let MADE = false;

export const LIVE: Status[] = ["running", "waiting"];

export namespace Session {

  export function db() {
    const db = Owner.open();
    if (!MADE) {
      db.run(SCHEMA);
      MADE = true;
    }
    return db;
  }

  // what a step leads to; null: it can't happen in that status
  export function next(status: Status, step: Step): Status | null {
    return NEXT[status][step] ?? null;
  }

  export function add(s: Omit<Session, "status" | "sdk" | "ack" | "launches" | "last" | "made" | "at" | "archived">, prompt: string, now = Date.now()): Session {
    const db = Session.db();
    db.transaction(() => {
      db.query("insert into work_sessions (id, name, agent, repo, base, branch, worktree, account, model, dir, status, made, at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)").run(s.id, s.name, s.agent, s.repo, s.base, s.branch, s.worktree, s.account, s.model, s.dir, now, now);
      db.query("insert into work_runs (session, n, prompt, status, started) values (?, 1, ?, 'running', ?)").run(s.id, prompt, now);
    })();
    return Session.get(s.id) as Session;
  }

  export function get(id: string): Session | null {
    return (Session.db().query("select * from work_sessions where id = ?").get(id) as Session | null) ?? null;
  }

  // an agent's sessions, or everyone's, newest first; archived ones too
  // with all
  export function list(agent: string | null, all = false): Session[] {
    const rows = Session.db().query("select * from work_sessions where (? is null or agent = ?) and (? or archived = 0) order by made desc").all(agent, agent, all) as Session[];
    return rows;
  }

  export function set(id: string, fields: Partial<Pick<Session, "sdk" | "ack" | "launches" | "last" | "archived">>, now = Date.now()): void {
    const keys = Object.keys(fields) as Array<keyof typeof fields>;
    if (keys.length > 0) {
      Session.db().query("update work_sessions set " + keys.map((k) => k + " = ?").join(", ") + ", at = ? where id = ?").run(...keys.map((k) => fields[k] ?? null), now, id);
    }
  }

  export function runs(id: string): Run[] {
    return Session.db().query("select * from work_runs where session = ? order by n").all(id) as Run[];
  }

  export function run(id: string): Run | null {
    return (Session.db().query("select * from work_runs where session = ? order by n desc limit 1").get(id) as Run | null) ?? null;
  }

  // a step taken by the session and its latest run; the status it's in
  // now, or null if the step can't happen in the one it was in
  export function move(id: string, step: Step, why = "", now = Date.now()): Status | null {
    const db = Session.db();
    return db.transaction(() => {
      const s = Session.get(id);
      const to = s === null ? null : Session.next(s.status, step);
      if (s === null || to === null) {
        return null;
      }
      const end = LIVE.includes(to) ? null : now;
      db.query("update work_sessions set status = ?, at = ? where id = ?").run(to, now, id);
      db.query("update work_runs set status = ?, why = case when ? = '' then why else ? end, ended = ? where session = ? and n = (select max(n) from work_runs where session = ?)").run(to, why, why, end, id, id);
      return to;
    })();
  }

  // a new run (prompt) or, without, the latest run tried again; null: the
  // session is at work, or has none
  export function again(id: string, prompt: string | null, now = Date.now()): Run | null {
    const db = Session.db();
    return db.transaction(() => {
      const s = Session.get(id);
      const run = Session.run(id);
      if (s === null || run === null || Session.next(s.status, "run") === null) {
        return null;
      }
      db.query("update work_sessions set status = 'running', at = ? where id = ?").run(now, id);
      if (prompt === null) {
        db.query("update work_runs set status = 'running', attempts = attempts + 1, why = '', ended = null where session = ? and n = ?").run(id, run.n);
      } else {
        db.query("insert into work_runs (session, n, prompt, status, started) values (?, ?, ?, 'running', ?)").run(id, run.n + 1, prompt, now);
      }
      return Session.run(id);
    })();
  }

  export function park(p: Omit<Parked, "ok" | "note">): void {
    Session.db().query("insert or ignore into work_asks (id, session, tool, input, what, at) values (?, ?, ?, ?, ?, ?)").run(p.id, p.session, p.tool, p.input, p.what, p.at);
  }

  export function parked(session: string): Parked[] {
    return Session.db().query("select * from work_asks where session = ? order by at").all(session) as Parked[];
  }

  export function answer(id: string, ok: boolean, note: string): void {
    Session.db().query("update work_asks set ok = ?, note = ? where id = ? and ok is null").run(ok ? 1 : 0, note, id);
  }

  export function unpark(id: string): void {
    Session.db().query("delete from work_asks where id = ?").run(id);
  }

  export function unpark_all(session: string): void {
    Session.db().query("delete from work_asks where session = ?").run(session);
  }

  // a message for the session; false: one with that id came already
  export function say(s: Say): boolean {
    return Session.db().query("insert or ignore into work_says (id, session, text, at) values (?, ?, ?, ?)").run(s.id, s.session, s.text, s.at).changes > 0;
  }

  export function unheard(session: string): Say[] {
    return Session.db().query("select id, session, text, at from work_says where session = ? and heard = 0 order by at").all(session) as Say[];
  }

  export function heard(ids: string[]): void {
    const q = Session.db().query("update work_says set heard = 1 where id = ?");
    ids.forEach((id) => q.run(id));
  }

}
