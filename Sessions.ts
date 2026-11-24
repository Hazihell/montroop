// Sessions
// ========
// The server's side of work sessions: it starts each run's holder (Hold) as
// a systemd user unit of its own, so a server restart or deploy leaves it
// running; links to it over its socket, taking in what it tells (Wire)
// into the session's record (Session) and acking it; shows each call it
// parks as the owner's Ask card (Gate) and sends the answer back. On boot
// it links again to the holders still running, and marks the sessions
// whose holder is gone as failed, to resume. When a run ends, or waits on
// the owner or on its agent's answer, the agent gets one message that
// starts its turn ("[Session name] done: …"), kept in the record till it's
// in the agent's chat, so a restart neither loses nor repeats it. Agents
// drive their own sessions with the session tool.

import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import type { Out } from "./Agent.ts";
import { Browser, MEDIA } from "./Browser.ts";
import { call_gist, call_parse } from "./Call.ts";
import * as config from "./Config.ts";
import { err_why } from "./Err.ts";
import { Gate, type Asked } from "./Gate.ts";
import { Hold, SPEC, START, type Spec, type Start } from "./Hold.ts";
import { get, rec, str, text_of } from "./Json.ts";
import { Machine } from "./Machine.ts";
import { Owner } from "./Owner.ts";
import * as Pins from "./Pins.ts";
import * as Prompts from "./Prompts.ts";
import { command, output, run } from "./Service.ts";
import { LIVE, Session, type Effect, type Mode, type Parked, type Run, type Wake } from "./Session.ts";
import { Team } from "./Team.ts";
import { PICTURE, SESSION, VIDEO, type SessionPage, type SessionRow, type Waits } from "./View.ts";
import { VERSION, Wire, type Ev, type Told } from "./Wire.ts";
import { Worktree } from "./Worktree.ts";

// a session's link to its holder: the socket (null: none now), the
// owner's cards its parked calls wait on, the tries to connect since it
// last did, the next try's timer
type Link = { sock: net.Socket | null; waits: Map<string, AbortController>; tries: number; timer: Timer | null };

// what a new session needs: its agent; a repo on this computer, the ref
// its branch starts from and the branch ("": ki/<name>); its name; the
// brief its system prompt adds; the first message; the model ("": the
// account's default)
type Begin = { agent: string; repo: string; base: string; branch: string; name: string; brief: string; prompt: string; model: string };

// what became of a message: into the run at work, kept for the next run,
// the answer to the session's question, a run started on it, or nothing
// (one with its request id came already)
type Sent = "steered" | "queued" | "answered" | "started" | "again";

const DIR = path.join(config.DIR, "sessions");

const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

const PAGE = 100;
const PAGE_MOST = 1000;

// the log lines a read shows: the latest, or a page from a point
const TAIL = 10;
const LINES = 50;
const LINES_MOST = 200;
const LINE = 300;

// how long, at most, between tries to reach a holder that runs
const RETRY = 5000;

// how long, at most, between tries to deliver a wake its agent's chat
// didn't take
const REDELIVER = 60e3;

// the variables a holder's Claude Code works with, from the server's
const ENV = ["PATH", "LANG", "SHELL", "SSH_AUTH_SOCK", "XDG_CONFIG_HOME", "XDG_DATA_HOME"];

const AGAIN = "Your process was stopped before you were done, so the outcome of your last calls is unknown. Check what they did before doing any again, then go on with the task. The message you were working on:\n\n";

const GONE = "its holder ended before the run did";

// a stop doesn't wait for the unit to end, which takes up to its
// TimeoutStopSec; nothing new starts in the worktree till it has
const STOPPING = "Its holder is still stopping: try again in a few seconds.";

const SENT: Record<Sent, string> = {
  steered  : "Sent: it reaches the session at its next step.",
  queued   : "Queued: it starts the session's next run once this one ends.",
  answered : "Sent as the answer to its question: it goes on.",
  started  : "Sent: the session runs again on it, where it left off.",
  again    : "A message with this request was sent already: not sent twice.",
};

// a file of a session's media folder, as the app asks for it; only
// pictures and videos (View's PICTURE, VIDEO) show in the page, the rest
// download
const FILE = /^[\w][\w.-]{0,200}$/;

const LINKS = new Map<string, Link>();
// each session's latest log line, once known
const LATEST = new Map<string, string>();
// the wakes being delivered
const SENDING = new Set<string>();
// the server's: the owner's cards; wake, a message into an agent's chat
// once (id: its act), false if it didn't take it; change, a session's row
// changed
const HOOKS = { gate: null as Gate | null, asked: (_: Asked) => {}, wake: (_: Wake) => Promise.resolve(false), change: () => {} };

export namespace Sessions {

  function systemctl(args: string[]): string {
    const r = run(["systemctl", "--user", ...args]);
    return output(r);
  }

  // the unit and socket of a session's holder of launch n
  function holder(s: Session, n: number): { unit: string; sock: string } {
    return { unit: "ki-hold-" + s.id + "-" + n, sock: path.join(s.dir, "hold-" + n + ".sock") };
  }

  // a session with no unit in the record whose holder of its last launch
  // runs: an older version (run on this record since) launched it and kept
  // none, so it is named in the record, not taken for a run whose holder
  // never launched; unless that holder's run ended and the end is taken
  // (the server stopped before the next run's launch): it only lingers
  function adopted(s: Session): Session {
    const named = holder(s, s.launches);
    if (s.unit !== "" || s.launches === 0 || !alive({ ...s, ...named })) {
      return s;
    }
    const last = Hold.told(s.dir).at(-1);
    if (last !== undefined && last.ev.k === "end" && last.seq <= s.ack) {
      return s;
    }
    Session.set(s.id, named);
    return { ...s, ...named };
  }

  function alive(s: Session): boolean {
    return s.unit !== "" && ["active", "activating", "deactivating"].includes(systemctl(["is-active", s.unit]));
  }

  function link_of(id: string): Link {
    const l = LINKS.get(id) ?? { sock: null, waits: new Map(), tries: 0, timer: null };
    LINKS.set(id, l);
    return l;
  }

  // at the server's start, before it takes requests, once the agents'
  // chats are open: the wake messages not yet in a chat are sent again;
  // the cards of calls still parked wait again, so an answer given at once
  // finds them, and those of a holder gone are taken down; a holder an
  // older version launched is named in the record (adopted); a stopped
  // session's holder still running (its server killed midway) is stopped
  export function boot(gate: Gate, asked: (a: Asked) => void, wake: (w: Wake) => Promise<boolean>, change: () => void): void {
    HOOKS.gate = gate;
    HOOKS.asked = asked;
    HOOKS.wake = wake;
    HOOKS.change = change;
    config.RELOADED.add(() => LINKS.forEach((l) => Wire.send(l.sock, { $: "rules", rules: config.ASK })));
    Session.unsent().forEach(deliver);
    for (const found of Session.list(null)) {
      const s = adopted(found);
      if (LIVE.includes(s.status)) {
        Session.parked(s.id).forEach((p) => arm(s, p));
        if (alive(s)) {
          link(s.id);
        } else {
          gone(s.id);
        }
      } else if (s.status === "stopped" && alive(s)) {
        systemctl(["stop", "--no-block", s.unit]);
      }
    }
  }

  function start(b: Begin): Session | string {
    const agent = Team.get(b.agent);
    if (agent === null || agent.archived !== 0) {
      return "No agent " + b.agent + ".";
    }
    if (!NAME.test(b.name)) {
      return "A session's name is 1 to 40 lowercase letters, digits and dashes.";
    }
    if (Session.list(b.agent).some((s) => s.name === b.name)) {
      return "This agent has a session " + b.name + " already: archive it first, or pick another name.";
    }
    if (b.prompt.trim() === "") {
      return "A session starts with a message.";
    }
    if (Bun.which("systemd-run") === null) {
      return "Work sessions run as systemd user units, and systemd-run isn't here.";
    }
    const top = Worktree.top(b.repo);
    if ("why" in top) {
      return top.why;
    }
    const id = crypto.randomUUID().slice(0, 8);
    const base = Worktree.named(top.dir, b.base || "HEAD");
    const branch = b.branch || "ki/" + b.name;
    const worktree = path.join(Machine.agent_dir(b.agent), "sessions", b.name);
    fs.mkdirSync(path.dirname(worktree), { recursive: true });
    const made = Worktree.make(top.dir, base, branch, worktree);
    if (made !== null) {
      return made;
    }
    const dir = path.join(DIR, id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const own = Prompts.prompt("session", { agent: agent.name }) + (Browser.make(dir, id) ? "\n" + Prompts.prompt("session-browser", { media: path.join(dir, MEDIA) }) : "");
    const spec: Spec = { cwd: worktree, claude: config.claude_dir(agent.claude), model: b.model, append: [own, b.brief.trim(), Pins.block(false).text.trim()].filter((t) => t !== "").join("\n\n") };
    fs.writeFileSync(path.join(dir, SPEC), JSON.stringify(spec, null, 1) + "\n", { mode: 0o600 });
    const s = Session.add({ id, name: b.name, agent: b.agent, repo: top.dir, base, branch, worktree, account: agent.claude, model: b.model, dir }, b.prompt);
    const why = launch(s, b.prompt, null);
    return why === null ? Session.get(id) ?? s : why + "\nThe session " + b.name + " is kept, as failed: once that's fixed, send it a message to start it.";
  }

  // a run's holder started on its first message, resuming the session's
  // Claude Code session if it has one; one whose earlier holders never
  // began one gets the session's first message before it; its unit and
  // socket named in the record. null: started; else why not, and with
  // about, its agent is told
  function launch(s: Session, prompt: string, about: string | null): string | null {
    const launches = s.launches + 1;
    const { unit, sock } = holder(s, launches);
    Session.set(s.id, { launches, unit, sock });
    const first = s.launches > 0 && s.sdk === "" ? Session.runs(s.id)[0]?.prompt ?? prompt : prompt;
    const begin: Start = { prompt: first === prompt ? prompt : first + "\n\n" + prompt, resume: s.sdk, rules: config.ASK, sock };
    fs.writeFileSync(path.join(s.dir, START), JSON.stringify(begin, null, 1) + "\n", { mode: 0o600 });
    const env = Object.entries({ ...Object.fromEntries(ENV.flatMap((k) => (process.env[k] ? [[k, process.env[k]]] : []))), KI_DIR: config.DIR });
    const r = run(["systemd-run", "--user", "--collect", "--quiet", "--unit=" + unit, "--description=Ki work session " + s.name, "-p", "TimeoutStopSec=10", ...env.map(([k, v]) => "--setenv=" + k + "=" + v), "--", ...command(), "hold", s.dir]);
    if (r.code !== 0) {
      const why = "systemd-run failed: " + output(r);
      after(s.id, Session.move(s.id, "failed", why, about === null ? null : { about, text: why }) ?? []);
      return why;
    }
    unlink(s.id);
    link(s.id);
    HOOKS.change();
    return null;
  }

  function link(id: string): void {
    const s = Session.get(id);
    const l = link_of(id);
    if (s === null || l.sock !== null) {
      return;
    }
    const sock = net.createConnection(s.sock);
    l.sock = sock;
    sock.setEncoding("utf8");
    sock.on("connect", () => {
      l.tries = 0;
      Wire.send(sock, { $: "hello", v: VERSION, ack: Session.get(id)?.ack ?? 0, rules: config.ASK });
    });
    sock.on("data", Wire.lines((msg) => {
      try {
        got(id, sock, msg);
      } catch (err) {
        console.error("ki: session " + id + ": " + err_why(err));
      }
    }));
    sock.on("error", () => {});
    sock.on("close", () => {
      if (l.sock === sock) {
        l.sock = null;
        lost(id);
      }
    });
  }

  function unlink(id: string): void {
    const l = LINKS.get(id);
    if (l === undefined) {
      return;
    }
    clearTimeout(l.timer ?? undefined);
    const sock = l.sock;
    l.sock = null;
    sock?.destroy();
  }

  // the link fell or never came: tried again while the holder runs, else
  // what it left in the log is taken in
  function lost(id: string): void {
    const l = LINKS.get(id);
    const s = Session.get(id);
    if (l === undefined || s === null || !LIVE.includes(s.status)) {
      return;
    }
    l.tries += 1;
    clearTimeout(l.timer ?? undefined);
    l.timer = setTimeout(() => {
      l.timer = null;
      const now = Session.get(id);
      if (now === null || !LIVE.includes(now.status) || l.sock !== null) {
        return;
      }
      if (alive(now)) {
        link(id);
      } else {
        gone(id);
      }
    }, Math.min(RETRY, 100 * l.tries));
  }

  // the holder is gone: what its log holds past the last ack is taken in;
  // a run it left unfinished failed, to resume; a run the record started
  // whose holder never launched (the server stopped first) launches
  function gone(id: string): void {
    const s = Session.get(id);
    if (s === null) {
      return;
    }
    if (s.sock !== "") {
      fs.rmSync(s.sock, { force: true });
    }
    Hold.told(s.dir).filter((t) => t.seq > s.ack).forEach((t) => after(id, take(id, t)));
    const now = Session.get(id);
    const run = Session.run(id);
    if (now !== null && run !== null && LIVE.includes(now.status)) {
      if (now.unit === "") {
        next_run(id);
      } else if (now.unit === s.unit) {
        after(id, Session.move(id, "failed", GONE, { about: "gone " + attempt(run), text: GONE + ": send it a message to go on" }) ?? []);
      }
    }
    HOOKS.change();
  }

  function got(id: string, sock: net.Socket, msg: Record<string, unknown>): void {
    if (msg.$ === "welcome") {
      const held = (Array.isArray(msg.asks) ? msg.asks : []).map((a) => str(get(a, "id")) ?? "");
      const waits = (Array.isArray(msg.questions) ? msg.questions : []).map((q) => str(get(q, "id")) ?? "");
      after(id, Session.welcome(id, held, waits));
      Session.parked(id).filter((p) => p.ok !== null).forEach((p) => Wire.send(sock, { $: "answer", id: p.id, ok: p.ok === 1, note: p.note }));
      Session.unheard(id).filter((say) => say.mode !== "queue").forEach((say) => Wire.send(sock, { $: "say", id: say.id, text: say.text, answer: say.mode === "answer" }));
    } else if (msg.$ === "ev" && typeof msg.seq === "number" && rec(msg.ev)) {
      const fx = take(id, { seq: msg.seq, at: Number(msg.at) || Date.now(), ev: msg.ev as Ev });
      Wire.send(sock, { $: "ack", seq: msg.seq });
      after(id, fx);
    }
  }

  // one event taken into the record, once: what's left to do after it
  function take(id: string, told: Told): Effect[] {
    const fx = Session.apply(id, told);
    const latest = latest_of(told.ev);
    if (latest !== "") {
      LATEST.set(id, latest);
    }
    return fx;
  }

  // what a change to the record leaves to do, done once it's in
  function after(id: string, fx: Effect[]): void {
    const waits = LINKS.get(id)?.waits;
    for (const f of fx) {
      if (f.do === "wake") {
        deliver(f.wake);
      } else if (f.do === "card") {
        const s = Session.get(id);
        if (s !== null) {
          arm(s, f.parked);
        }
      } else if (f.do === "uncard") {
        (f.ask === null ? [...(waits?.values() ?? [])] : [waits?.get(f.ask)]).forEach((w) => w?.abort());
      } else {
        next_run(id);
      }
    }
    HOOKS.change();
  }

  // the holder of the run the record started on the messages the last
  // one didn't take in
  function next_run(id: string): void {
    const s = Session.get(id);
    const run = Session.run(id);
    if (s !== null && run !== null && s.status === "running") {
      launch(s, prompt_of(s, run), "launch " + attempt(run));
    }
  }

  // what a run's holder starts on: a run tried again on a Claude Code
  // session is told it was cut off
  function prompt_of(s: Session, run: Run): string {
    return run.attempts > 1 && s.sdk !== "" ? AGAIN + run.prompt : run.prompt;
  }

  // a parked call shown as the owner's card in its agent's chat, waiting
  // for an answer, which goes to the holder
  function arm(s: Session, p: Parked): void {
    const l = link_of(s.id);
    if (HOOKS.gate === null || l.waits.has(p.id) || p.ok !== null) {
      return;
    }
    const stop = new AbortController();
    l.waits.set(p.id, stop);
    let input: Record<string, unknown> = {};
    try {
      const x: unknown = JSON.parse(p.input);
      input = rec(x) ? x : {};
    } catch {}
    void Gate.wait(HOOKS.gate, s.agent, SESSION + s.name, "session", p.tool, input, p.what, stop.signal, HOOKS.asked).then((said) => {
      l.waits.delete(p.id);
      if (said !== null) {
        Session.answer(p.id, said.ok, said.note);
        Wire.send(l.sock, { $: "answer", id: p.id, ok: said.ok, note: said.note });
      }
    });
  }

  function attempt(run: { n: number; attempts: number }): string {
    return run.n + "." + run.attempts;
  }

  // into the agent's chat, unless it's there already; marked sent once
  // it is. One its chat didn't take is tried again, less often each time,
  // while the server runs and its agent is there, and at its next boot
  function deliver(w: Wake): void {
    if (!SENDING.has(w.id)) {
      SENDING.add(w.id);
      redeliver(w, 0);
    }
  }

  function redeliver(w: Wake, tries: number): void {
    const took = Owner.act_get(w.id) === null ? HOOKS.wake(w).catch(() => false) : Promise.resolve(true);
    void took.then((ok) => {
      if (ok) {
        Session.sent(w.id);
      }
      if (ok || Team.get(w.agent) === null) {
        SENDING.delete(w.id);
      } else {
        setTimeout(() => redeliver(w, tries + 1), Math.min(REDELIVER, 1000 * 2 ** tries)).unref();
      }
    });
  }

  // a message to a session: into its run if one is at work (steer), or
  // kept for its next run (queue), else it starts the next; to a session
  // whose question waits, it's the answer; request: the caller's id for
  // it, so a retry sends it once
  function say(id: string, text: string, request: string, mode: Exclude<Mode, "answer">): Sent | { why: string } {
    const s = Session.get(id);
    if (s === null || s.archived !== 0) {
      return { why: "No session " + id + "." };
    }
    if (text.trim() === "") {
      return { why: "Say something." };
    }
    const live = LIVE.includes(s.status);
    if (!live && alive(s)) {
      return { why: STOPPING };
    }
    const as: Mode = live && Session.questions(id).length > 0 ? "answer" : mode;
    const key = id + "/" + request;
    // a retry of one whose run never started (its server stopped first)
    // starts it
    if (!Session.say({ id: key, session: id, text, mode: as, at: Date.now() }) && (live || !Session.unheard(id).some((say) => say.id === key))) {
      return "again";
    }
    if (live) {
      if (as !== "queue") {
        Wire.send(LINKS.get(id)?.sock, { $: "say", id: key, text, answer: as === "answer" });
      }
      return as === "answer" ? "answered" : as === "steer" ? "steered" : "queued";
    }
    const why = Session.again(id, text, [key]) === null ? "Session " + s.name + " can't take a message now." : launch(s, text, null);
    if (why !== null) {
      Session.unsay(key);
    }
    return why === null ? "started" : { why };
  }

  // the session's latest run tried again where it stopped (its holder
  // gone, or stopped)
  function resume(id: string): string | null {
    const s = Session.get(id);
    const last = Session.run(id);
    if (s === null || last === null || s.archived !== 0) {
      return "No session " + id + ".";
    }
    if (s.status === "done" || LIVE.includes(s.status)) {
      return "Session " + s.name + " is " + s.status + ": nothing to resume.";
    }
    if (alive(s)) {
      return STOPPING;
    }
    const run = Session.again(id, null);
    return run === null ? "Session " + s.name + " can't be resumed now." : launch(s, prompt_of(s, run), null);
  }

  // its holder and everything it started killed (the whole unit), its
  // browser closed; the messages it didn't take in are dropped with it.
  // wake: its agent is told (the user stopped it, not the agent)
  function stop(id: string, wake: boolean): string | null {
    const s = Session.get(id);
    const run = Session.run(id);
    if (s === null || run === null) {
      return "No session " + id + ".";
    }
    const fx = Session.move(id, "stop", "", wake ? { about: "stop " + attempt(run), text: "by the user. Its worktree and branch stay: send it a message to go on." } : null);
    if (fx === null) {
      return "Session " + s.name + " is " + s.status + " already.";
    }
    unlink(id);
    void Browser.close(s.dir);
    if (s.unit !== "") {
      systemctl(["stop", "--no-block", s.unit]);
    }
    if (wake) {
      Session.set(id, { seen: Date.now() });
    }
    after(id, fx);
    return null;
  }

  // its worktree and branch removed, the record kept; force: even with
  // work found nowhere else
  function archive(id: string, force: boolean): string | null {
    const s = Session.get(id);
    if (s === null || s.archived !== 0) {
      return "No session " + id + ".";
    }
    if (LIVE.includes(s.status)) {
      return "Session " + s.name + " is " + s.status + ": stop it first.";
    }
    if (alive(s)) {
      return STOPPING;
    }
    const why = Worktree.remove(s.repo, s.base, s.branch, s.worktree, force);
    if (why !== null) {
      return why;
    }
    void Browser.forget(s.dir);
    Session.set(id, { archived: 1 });
    LINKS.delete(id);
    LATEST.delete(id);
    Hold.forget(s.dir);
    HOOKS.change();
    return null;
  }

  // what the session told, after seq, at most n; or with before, the
  // last n before it
  function log(id: string, after: number, n: number, before: number | null): Told[] {
    const s = Session.get(id);
    const all = s === null ? [] : Hold.told(s.dir);
    return before === null ? all.filter((t) => t.seq > after).slice(0, n) : all.filter((t) => t.seq < before).slice(-n || all.length);
  }

  // the session as the app and the session tool show it
  export function row(s: Session): SessionRow {
    if (!LATEST.has(s.id)) {
      const last = Hold.told(s.dir).map((t) => latest_of(t.ev)).findLast((b) => b !== "");
      LATEST.set(s.id, last ?? line(s.last, LINE));
    }
    const run = Session.run(s.id);
    const waits: Waits = Session.parked(s.id).length > 0 ? "approval" : Session.questions(s.id).length > 0 ? "answer" : null;
    const ended = run?.ended ?? null;
    return { id: s.id, name: s.name, agent: s.agent, branch: s.branch, status: s.status, waits, last: LATEST.get(s.id) ?? "", started: run?.started ?? s.made, ended, at: s.at, unseen: ended !== null && ended > s.seen };
  }

  // the session's page, with a page of its log (log)
  function page(s: Session, after: number, n: number, before: number | null): SessionPage {
    return {
      ...row(s),
      base      : s.base,
      worktree  : s.worktree,
      archived  : s.archived !== 0,
      runs      : Session.runs(s.id).map(({ n: k, prompt, status, attempts, why, report, started, ended }) => ({ n: k, prompt, status, attempts, why, report, started, ended })),
      parked    : Session.parked(s.id).map(({ id, tool, what, input }) => ({ id, tool, what, input })),
      questions : Session.questions(s.id).map(({ id, text }) => ({ id, text })),
      says      : Session.says(s.id).map(({ id, text, mode, heard, at }) => ({ id, text, mode, heard, at })),
      media     : media(s),
      log       : log(s.id, after, n, before),
    };
  }

  // the session's media files, oldest first
  function media(s: Session): string[] {
    const dir = path.join(s.dir, MEDIA);
    const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => FILE.test(f) && fs.statSync(path.join(dir, f)).isFile()) : [];
    return names.map((f) => ({ f, at: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => a.at - b.at).map(({ f }) => f);
  }

  // the session tool: an agent starts and drives its own sessions, by name
  export function tool(agent: string, args: Record<string, unknown>): Out {
    const arg = (k: string) => (args[k] === undefined || args[k] === null ? "" : text_of(args[k]).trim());
    const ok = (text: string): Out => ({ text, fail: false });
    const no = (text: string): Out => ({ text, fail: true });
    const mine = Session.list(agent).map(row);
    const action = arg("action");
    if (action === "list") {
      return ok(mine.length === 0 ? "You have no sessions." : mine.map((x) => x.name + ": " + state(x) + ", branch " + x.branch + (x.last === "" ? "" : ", last: " + line(x.last, 80))).join("\n"));
    }
    if (action === "start") {
      const had = mine.find((x) => x.name === arg("name"));
      if (had !== undefined) {
        return no("You have a session " + had.name + " already (" + state(had) + "): read it, or pick another name.");
      }
      const brief = arg("brief");
      const s = start({ agent, repo: Machine.home(arg("repo")), base: arg("base"), branch: "", name: arg("name"), brief, prompt: brief, model: arg("model") });
      const bare = typeof s === "string" || fs.existsSync(Browser.script(s.dir)) ? "" : " It has no browser: agent-browser is neither on this computer's PATH nor set as agent_browser in Ki's config.";
      return typeof s === "string" ? no(s) : ok("Started session " + s.name + " on branch " + s.branch + " (from " + s.base + "), in " + s.worktree + "." + bare + " It works on its own: you get one message \"[Session " + s.name + "] …\" when it's done, fails, waits on the user's approval or asks you something. Don't wait for it or read it to check: go on with other work, or end your turn.");
    }
    const s = mine.find((x) => x.name === arg("name"));
    if (s === undefined) {
      return no("You have no session " + JSON.stringify(arg("name")) + ". Yours: " + (mine.map((x) => x.name).join(", ") || "none") + ".");
    }
    switch (action) {
      case "send": {
        const mode = arg("mode") || "steer";
        if (arg("request") === "") {
          return no("send needs a request: an id of your own for this message (any new text); on a retry, the same one, so it's sent once.");
        }
        if (mode !== "steer" && mode !== "queue") {
          return no("mode is steer or queue.");
        }
        const sent = say(s.id, arg("text"), arg("request"), mode);
        return typeof sent !== "string" ? no(sent.why) : ok(SENT[sent] + " You get a message when it's done or needs you: don't wait for it.");
      }
      case "read": {
        const record = Session.get(s.id);
        return record === null ? no("No session " + s.name + ".") : ok(read(record, args.after === undefined ? null : Number(args.after) || 0, Number(args.n) || LINES));
      }
      case "stop": {
        const why = stop(s.id, false);
        return why === null ? ok("Stopped " + s.name + ". Its worktree and branch stay: send it a message to go on, or archive it.") : no(why);
      }
      case "archive": {
        const why = archive(s.id, args.force === true);
        return why === null ? ok("Archived " + s.name + ": its worktree and branch are removed, its record kept.") : no(why);
      }
    }
    return no("action is start, send, read, stop, list or archive.");
  }

  // its status, with what it waits on
  function state(r: SessionRow): string {
    return r.status + (r.waits === "approval" ? " on the user's approval" : r.waits === "answer" ? " on your answer" : "");
  }

  function line(text: string, most: number): string {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > most ? flat.slice(0, most) + "…" : flat;
  }

  // what a logged event says, "" for nothing
  function body_of(ev: Ev): string {
    return ev.k === "text" ? ev.text :
      ev.k === "tool" ? ev.name + " " + ev.input :
      ev.k === "result" ? (ev.error ? "error: " : "") + ev.text :
      ev.k === "ask" ? "asks the user: " + ev.what + " (" + ev.tool + ")" :
      ev.k === "answered" ? (ev.ok ? "approved" : "denied") :
      ev.k === "question" || ev.k === "report" || ev.k === "turn" || ev.k === "end" ? ev.text :
      "";
  }

  // what an event shows as the session's latest line in the app; "": none
  function latest_of(ev: Ev): string {
    return line(ev.k === "tool" ? ev.name + " " + call_gist(call_parse(ev.name + " " + ev.input)) : body_of(ev), LINE);
  }

  // a logged event as a line
  function said(t: Told): string {
    const body = body_of(t.ev);
    return t.seq + " " + t.ev.k + (body === "" ? "" : ": " + line(body, LINE));
  }

  // what a read shows: its state, what waits on someone, its report, and
  // the log's latest lines, or n of them after a point
  function read(s: Session, after: number | null, n: number): string {
    const p = page(s, 0, Infinity, null);
    const run = p.runs.at(-1) ?? null;
    const all = p.log.filter((t) => !["began", "heard", "replied", "compacted", "dropped"].includes(t.ev.k));
    const shown = after === null ? all.slice(-TAIL) : all.filter((t) => t.seq > after).slice(0, Math.min(Math.max(1, n), LINES_MOST));
    const more = after !== null && shown.length > 0 && all.at(-1) !== shown.at(-1);
    const head = "Session " + p.name + ": " + state(p) + (run === null ? "" : ", run " + run.n + (run.attempts > 1 ? " (attempt " + run.attempts + ")" : "")) + ". Branch " + p.branch + " from " + p.base + ", worktree " + p.worktree + ", media " + path.join(s.dir, MEDIA) + ".";
    const lines = [
      head,
      ...p.parked.map((c) => "Waits on the user's approval, in the app (you can't give it): " + c.what + " (" + c.tool + " " + line(c.input, 200) + ")"),
      ...p.questions.map((q) => "Asks you (answer with send): " + q.text),
      ...(run !== null && run.report !== "" ? ["Report: " + run.report] : run !== null && run.why !== "" ? ["Why it " + run.status + ": " + run.why] : []),
      "",
      (after === null ? "Its latest lines" : "Its lines after " + after) + ":",
      ...(shown.length === 0 ? ["(none)"] : shown.map(said)),
      ...(more ? ["(more: read with after=" + shown.at(-1)?.seq + ")"] : after === null && all.length > TAIL ? ["(earlier lines: read with after=0)"] : []),
    ];
    return lines.join("\n");
  }

  export async function http(req: Request, p: string): Promise<Response> {
    const url = new URL(req.url);
    const file = /^\/api\/sessions\/([0-9a-f]{8})\/media\/([^/]+)$/.exec(p);
    if (file !== null) {
      const s = Session.get(file[1]);
      let name = "";
      try {
        name = decodeURIComponent(file[2]);
      } catch {}
      const at = s === null || !FILE.test(name) ? null : Bun.file(path.join(s.dir, MEDIA, name));
      const kept: Record<string, string> = PICTURE.test(name) || VIDEO.test(name) ? {} : { "content-type": "application/octet-stream", "content-disposition": "attachment" };
      return at !== null && (await at.exists()) ? new Response(at, { headers: { "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff", ...kept } }) : new Response("not found", { status: 404 });
    }
    const m = /^\/api\/sessions(?:\/([0-9a-f]{8})(?:\/(say|resume|stop|archive|seen))?)?$/.exec(p);
    if (m === null) {
      return Response.json({ error: "No such session call." }, { status: 404 });
    }
    const [, id, act] = m;
    const out = (why: string | null, more: object = {}) => {
      const s = Session.get(id);
      return Response.json(why === null ? { ...(s === null ? {} : row(s)), ...more } : { error: why }, { status: why === null ? 200 : 409 });
    };
    if (req.method === "GET" && act === undefined) {
      if (id === undefined) {
        return Response.json(Session.list(url.searchParams.get("agent")).map(row));
      }
      const s = Session.get(id);
      const after = Number(url.searchParams.get("after") ?? 0) || 0;
      const before = url.searchParams.has("before") ? Number(url.searchParams.get("before")) || Infinity : null;
      const asked = Number(url.searchParams.get("n") ?? PAGE);
      const n = Math.min(Math.max(0, Number.isNaN(asked) ? PAGE : asked), PAGE_MOST);
      return s === null ? Response.json({ error: "No session " + id + "." }, { status: 404 }) : Response.json(page(s, after, n, before));
    }
    if (req.method !== "POST") {
      return new Response("a session act is a POST", { status: 405 });
    }
    if (!Owner.browser(req)) {
      return Response.json({ error: "Start or change a session in the web app: a device can't." }, { status: 403 });
    }
    const body: unknown = await req.json().catch(() => null);
    const text = (k: string) => str(get(body, k)) ?? "";
    if (id === undefined) {
      const s = start({ agent: text("agent"), repo: Machine.home(text("repo")), base: text("base"), branch: text("branch"), name: text("name"), brief: text("brief"), prompt: text("prompt"), model: text("model") });
      return typeof s === "string" ? Response.json({ error: s }, { status: 409 }) : Response.json(row(s));
    }
    switch (act) {
      case "say": {
        const sent = say(id, text("text"), text("request") || crypto.randomUUID(), text("mode") === "queue" ? "queue" : "steer");
        return typeof sent === "string" ? out(null, { sent: SENT[sent] }) : out(sent.why);
      }
      case "seen": {
        const s = Session.get(id);
        if (s !== null) {
          Session.set(id, { seen: Date.now() });
          HOOKS.change();
        }
        return out(s === null ? "No session " + id + "." : null);
      }
      case "resume":
        return out(resume(id));
      case "stop":
        return out(stop(id, true));
      default:
        return out(archive(id, get(body, "force") === true));
    }
  }

}
