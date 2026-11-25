// Sessions
// ========
// The server's side of work sessions: each run is a holder's (Holders),
// running Claude Code in the session's worktree; what it tells goes into
// the session's record (Session); each call it parks shows as the owner's
// Ask card (Gate), whose answer goes back to it; each call of Kunumy's
// tools it sends runs here once (Tools), its result kept till the holder
// took it. On boot the holders still running are adopted, and the
// sessions whose holder is gone marked as failed, to resume. When a run
// ends, or waits on the owner or on its agent's answer, the agent gets
// one message that starts its turn ("[Session name] done: …"), kept in
// the record till it's in the agent's chat, so a restart neither loses
// nor repeats it. Agents drive their own sessions with the session tool.
// A subagent of the engine (Subagents) is a session too, run on its
// provider's driver as its job file says, in its worktree or a folder of
// its own; a holder of one that died is tried again by the server itself,
// and siblings started together launch once the first has begun to answer.

import * as fs from "node:fs";
import * as path from "node:path";
import type { Out } from "./Agent.ts";
import type { Vendor } from "./AskAI.ts";
import { Browser, MEDIA } from "./Browser.ts";
import { call_gist, call_parse } from "./Call.ts";
import * as config from "./Config.ts";
import { Gate, type Asked } from "./Gate.ts";
import { Hold, SPEC, type Spec } from "./Hold.ts";
import { Holders, type Holder } from "./Holders.ts";
import { err_why } from "./Err.ts";
import { get, rec, str, text_of } from "./Json.ts";
import { Machine } from "./Machine.ts";
import { Owner } from "./Owner.ts";
import { LABELS, Pick } from "./Pick.ts";
import { Brief } from "./Brief.ts";
import type { Job } from "./Driver.ts";
import { transients } from "./Service.ts";
import { LIVE, Session, type Effect, type Kind, type Mode, type Parked, type Run } from "./Session.ts";
import type { Wake } from "./Wake.ts";
import { Team } from "./Team.ts";
import { Tools } from "./Tools.ts";
import * as Prompts from "./Prompts.ts";
import { clock, PICTURE, VIDEO, type SessionPage, type SessionRow, type Waits } from "./View.ts";
import { Wire, type Ev, type Told } from "./Wire.ts";
import { Worktree } from "./Worktree.ts";

// what a new session needs: its agent; a repo on this computer, the ref
// its branch starts from and the branch ("": kny/<name>); its name; the
// brief its system prompt adds; the first message; the model ("": the
// account's default)
type Begin = { agent: string; repo: string; base: string; branch: string; name: string; brief: string; prompt: string; model: string };

// what became of a message: into the run at work, kept for the next run,
// the answer to the session's question, a run started on it, or nothing
// (one with its request id came already)
type Sent = "steered" | "queued" | "answered" | "started" | "again";

// a subagent's job, fixed at its start: the job its holders run (its
// context's resume and its tools set at each launch), whether it gets the
// devices' MCP tools
type Sub = { job: Omit<Job, "dir" | "tools">; mcp: boolean };

export const DIR = path.join(config.DIR, "sessions");

const SUB = "sub.json";

export const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

const PAGE = 100;
const PAGE_MOST = 1000;

// the log lines a read shows: the latest, or a page from a point
const TAIL = 10;
const LINES = 50;
const LINES_MOST = 200;
const LINE = 300;

// how long, at most, between tries to deliver a wake its agent's chat
// didn't take
const REDELIVER = 60e3;

const AGAIN = "Your process was stopped before you were done, so the outcome of your last calls is unknown. Check what they did before doing any again, then go on with the task. The message you were working on:\n\n";

const GONE = "its holder ended before the run did";

// a subagent's holder that died is tried again, this many times in this
// long at most
const RETRIES = 3;
const RETRIES_IN = 5 * 60e3;

// how long siblings wait, at most, for the first to begin to answer
const LEAD = 60e3;

// what a run tells once its model has begun to answer
const ANSWERED = new Set<Ev["k"]>(["text", "tool", "turn", "ask", "question", "limit", "end"]);

// what a run tells once a usage limit's wait is over
const GOES_ON = new Set<Ev["k"]>(["began", "text", "tool", "result", "ask", "question", "turn", "compacted", "end"]);

// a stop doesn't wait for the unit to end, which takes up to its
// TimeoutStopSec; nothing new starts in the worktree till it has
const STOPPING = "Its holder is still stopping: try again in a few seconds.";

const SENT: Record<Sent, string> = {
  steered  : "Sent: it reaches the {kind} at its next step.",
  queued   : "Queued: it starts the {kind}'s next run once this one ends.",
  answered : "Sent as the answer to its question: it goes on.",
  started  : "Sent: the {kind} runs again on it, where it left off.",
  again    : "A message with this request was sent already: not sent twice.",
};

// a file of a session's media folder, as the app asks for it; only
// pictures and videos (View's PICTURE, VIDEO) show in the page, the rest
// download
const FILE = /^[\w][\w.-]{0,200}$/;

// each session's cards its holder's parked calls wait on, by call
const CARDS = new Map<string, Map<string, AbortController>>();
// what each session's log told lately, once known, as far as seq: its
// latest line; the reset of the usage limit it waits on (null: none; a
// new holder waits on none till it says so); the tokens of its latest
// request (null: none yet)
type Lately = { seq: number; last: string; until: number | null; used: number | null };
const LATELY = new Map<string, Lately>();
// the wakes being delivered
const SENDING = new Set<string>();
// the calls of Kunumy's tools running here, by id, with their session
const CALLS = new Map<string, { session: string; stop: AbortController }>();
// the times each subagent's holder was tried again lately
const TRIED = new Map<string, number[]>();
// the subagents whose worktree waits for their holder to end, to be removed
const TIDYING = new Set<string>();
// the siblings started with a subagent, launched once it has begun to
// answer
const FOLLOW = new Map<string, string[]>();
// the server's: its tools, with the owner's cards; wake, a message into an
// agent's chat once (id: its act), false if it didn't take it; change, a
// session's row changed
const HOOKS = { tools: null as Tools | null, asked: (_: Asked) => {}, wake: (_: Wake) => Promise.resolve(false), change: () => {} };

export namespace Sessions {

  function holder(s: Session): Holder {
    return { id: s.id, dir: s.dir, unit: s.unit, sock: s.sock };
  }

  function cards(id: string): Map<string, AbortController> {
    const c = CARDS.get(id) ?? new Map<string, AbortController>();
    CARDS.set(id, c);
    return c;
  }

  // at the server's start, before it takes requests, once the agents'
  // chats are open: the wake messages not yet in a chat are sent again;
  // the cards of calls still parked wait again, so an answer given at once
  // finds them, and those of a holder gone are taken down; the devices'
  // jobs of calls a server before this one ran are kept for their devices;
  // a stopped session's holder still running (its server killed midway) is
  // stopped
  export function boot(tools: Tools, asked: (a: Asked) => void, wake: (w: Wake) => Promise<boolean>, change: () => void): void {
    HOOKS.tools = tools;
    HOOKS.asked = asked;
    HOOKS.wake = wake;
    HOOKS.change = change;
    Holders.boot({ held, told: (id, t) => {
      const fx = take(id, t);
      return () => {
        after(id, fx);
        if (ANSWERED.has(t.ev.k)) {
          release(id);
        }
      };
    }, welcome, gone, call, took: (_, c) => Session.took(c), scratch: () => Tools.scratch(tools) });
    Session.unsent().forEach(deliver);
    for (const s of Session.list(null)) {
      if (LIVE.includes(s.status)) {
        Session.parked(s.id).forEach((p) => arm(s, p));
        Session.calls(s.id).filter((c) => c.out === null).forEach((c) => Tools.adopt(tools, s.agent, c.tool, args_of(c.input), c.id));
        Holders.adopt(s.id);
      } else if (s.status === "stopped" && Holders.alive(holder(s))) {
        Holders.stop(holder(s));
      }
      if (!LIVE.includes(s.status)) {
        tidy(s.id, true);
      }
    }
  }

  // a live session's holder, to link to
  function held(id: string): { holder: Holder; ack: number } | null {
    const s = Session.get(id);
    return s === null || !LIVE.includes(s.status) ? null : { holder: holder(s), ack: s.ack };
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
    if (!transients()) {
      return "Work sessions run as systemd user units, and systemd-run isn't here.";
    }
    const top = Worktree.top(b.repo);
    if ("why" in top) {
      return top.why;
    }
    const id = crypto.randomUUID().slice(0, 8);
    const base = Worktree.named(top.dir, b.base || "HEAD");
    const branch = b.branch || "kny/" + b.name;
    const worktree = path.join(Machine.agent_dir(b.agent), "sessions", b.name);
    fs.mkdirSync(path.dirname(worktree), { recursive: true });
    const made = Worktree.make(top.dir, base, branch, worktree);
    if (made !== null) {
      return made;
    }
    const dir = path.join(DIR, id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const media = Browser.make(dir, id) ? path.join(dir, MEDIA) : null;
    const spec: Spec = { cwd: worktree, claude: config.claude_dir(agent.claude), model: b.model, append: Brief.append(agent, media, b.brief, HOOKS.tools) };
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
    const h = Holders.named(s.id, s.dir, launches);
    Session.set(s.id, { launches, unit: h.unit, sock: h.sock });
    LATELY.set(s.id, { ...lately(s), until: null });
    const first = s.launches > 0 && s.sdk === "" ? Session.runs(s.id)[0]?.prompt ?? prompt : prompt;
    const text = first === prompt ? prompt : first + "\n\n" + prompt;
    const t = HOOKS.tools;
    const why = Session.kind(s) === "subagent" ? launch_sub(s, h, text) : Holders.launch(h, "Kunumy work session " + s.name, { driver: "claude-code", prompt: text, resume: s.sdk, rules: config.ASK, scratch: t === null ? {} : Tools.scratch(t), tools: t === null ? [] : Tools.kit(t, s.agent) });
    if (why !== null) {
      after(s.id, Session.move(s.id, "failed", why, about === null ? null : { about, text: why }) ?? []);
      return why;
    }
    HOOKS.change();
    return null;
  }

  // a subagent's holder on its job, in its folder (a worktree on no
  // branch made again if its last run's end removed it). null: started;
  // else why not
  function launch_sub(s: Session, h: Holder, prompt: string): string | null {
    const sub = job_of(s);
    if (typeof sub === "string") {
      return sub;
    }
    if (place(s) === "folder") {
      fs.mkdirSync(s.worktree, { recursive: true });
    }
    const why = place(s) === "detached" && !fs.existsSync(s.worktree) ? Worktree.detach(s.repo, s.base, s.worktree) : null;
    if (why !== null) {
      return why;
    }
    const t = HOOKS.tools;
    const tools = t === null ? [] : Tools.kit(t, s.agent, { memory: s.memory === 1, mcp: sub.mcp, write: s.write === 1 });
    const c = sub.job.context;
    const job = { ...sub.job, context: c.kind === "native" ? { ...c, resume: s.sdk } : c, tools: [] };
    return Holders.launch(h, "Kunumy subagent " + s.name, { driver: "provider", job, sub: true, prompt, resume: s.sdk, rules: config.ASK, scratch: t === null ? {} : Tools.scratch(t), tools });
  }

  // a subagent's job, or why it can't be read
  function job_of(s: Session): Sub | string {
    try {
      return JSON.parse(fs.readFileSync(path.join(s.dir, SUB), "utf8")) as Sub;
    } catch (err) {
      return "its job can't be read: " + err_why(err);
    }
  }

  // a subagent made (Subagents), its job written in its folder
  export function subagent(s: Parameters<typeof Session.add>[0], sub: Sub, task: string): Session {
    fs.mkdirSync(s.dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(s.dir, SUB), JSON.stringify(sub) + "\n", { mode: 0o600 });
    return Session.add(s, task);
  }

  // subagents made together launched: the first now, the rest once it has
  // begun to answer, so they find its view in the prompt cache; the first
  // that can't start lets the rest go at once
  export function begin(ids: string[]): void {
    const [lead, ...rest] = ids;
    const s = lead === undefined ? null : Session.get(lead);
    if (s === null) {
      return;
    }
    FOLLOW.set(s.id, rest);
    setTimeout(() => release(s.id), LEAD).unref();
    const run = Session.run(s.id);
    if (launch(s, run?.prompt ?? "", null) !== null) {
      release(s.id);
    }
  }

  // the siblings that waited for id launched
  function release(id: string): void {
    const rest = FOLLOW.get(id) ?? [];
    FOLLOW.delete(id);
    rest.forEach(next_run);
  }

  // whether a subagent's holder may be tried again now, counted if so
  function retry(id: string): boolean {
    const now = Date.now();
    const tried = (TRIED.get(id) ?? []).filter((at) => now - at < RETRIES_IN);
    TRIED.set(id, tried.length < RETRIES ? [...tried, now] : tried);
    return tried.length < RETRIES;
  }

  // the holder is gone, its log taken in: a run it left unfinished
  // failed, to resume, or a subagent's at work (waiting on no one) tried
  // again; a run the record started whose holder never launched (the
  // server stopped first) launches
  function gone(id: string, was: Holder): void {
    const now = Session.get(id);
    const run = Session.run(id);
    if (now !== null && run !== null && LIVE.includes(now.status)) {
      const again = now.unit === was.unit && now.unit !== "" && Session.kind(now) === "subagent" && now.status === "running" && retry(id) ? Session.retry(id) : null;
      const s = again === null ? null : Session.get(id);
      if (now.unit === "") {
        next_run(id);
      } else if (s !== null && again !== null) {
        launch(s, prompt_of(s, again), "launch " + attempt(again));
      } else if (now.unit === was.unit) {
        after(id, Session.move(id, "failed", GONE, { about: "gone " + attempt(run), text: GONE + ": send it a message to go on" }) ?? []);
      }
    }
    release(id);
    tidy(id, false);
    HOOKS.change();
  }

  // a link's first message: the record catches up with what the holder
  // still has parked and waiting, and the holder with the answers and
  // messages it hasn't taken in
  function welcome(id: string, asks: string[], questions: string[]): void {
    after(id, Session.welcome(id, asks, questions));
    Session.parked(id).filter((p) => p.ok !== null).forEach((p) => Holders.send(id, { $: "answer", id: p.id, ok: p.ok === 1, note: p.note }));
    Session.unheard(id).filter((say) => say.mode !== "queue").forEach((say) => Holders.send(id, { $: "say", id: say.id, text: say.text, answer: say.mode === "answer" }));
  }

  // a call of Kunumy's tools its holder sent, run once: its result sent
  // as soon as it's in, and again each time the holder tells the call
  // again till it took it. One a server before this one started runs
  // again, as Tools.held_call says
  function call(id: string, c: string, tool: string, input: Record<string, unknown>): void {
    const s = Session.get(id);
    const kept = Session.call(c);
    if (s === null || HOOKS.tools === null || CALLS.has(c)) {
      return;
    }
    if (kept !== null && kept.out !== null) {
      Holders.send(id, { $: "result", id: c, out: Wire.out(JSON.parse(kept.out)) });
      return;
    }
    // a tool a subagent's options leave out is refused here too
    const sub = Session.kind(s) === "session" ? null : job_of(s);
    const offered = sub === null || (typeof sub !== "string" && Tools.kit(HOOKS.tools, s.agent, { memory: s.memory === 1, mcp: sub.mcp, write: s.write === 1 }).some((t) => t.name === tool));
    if (!offered) {
      Holders.send(id, { $: "result", id: c, out: { text: "No tool " + tool + ".", fail: true } });
      return;
    }
    if (kept === null && !Session.calling({ id: c, session: id, tool, input: JSON.stringify(input), at: Date.now() })) {
      return;
    }
    const stop = new AbortController();
    CALLS.set(c, { session: id, stop });
    void Tools.held_call(HOOKS.tools, s.agent, tool, input, c, kept !== null, stop.signal).catch((err: unknown) => ({ text: err_why(err), fail: true })).then((out) => {
      CALLS.delete(c);
      Session.called(c, out);
      Holders.send(id, { $: "result", id: c, out });
    });
  }

  function args_of(input: string): Record<string, unknown> {
    try {
      const x: unknown = JSON.parse(input);
      return rec(x) ? x : {};
    } catch {
      return {};
    }
  }

  // one event taken into the record, once: what's left to do after it
  function take(id: string, told: Told): Effect[] {
    const fx = Session.apply(id, told);
    // one not read yet is read from its log, which has the event already
    const known = LATELY.get(id);
    if (known !== undefined) {
      LATELY.set(id, lately_after(known, told));
    }
    return fx;
  }

  // what a change to the record leaves to do, done once it's in
  function after(id: string, fx: Effect[]): void {
    const waits = CARDS.get(id);
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
        (f.ask === null ? [...CALLS.values()].filter((c) => c.session === id) : []).forEach((c) => c.stop.abort());
      } else {
        next_run(id);
      }
    }
    tidy(id, true);
    HOOKS.change();
  }

  // a worktree on no branch removed once its run is over and its holder
  // has ended; wait: a holder still ending (a stop doesn't wait for it) is
  // looked at again each second till it has
  function tidy(id: string, wait: boolean): void {
    const s = Session.get(id);
    if (s === null || LIVE.includes(s.status) || place(s) !== "detached" || !fs.existsSync(s.worktree)) {
      return;
    }
    if (!Holders.alive(holder(s))) {
      TIDYING.delete(id);
      unmake(s, true);
    } else if (wait && !TIDYING.has(id)) {
      TIDYING.add(id);
      setTimeout(() => {
        TIDYING.delete(id);
        tidy(id, true);
      }, 1000).unref();
    }
  }

  // where it works: a folder of its own, a worktree on no branch, or one
  // on its own branch
  function place(s: Session): "folder" | "detached" | "branch" {
    return s.repo === "" ? "folder" : s.branch === "" ? "detached" : "branch";
  }

  // its folder or worktree (and branch) removed; null: done, else why not
  function unmake(s: Session, force: boolean): string | null {
    if (place(s) === "folder") {
      fs.rmSync(s.worktree, { recursive: true, force: true });
      return null;
    }
    return Worktree.remove(s.repo, s.base, s.branch, s.worktree, force);
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
    const waits = cards(s.id);
    if (HOOKS.tools === null || waits.has(p.id) || p.ok !== null) {
      return;
    }
    const stop = new AbortController();
    waits.set(p.id, stop);
    void Gate.wait(HOOKS.tools.gate, s.agent, Session.label(s), "session", p.tool, args_of(p.input), p.what, stop.signal, HOOKS.asked).then((said) => {
      waits.delete(p.id);
      if (said !== null) {
        Session.answer(p.id, said.ok, said.note);
        Holders.send(s.id, { $: "answer", id: p.id, ok: said.ok, note: said.note });
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
    if (!live && Holders.alive(holder(s))) {
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
        Holders.send(id, { $: "say", id: key, text, answer: as === "answer" });
      }
      return as === "answer" ? "answered" : as === "steer" ? "steered" : "queued";
    }
    const why = Session.again(id, text, [key]) === null ? Session.label(s) + " can't take a message now." : launch(s, text, null);
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
      return Session.label(s) + " is " + s.status + ": nothing to resume.";
    }
    if (Holders.alive(holder(s))) {
      return STOPPING;
    }
    const run = Session.again(id, null);
    return run === null ? Session.label(s) + " can't be resumed now." : launch(s, prompt_of(s, run), null);
  }

  // its holder and everything it started killed (the whole unit), its
  // browser closed; the messages it didn't take in are dropped with it.
  // wake: its agent is told (the user stopped it, not the agent); why: for
  // its record
  function stop(id: string, wake: boolean, why = ""): string | null {
    const s = Session.get(id);
    const run = Session.run(id);
    if (s === null || run === null) {
      return "No session " + id + ".";
    }
    const fx = Session.move(id, "stop", why, wake ? { about: "stop " + attempt(run), text: "by the user. " + kept(s) + ": send it a message to go on." } : null);
    if (fx === null) {
      return Session.label(s) + " is " + s.status + " already.";
    }
    Holders.stop(holder(s));
    void Browser.close(s.dir);
    tidy(id, true);
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
      return Session.label(s) + " is " + s.status + ": stop it first.";
    }
    if (Holders.alive(holder(s))) {
      return STOPPING;
    }
    // a folder of its own, or a worktree on no branch, holds nothing to keep
    const why = unmake(s, force || place(s) !== "branch");
    if (why !== null) {
      return why;
    }
    void Browser.forget(s.dir);
    Session.set(id, { archived: 1 });
    Holders.forget(holder(s));
    CARDS.delete(id);
    LATELY.delete(id);
    TRIED.delete(id);
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
    const told = lately(s);
    const run = Session.run(s.id);
    const waits: Waits = Session.parked(s.id).length > 0 ? "approval" : Session.questions(s.id).length > 0 ? "answer" : LIVE.includes(s.status) && told.until !== null ? "limit" : null;
    const ended = run?.ended ?? null;
    const models = Pick.models([vendor(s)], LABELS).map(([, m]) => m);
    const model = models.find((m) => m.id === s.model || m.label === s.model);
    // one Claude Code names on its own (opus, its default): the least window
    const window = model?.window ?? Math.min(...models.map((m) => m.window));
    return {
      id: s.id, name: s.name, who: Session.label(s), agent: s.agent, branch: s.branch, task: line(Session.task(s.id), LINE), model: model?.label ?? s.model, effort: s.effort,
      status: s.status, waits, until: waits === "limit" ? told.until : null, meter: told.used === null ? null : { tokens: told.used, window },
      last: told.last, started: run?.started ?? s.made, ended, at: s.at, unseen: ended !== null && ended > s.seen,
    };
  }

  // the vendor it runs at: a work session's is a Claude plan
  function vendor(s: Session): Vendor {
    return s.provider === "openai" ? (s.account === "key" ? "openai-api" : "openai-sub") : s.account === "key" ? "claude-api" : "claude-sub";
  }

  // what its log told lately, read from it the first time
  function lately(s: Session): Lately {
    const known = LATELY.get(s.id) ?? Hold.told(s.dir).reduce(lately_after, { seq: 0, last: line(s.last, LINE), until: null, used: null });
    LATELY.set(s.id, known);
    return known;
  }

  function lately_after(l: Lately, t: Told): Lately {
    if (t.seq <= l.seq) {
      return l;
    }
    const last = latest_of(t.ev);
    return { seq: t.seq, last: last === "" ? l.last : last, until: t.ev.k === "limit" ? t.ev.until : GOES_ON.has(t.ev.k) ? null : l.until, used: t.ev.k === "used" ? t.ev.tokens : l.used };
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
    if (arg("action") !== "start") {
      return Sessions.act(agent, "session", args);
    }
    const had = Session.list(agent).map(row).find((x) => x.name === arg("name"));
    if (had !== undefined) {
      return { text: "You have a session " + had.name + " already (" + state(had) + "): read it, or pick another name.", fail: true };
    }
    const brief = arg("brief");
    const s = start({ agent, repo: Machine.home(arg("repo")), base: arg("base"), branch: arg("branch"), name: arg("name"), brief, prompt: brief, model: arg("model") });
    const bare = typeof s === "string" || fs.existsSync(Browser.script(s.dir)) ? "" : " It has no browser: agent-browser is neither on this computer's PATH nor set as agent_browser in Kunumy's config.";
    return typeof s === "string" ? { text: s, fail: true } : { text: "Started session " + s.name + " on branch " + s.branch + " (from " + s.base + "), in " + s.worktree + "." + bare + " It works on its own: you get one message \"[Session " + s.name + "] …\" when it's done, fails, waits on the user's approval or asks you something. Don't wait for it or read it to check: go on with other work, or end your turn.", fail: false };
  }

  // what the session or subagent tool does but start: on the agent's own
  // sessions, or subagents, by name
  export function act(agent: string, kind: Kind, args: Record<string, unknown>): Out {
    const arg = (k: string) => (args[k] === undefined || args[k] === null ? "" : text_of(args[k]).trim());
    const ok = (text: string): Out => ({ text, fail: false });
    const no = (text: string): Out => ({ text, fail: true });
    const mine = Session.list(agent).filter((x) => Session.kind(x) === kind).map(row);
    const action = arg("action");
    if (action === "list") {
      return ok(mine.length === 0 ? "You have no " + kind + "s." : mine.map((x) => x.name + ": " + state(x) + (x.branch === "" ? "" : ", branch " + x.branch) + (x.last === "" ? "" : ", last: " + line(x.last, 80))).join("\n"));
    }
    const s = mine.find((x) => x.name === arg("name"));
    if (s === undefined) {
      return no("You have no " + kind + " " + JSON.stringify(arg("name")) + ". Yours: " + (mine.map((x) => x.name).join(", ") || "none") + ".");
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
        return typeof sent !== "string" ? no(sent.why) : ok(Prompts.fill(SENT[sent], { kind }) + " You get a message when it's done or needs you: don't wait for it.");
      }
      case "read": {
        const record = Session.get(s.id);
        return record === null ? no("No " + kind + " " + s.name + ".") : ok(read(record, args.after === undefined ? null : Number(args.after) || 0, Number(args.n) || LINES));
      }
      case "stop": {
        const why = stop(s.id, false, arg("why"));
        const record = Session.get(s.id);
        return why !== null || record === null ? no(why ?? "No " + kind + " " + s.name + ".") : ok("Stopped " + s.name + ". " + kept(record) + ": send it a message to go on, or archive it.");
      }
      case "archive": {
        const why = archive(s.id, args.force === true);
        const record = Session.get(s.id);
        return why !== null || record === null ? no(why ?? "No " + kind + " " + s.name + ".") : ok("Archived " + s.name + ": " + ({ folder: "its folder is", detached: "its worktree is", branch: "its worktree and branch are" }[place(record)]) + " removed, its record kept.");
      }
    }
    return no("action is start, send, read, stop, list or archive.");
  }

  // what a stopped one keeps
  function kept(s: Session): string {
    return { folder: "Its folder stays", detached: "Its worktree goes with its run (a new run makes it again)", branch: "Its worktree and branch stay" }[place(s)];
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
      ev.k === "limit" ? "waits for a usage limit, till " + clock(ev.until) :
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
    const all = p.log.filter((t) => !["began", "heard", "replied", "compacted", "dropped", "used"].includes(t.ev.k));
    const shown = after === null ? all.slice(-TAIL) : all.filter((t) => t.seq > after).slice(0, Math.min(Math.max(1, n), LINES_MOST));
    const more = after !== null && shown.length > 0 && all.at(-1) !== shown.at(-1);
    const where = { folder: "Folder " + p.worktree, detached: "Worktree " + p.worktree + " at " + p.base + ", on no branch", branch: "Branch " + p.branch + " from " + p.base + ", worktree " + p.worktree }[place(s)];
    const how = Session.kind(s) === "subagent" ? " Model " + s.model + (s.effort === "" ? "" : ", effort " + s.effort) + "." : "";
    const head = Session.label(s) + ": " + state(p) + (run === null ? "" : ", run " + run.n + (run.attempts > 1 ? " (attempt " + run.attempts + ")" : "")) + ". " + where + ", media " + path.join(s.dir, MEDIA) + "." + how;
    const lines = [
      head,
      ...p.parked.map((c) => "Waits on the user's approval, in the app (you can't give it): " + c.what + " (" + c.tool + " " + line(c.input, 200) + ")"),
      ...p.questions.map((q) => "Asks you (answer with send): " + q.text),
      ...(run !== null && run.report !== "" ? [(Session.kind(s) === "session" ? "Report: " : "Result: ") + run.report] : run !== null && run.why !== "" ? ["Why it " + run.status + ": " + run.why] : []),
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
        const s = Session.get(id);
        return typeof sent === "string" ? out(null, { sent: Prompts.fill(SENT[sent], { kind: s === null ? "session" : Session.kind(s) }) }) : out(sent.why);
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
