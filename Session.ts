// Session
// =======
// A work session's record in kunumy.db: an agent's Claude Code session on a
// repo, in its own branch and worktree, kept across server restarts. A
// session has runs (a message it works on until it's done with it), each
// tried again (an attempt) when its holder died; the calls it has parked
// for the owner's answer; the questions it asked its agent; the messages
// sent to it not yet taken in; the messages that wake its agent.

import type { Database } from "bun:sqlite";
import { Owner } from "./Owner.ts";
import { Wire, type Told } from "./Wire.ts";

export type Status = "running" | "waiting" | "done" | "failed" | "stopped";

// answered: the last call parked answered; run: a new run or attempt
type Step = "ask" | "answered" | "ended" | "failed" | "stop" | "run";

// account: its Claude account ("": personal); dir: its folder in Kunumy's,
// with its log; sdk: the Claude Code session it resumes; ack: the last of
// its holder's events taken in; launches: its holders so far; unit, sock:
// the latest one's systemd unit and socket, as named at its launch; last:
// its latest words; seen: when the owner last looked at it
export type Session = {
  id: string; name: string; agent: string; repo: string; base: string; branch: string; worktree: string;
  account: string; model: string; dir: string; status: Status; sdk: string; ack: number; launches: number;
  unit: string; sock: string; last: string; made: number; at: number; archived: number; seen: number;
};

// report: what the session gave as the run's result
export type Run = { session: string; n: number; prompt: string; status: Status; attempts: number; why: string; report: string; started: number; ended: number | null };

// ok: the owner's answer, null till then; it stays till the holder says it
// took it
export type Parked = { id: string; session: string; tool: string; input: string; what: string; ok: number | null; note: string; at: number };

// queue: taken in once the run at work ends; steer: into it now; answer:
// the answer to the question the session waits on
export type Mode = "queue" | "steer" | "answer";

type Say = { id: string; session: string; text: string; mode: Mode; at: number };

type Question = { id: string; session: string; text: string; at: number };

// a message for the session's agent, sent once it's in that agent's chat
export type Wake = { id: string; agent: string; text: string };

// what the server does once a change to the record is in: deliver a wake;
// show a parked call's card; take a card down (null: every one of the
// session's); launch the run started on the messages not taken in
export type Effect =
  | { do: "wake"; wake: Wake }
  | { do: "card"; parked: Parked }
  | { do: "uncard"; ask: string | null }
  | { do: "next" };

// a wake about a step (about: what makes its id, the same each time the
// step is taken)
type Note = { about: string; text: string };

const NEXT: Record<Status, Partial<Record<Step, Status>>> = {
  running : { ask: "waiting", ended: "done", failed: "failed", stop: "stopped" },
  waiting : { ask: "waiting", answered: "running", ended: "done", failed: "failed", stop: "stopped" },
  done    : { run: "running" },
  failed  : { run: "running", stop: "stopped" },
  stopped : { run: "running" },
};

// each table's columns as this version makes them. A column an earlier
// version's table lacks is added to it; one it can't add (not null with no
// default) has the table rebuilt with this version's columns, its rows
// copied as far as they allow. Otherwise columns a later version added stay.
const TABLES: Record<string, string[]> = {
  work_sessions   : ["id text primary key", "name text not null", "agent text not null", "repo text not null", "base text not null", "branch text not null", "worktree text not null", "account text not null", "model text not null", "dir text not null", "status text not null", "sdk text not null default ''", "ack integer not null default 0", "launches integer not null default 0", "unit text not null default ''", "sock text not null default ''", "last text not null default ''", "made integer not null", "at integer not null", "archived integer not null default 0", "seen integer not null default 0"],
  work_runs       : ["session text not null", "n integer not null", "prompt text not null", "status text not null", "attempts integer not null default 1", "why text not null default ''", "report text not null default ''", "started integer not null", "ended integer", "primary key (session, n)"],
  work_asks       : ["id text primary key", "session text not null", "tool text not null", "input text not null", "what text not null", "ok integer", "note text not null default ''", "at integer not null"],
  work_says       : ["id text primary key", "session text not null", "text text not null", "mode text not null default 'steer'", "heard integer not null default 0", "at integer not null"],
  work_questions  : ["id text primary key", "session text not null", "text text not null", "at integer not null"],
  work_wakes      : ["id text primary key", "agent text not null", "text text not null", "sent integer not null default 0", "at integer not null"],
};

let MADE = false;

const LAST = 300;

export const LIVE: Status[] = ["running", "waiting"];

function fit(db: Database, name: string, columns: string[]): void {
  db.run("create table if not exists " + name + " (" + columns.join(", ") + ")");
  const had = new Set((db.query("select name from pragma_table_info(?)").all(name) as { name: string }[]).map((c) => c.name));
  const missing = columns.filter((c) => !c.startsWith("primary key") && !had.has(c.split(" ")[0]));
  try {
    missing.forEach((c) => db.run("alter table " + name + " add column " + c));
  } catch (err) {
    if (!/Cannot add a/.test(String(err))) {
      throw err;
    }
    const kept = columns.map((c) => c.split(" ")[0]).filter((c) => had.has(c)).join(", ");
    db.run("drop table if exists " + name + "_new");
    db.run("create table " + name + "_new (" + columns.join(", ") + ")");
    if (kept !== "") {
      db.run("insert or ignore into " + name + "_new (" + kept + ") select " + kept + " from " + name);
    }
    db.run("drop table " + name);
    db.run("alter table " + name + "_new rename to " + name);
  }
}

export namespace Session {

  function opened() {
    const db = Owner.open();
    if (!MADE) {
      const had = (db.query("select name from pragma_table_info('work_sessions')").all() as { name: string }[]).map((c) => c.name);
      const unseen = had.length > 0 && !had.includes("seen");
      const unitless = had.length > 0 && !had.includes("unit");
      // the columns and what fills them in one transaction: a server killed
      // midway leaves neither
      db.transaction(() => {
        Object.entries(TABLES).forEach(([name, columns]) => fit(db, name, columns));
        // sessions made before a session's last look was kept count as seen
        if (unseen) {
          db.run("update work_sessions set seen = at");
        }
        // a holder launched by a version that kept no unit or socket in
        // the record was named so
        if (unitless) {
          db.run("update work_sessions set unit = 'ki-hold-' || id || '-' || launches, sock = dir || '/hold-' || launches || '.sock' where launches > 0");
        }
      })();
      MADE = true;
    }
    return db;
  }

  // what a step leads to; null: it can't happen in that status
  function next(status: Status, step: Step): Status | null {
    return NEXT[status][step] ?? null;
  }

  export function add(s: Omit<Session, "status" | "sdk" | "ack" | "launches" | "unit" | "sock" | "last" | "made" | "at" | "archived" | "seen">, prompt: string): Session {
    const db = opened();
    const now = Date.now();
    db.transaction(() => {
      db.query("insert into work_sessions (id, name, agent, repo, base, branch, worktree, account, model, dir, status, made, at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)").run(s.id, s.name, s.agent, s.repo, s.base, s.branch, s.worktree, s.account, s.model, s.dir, now, now);
      db.query("insert into work_runs (session, n, prompt, status, started) values (?, 1, ?, 'running', ?)").run(s.id, prompt, now);
    })();
    return Session.get(s.id) as Session;
  }

  export function get(id: string): Session | null {
    return (opened().query("select * from work_sessions where id = ?").get(id) as Session | null) ?? null;
  }

  // an agent's sessions not archived, or everyone's, newest first
  export function list(agent: string | null): Session[] {
    return opened().query("select * from work_sessions where (? is null or agent = ?) and archived = 0 order by made desc").all(agent, agent) as Session[];
  }

  export function set(id: string, fields: Partial<Pick<Session, "launches" | "unit" | "sock" | "archived" | "seen">>): void {
    const keys = Object.keys(fields) as Array<keyof typeof fields>;
    if (keys.length > 0) {
      opened().query("update work_sessions set " + keys.map((k) => k + " = ?").join(", ") + ", at = max(at + 1, ?) where id = ?").run(...keys.map((k) => fields[k] ?? null), Date.now(), id);
    }
  }

  export function runs(id: string): Run[] {
    return opened().query("select * from work_runs where session = ? order by n").all(id) as Run[];
  }

  export function run(id: string): Run | null {
    return (opened().query("select * from work_runs where session = ? order by n desc limit 1").get(id) as Run | null) ?? null;
  }

  // one event of its holder's taken into the record with its ack, in one
  // transaction: what the server does after it, none for one taken already
  export function apply(id: string, told: Told): Effect[] {
    const db = opened();
    return db.transaction(() => {
      const s = Session.get(id);
      if (s === null || told.seq <= s.ack) {
        return [];
      }
      const out = taken(db, s, told);
      // at: later with each change, so the app sees each one
      db.query("update work_sessions set ack = ?, at = max(at + 1, ?) where id = ?").run(told.seq, Date.now(), id);
      return out;
    })();
  }

  function taken(db: Database, s: Session, { seq, at, ev }: Told): Effect[] {
    const live = LIVE.includes(s.status);
    if (ev.k === "began") {
      db.query("update work_sessions set sdk = ? where id = ?").run(ev.sdk, s.id);
    } else if (ev.k === "text") {
      db.query("update work_sessions set last = ? where id = ?").run(ev.text.trim().slice(-LAST), s.id);
    } else if (ev.k === "ask" && live) {
      const parked: Parked = { id: ev.id, session: s.id, tool: ev.tool, input: JSON.stringify(ev.input), what: ev.what, ok: null, note: "", at };
      db.query("insert or ignore into work_asks (id, session, tool, input, what, at) values (?, ?, ?, ?, ?, ?)").run(parked.id, s.id, parked.tool, parked.input, parked.what, at);
      step(db, s.id, "ask");
      const woke = s.status === "running" ? noted(db, s, String(seq), "waiting", "the user's approval in the app, for: " + ev.what.toLowerCase() + " (" + ev.tool + ")") : [];
      return [{ do: "card", parked }, ...woke];
    } else if (ev.k === "answered" || ev.k === "dropped") {
      db.query("delete from work_asks where id = ?").run(ev.id);
      settle(db, s.id);
      return [{ do: "uncard", ask: ev.id }];
    } else if (ev.k === "question" && live) {
      db.query("insert or ignore into work_questions (id, session, text, at) values (?, ?, ?, ?)").run(ev.id, s.id, ev.text, at);
      step(db, s.id, "ask");
      return noted(db, s, String(seq), "question", ev.text + "\n\nIt waits for your answer: give it with session send. If only the user knows, ask them first.");
    } else if (ev.k === "replied") {
      db.query("delete from work_questions where id = ?").run(ev.id);
      settle(db, s.id);
    } else if (ev.k === "report") {
      db.query("update work_runs set report = ? where session = ? and n = (select max(n) from work_runs where session = ?)").run(ev.text, s.id, s.id);
    } else if (ev.k === "heard") {
      db.query("update work_says set heard = 1 where id = ?").run(ev.id);
    } else if (ev.k === "end") {
      const to = step(db, s.id, ev.ok ? "ended" : "failed", ev.ok ? "" : ev.text);
      if (to === null) {
        return [{ do: "uncard", ask: null }];
      }
      const unheard = Session.unheard(s.id);
      const said = (to === "done" ? Session.run(s.id)?.report || ev.text : ev.text) || "(it said nothing)";
      const woke = noted(db, s, String(seq), to, said + (unheard.length > 0 ? "\n\nIt runs again now, on the messages sent to it it hadn't taken in." : ""));
      const next = unheard.length > 0 && rerun(db, s.id, unheard.map((say) => say.text).join("\n\n"), unheard.map((say) => say.id)) !== null;
      return [{ do: "uncard", ask: null }, ...woke, ...(next ? [{ do: "next" as const }] : [])];
    }
    return [];
  }

  // a step taken by the session and its latest run; the status it's in
  // now, or null if the step can't happen in the one it was in. Out of
  // work, nothing it asked waits any longer; stopped, the messages it
  // hadn't taken in are dropped
  function step(db: Database, id: string, by: Step, why = ""): Status | null {
    const s = Session.get(id);
    const to = s === null ? null : next(s.status, by);
    if (to === null) {
      return null;
    }
    const now = Date.now();
    const end = LIVE.includes(to) ? null : now;
    db.query("update work_sessions set status = ?, at = max(at + 1, ?) where id = ?").run(to, now, id);
    db.query("update work_runs set status = ?, why = case when ? = '' then why else ? end, ended = ? where session = ? and n = (select max(n) from work_runs where session = ?)").run(to, why, why, end, id, id);
    if (!LIVE.includes(to)) {
      db.query("delete from work_asks where session = ?").run(id);
      db.query("delete from work_questions where session = ?").run(id);
    }
    if (to === "stopped") {
      db.query("update work_says set heard = -1 where session = ? and heard = 0").run(id);
    }
    return to;
  }

  // at work again once nothing it asked waits
  function settle(db: Database, id: string): void {
    const asked = db.query("select (select count(*) from work_asks where session = ?) + (select count(*) from work_questions where session = ?) n").get(id, id) as { n: number };
    if (asked.n === 0) {
      step(db, id, "answered");
    }
  }

  // a wake message kept to send, in the transaction of the step it tells
  function noted(db: Database, s: Session, about: string, what: string, text: string): Effect[] {
    const wake = { id: "session " + s.id + " " + about, agent: s.agent, text: "[Session " + s.name + "] " + what + ": " + Wire.clip(text.trim()) };
    const kept = db.query("insert or ignore into work_wakes (id, agent, text, at) values (?, ?, ?, ?)").run(wake.id, wake.agent, wake.text, Date.now()).changes > 0;
    return kept ? [{ do: "wake", wake }] : [];
  }

  // the server's own step out of work (its holder gone or never started,
  // or stopped), with the wake that tells its agent, if any; null: it
  // can't be taken now
  export function move(id: string, by: "failed" | "stop", why: string, note: Note | null): Effect[] | null {
    const db = opened();
    return db.transaction(() => {
      const s = Session.get(id);
      const to = s === null ? null : step(db, id, by, why);
      if (s === null || to === null) {
        return null;
      }
      return [{ do: "uncard" as const, ask: null }, ...(note === null ? [] : noted(db, s, note.about, to, note.text))];
    })();
  }

  // a new run (prompt) or, without, the latest run tried again; says: the
  // messages it starts on, taken in as a queued one is. null: the session
  // is at work, or has none
  export function again(id: string, prompt: string | null, says: string[] = []): Run | null {
    const db = opened();
    return db.transaction(() => rerun(db, id, prompt, says))();
  }

  function rerun(db: Database, id: string, prompt: string | null, says: string[]): Run | null {
    const s = Session.get(id);
    const run = Session.run(id);
    if (s === null || run === null || next(s.status, "run") === null) {
      return null;
    }
    const now = Date.now();
    // its holder not launched yet: its unit and socket are named at launch
    db.query("update work_sessions set status = 'running', unit = '', sock = '', at = max(at + 1, ?) where id = ?").run(now, id);
    if (prompt === null) {
      db.query("update work_runs set status = 'running', attempts = attempts + 1, why = '', ended = null where session = ? and n = ?").run(id, run.n);
    } else {
      db.query("insert into work_runs (session, n, prompt, status, started) values (?, ?, ?, 'running', ?)").run(id, run.n + 1, prompt, now);
    }
    const heard = db.query("update work_says set heard = 1, mode = 'queue' where id = ?");
    says.forEach((say) => heard.run(say));
    return Session.run(id);
  }

  // what a new holder's welcome says it holds: the calls parked and the
  // questions asked that it no longer does are dropped
  export function welcome(id: string, asks: string[], questions: string[]): Effect[] {
    const db = opened();
    return db.transaction(() => {
      const gone = Session.parked(id).filter((p) => !asks.includes(p.id)).map((p) => p.id);
      const unasked = Session.questions(id).filter((q) => !questions.includes(q.id)).map((q) => q.id);
      gone.forEach((ask) => db.query("delete from work_asks where id = ?").run(ask));
      unasked.forEach((q) => db.query("delete from work_questions where id = ?").run(q));
      if (gone.length + unasked.length > 0) {
        settle(db, id);
      }
      return gone.map((ask) => ({ do: "uncard" as const, ask }));
    })();
  }

  export function parked(session: string): Parked[] {
    return opened().query("select * from work_asks where session = ? order by at").all(session) as Parked[];
  }

  export function answer(id: string, ok: boolean, note: string): void {
    opened().query("update work_asks set ok = ?, note = ? where id = ? and ok is null").run(ok ? 1 : 0, note, id);
  }

  // a message for the session; false: one with that id came already
  export function say(s: Say): boolean {
    return opened().query("insert or ignore into work_says (id, session, text, mode, at) values (?, ?, ?, ?, ?)").run(s.id, s.session, s.text, s.mode, s.at).changes > 0;
  }

  export function unsay(id: string): void {
    opened().query("delete from work_says where id = ?").run(id);
  }

  // every message sent to the session; heard: 1 taken in by it, 0 not
  // yet, -1 dropped (it was stopped first)
  export function says(session: string): Array<Say & { heard: number }> {
    return opened().query("select id, session, text, mode, heard, at from work_says where session = ? order by at").all(session) as Array<Say & { heard: number }>;
  }

  export function unheard(session: string): Say[] {
    return opened().query("select id, session, text, mode, at from work_says where session = ? and heard = 0 order by at").all(session) as Say[];
  }

  export function questions(session: string): Question[] {
    return opened().query("select * from work_questions where session = ? order by at").all(session) as Question[];
  }

  export function unsent(): Wake[] {
    return opened().query("select id, agent, text from work_wakes where sent = 0 order by at").all() as Wake[];
  }

  export function sent(id: string): void {
    opened().query("update work_wakes set sent = 1 where id = ?").run(id);
  }

}
