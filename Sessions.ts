// Sessions
// ========
// The server's side of work sessions: it starts each run's holder (Hold) as
// a systemd user unit of its own, so a server restart or deploy leaves it
// running; links to it over its socket, taking in what it tells (Wire)
// into the session's record (Session) and acking it; shows each call it
// parks as the owner's Ask card (Gate) and sends the answer back. On boot
// it links again to the holders still running, and marks the sessions
// whose holder is gone as failed, to resume.

import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import * as config from "./Config.ts";
import { err_why } from "./Err.ts";
import { Gate, type Asked } from "./Gate.ts";
import { Hold, SPEC, START, type Spec, type Start } from "./Hold.ts";
import { get, rec, str } from "./Json.ts";
import { Machine } from "./Machine.ts";
import { Owner } from "./Owner.ts";
import * as Pins from "./Pins.ts";
import { command, run, said } from "./Service.ts";
import { LIVE, Session, type Parked } from "./Session.ts";
import { Team } from "./Team.ts";
import { Wire, type Ev, type Told } from "./Wire.ts";
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

const DIR = path.join(config.DIR, "sessions");

const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

const LAST = 300;

const PAGE = 100;
const PAGE_MOST = 1000;

// how long, at most, between tries to reach a holder that runs
const RETRY = 5000;

// the variables a holder's Claude Code works with, from the server's
const ENV = ["PATH", "LANG", "SHELL", "SSH_AUTH_SOCK", "XDG_CONFIG_HOME", "XDG_DATA_HOME"];

const AGAIN = "Your process was stopped before you were done, so the outcome of your last calls is unknown. Check what they did before doing any again, then go on with the task. The message you were working on:\n\n";

const GONE = "its holder ended before the run did";

// a stop doesn't wait for the unit to end, which takes up to its
// TimeoutStopSec; nothing new starts in the worktree till it has
const STOPPING = "Its holder is still stopping: try again in a few seconds.";

const LINKS = new Map<string, Link>();
const CARDS = { gate: null as Gate | null, asked: (_: Asked) => {} };

export namespace Sessions {

  export function unit(s: Session): string {
    return "ki-hold-" + s.id + "-" + s.launches;
  }

  export function sock(s: Session): string {
    return path.join(s.dir, "hold-" + s.launches + ".sock");
  }

  export function systemctl(args: string[]): string {
    const r = run(["systemctl", "--user", ...args]);
    return said(r);
  }

  export function alive(s: Session): boolean {
    return s.launches > 0 && ["active", "activating", "deactivating"].includes(Sessions.systemctl(["is-active", Sessions.unit(s)]));
  }

  export function link_of(id: string): Link {
    const l = LINKS.get(id) ?? { sock: null, waits: new Map(), tries: 0, timer: null };
    LINKS.set(id, l);
    return l;
  }

  // at the server's start, before it takes requests: the cards of calls
  // still parked wait again, so an answer given at once finds them, and
  // those of a holder gone are taken down
  export function boot(gate: Gate, asked: (a: Asked) => void): void {
    CARDS.gate = gate;
    CARDS.asked = asked;
    config.RELOADED.add(() => LINKS.forEach((l) => Wire.send(l.sock, { $: "rules", rules: config.ASK })));
    for (const s of Session.list(null).filter((x) => LIVE.includes(x.status))) {
      Session.parked(s.id).forEach((p) => Sessions.arm(s, p));
      if (Sessions.alive(s)) {
        Sessions.link(s.id);
      } else {
        Sessions.gone(s.id);
      }
    }
  }

  export function start(b: Begin): Session | string {
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
    const spec: Spec = { cwd: worktree, claude: config.claude_dir(agent.claude), model: b.model, append: [b.brief.trim(), Pins.block(false).text.trim()].filter((t) => t !== "").join("\n\n") };
    fs.writeFileSync(path.join(dir, SPEC), JSON.stringify(spec, null, 1) + "\n", { mode: 0o600 });
    const s = Session.add({ id, name: b.name, agent: b.agent, repo: top.dir, base, branch, worktree, account: agent.claude, model: b.model, dir }, b.prompt);
    const why = Sessions.launch(s, b.prompt);
    return why === null ? Session.get(id) ?? s : why;
  }

  // a run's holder started on its first message, resuming the session's
  // Claude Code session if it has one; null: started
  export function launch(s: Session, prompt: string): string | null {
    const next = { ...s, launches: s.launches + 1 };
    Session.set(s.id, { launches: next.launches });
    const begin: Start = { prompt, resume: s.sdk, rules: config.ASK, sock: Sessions.sock(next) };
    fs.writeFileSync(path.join(s.dir, START), JSON.stringify(begin, null, 1) + "\n", { mode: 0o600 });
    const env = Object.entries({ ...Object.fromEntries(ENV.flatMap((k) => (process.env[k] ? [[k, process.env[k]]] : []))), KI_DIR: config.DIR });
    const r = run(["systemd-run", "--user", "--collect", "--quiet", "--unit=" + Sessions.unit(next), "--description=Ki work session " + s.name, "-p", "TimeoutStopSec=10", ...env.map(([k, v]) => "--setenv=" + k + "=" + v), "--", ...command(), "hold", s.dir]);
    if (r.code !== 0) {
      const why = "systemd-run failed: " + said(r);
      Session.move(s.id, "failed", why);
      return why;
    }
    Sessions.unlink(s.id);
    Sessions.link(s.id);
    return null;
  }

  export function link(id: string): void {
    const s = Session.get(id);
    const l = Sessions.link_of(id);
    if (s === null || l.sock !== null) {
      return;
    }
    const sock = net.createConnection(Sessions.sock(s));
    l.sock = sock;
    sock.setEncoding("utf8");
    sock.on("connect", () => {
      l.tries = 0;
      Wire.send(sock, { $: "hello", ack: Session.get(id)?.ack ?? 0, rules: config.ASK });
    });
    sock.on("data", Wire.lines((msg) => {
      try {
        Sessions.got(id, sock, msg);
      } catch (err) {
        console.error("ki: session " + id + ": " + err_why(err));
      }
    }));
    sock.on("error", () => {});
    sock.on("close", () => {
      if (l.sock === sock) {
        l.sock = null;
        Sessions.lost(id);
      }
    });
  }

  export function unlink(id: string): void {
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
  export function lost(id: string): void {
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
      if (Sessions.alive(now)) {
        Sessions.link(id);
      } else {
        Sessions.gone(id);
      }
    }, Math.min(RETRY, 100 * l.tries));
  }

  // the holder is gone: what its log holds past the last ack is taken in;
  // a run it left unfinished failed, to resume
  export function gone(id: string): void {
    const s = Session.get(id);
    if (s === null) {
      return;
    }
    fs.rmSync(Sessions.sock(s), { force: true });
    Hold.told(s.dir).filter((t) => t.seq > s.ack).forEach((t) => Sessions.take(id, t));
    const now = Session.get(id);
    if (now !== null && LIVE.includes(now.status)) {
      Sessions.drop(now.id);
      Session.move(now.id, "failed", GONE);
    }
  }

  export function got(id: string, sock: net.Socket, msg: Record<string, unknown>): void {
    if (msg.$ === "welcome") {
      const held = new Set((Array.isArray(msg.asks) ? msg.asks : []).map((a) => str(get(a, "id"))));
      for (const p of Session.parked(id)) {
        if (!held.has(p.id)) {
          Sessions.unpark(id, p.id);
        } else if (p.ok !== null) {
          Wire.send(sock, { $: "answer", id: p.id, ok: p.ok === 1, note: p.note });
        }
      }
      Session.unheard(id).forEach((say) => Wire.send(sock, { $: "say", id: say.id, text: say.text }));
    } else if (msg.$ === "ev" && typeof msg.seq === "number" && rec(msg.ev)) {
      Sessions.take(id, { seq: msg.seq, at: Number(msg.at) || Date.now(), ev: msg.ev as Ev });
      Wire.send(sock, { $: "ack", seq: msg.seq });
    }
  }

  // one event taken into the record, once
  export function take(id: string, told: Told): void {
    const s = Session.get(id);
    if (s === null || told.seq <= s.ack) {
      return;
    }
    const ev = told.ev;
    if (ev.k === "began") {
      Session.set(id, { sdk: ev.sdk });
    } else if (ev.k === "text") {
      Session.set(id, { last: ev.text.trim().slice(-LAST) });
    } else if (ev.k === "ask" && LIVE.includes(s.status)) {
      const p = { id: ev.id, session: id, tool: ev.tool, input: JSON.stringify(ev.input), what: ev.what, at: told.at };
      Session.park(p);
      Session.move(id, "ask");
      Sessions.arm(s, { ...p, ok: null, note: "" });
    } else if (ev.k === "answered" || ev.k === "dropped") {
      Sessions.unpark(id, ev.id);
    } else if (ev.k === "heard") {
      Session.heard([ev.id]);
    } else if (ev.k === "end") {
      Sessions.drop(id);
      Session.move(id, ev.ok ? "ended" : "failed", ev.ok ? "" : ev.text);
      // after the ack goes out, so the holder ending now isn't kept waiting
      queueMicrotask(() => Sessions.next_run(id));
    }
    Session.set(id, { ack: told.seq });
  }

  // messages a run's holder did not take in before it ended start the next
  export function next_run(id: string): void {
    const s = Session.get(id);
    const says = Session.unheard(id);
    if (s === null || says.length === 0 || LIVE.includes(s.status) || s.status === "stopped") {
      return;
    }
    const text = says.map((say) => say.text).join("\n\n");
    Session.heard(says.map((say) => say.id));
    if (Session.again(id, text) !== null) {
      Sessions.launch(s, text);
    }
  }

  // a parked call shown as the owner's card in its agent's chat, waiting
  // for an answer, which goes to the holder
  export function arm(s: Session, p: Parked): void {
    const l = Sessions.link_of(s.id);
    if (CARDS.gate === null || l.waits.has(p.id) || p.ok !== null) {
      return;
    }
    const stop = new AbortController();
    l.waits.set(p.id, stop);
    let input: Record<string, unknown> = {};
    try {
      const x: unknown = JSON.parse(p.input);
      input = rec(x) ? x : {};
    } catch {}
    void Gate.wait(CARDS.gate, s.agent, "Session " + s.name, p.tool, input, p.what, stop.signal, CARDS.asked).then((said) => {
      l.waits.delete(p.id);
      if (said !== null) {
        Session.answer(p.id, said.ok, said.note);
        Wire.send(l.sock, { $: "answer", id: p.id, ok: said.ok, note: said.note });
      }
    });
  }

  export function unpark(id: string, ask: string): void {
    LINKS.get(id)?.waits.get(ask)?.abort();
    Session.unpark(ask);
    if (Session.parked(id).length === 0) {
      Session.move(id, "answered");
    }
  }

  // every card of the session's parked calls taken down
  export function drop(id: string): void {
    LINKS.get(id)?.waits.forEach((w) => w.abort());
    Session.unpark_all(id);
  }

  // a message to a session: into its run if one is at work, else it starts
  // the next; request: the caller's id for it, so a retry sends it once
  export function say(id: string, text: string, request: string): string | null {
    const s = Session.get(id);
    if (s === null || s.archived !== 0) {
      return "No session " + id + ".";
    }
    if (text.trim() === "") {
      return "Say something.";
    }
    const key = id + "/" + request;
    if (!Session.say({ id: key, session: id, text, at: Date.now() })) {
      return null;
    }
    if (LIVE.includes(s.status)) {
      Wire.send(LINKS.get(id)?.sock, { $: "say", id: key, text });
      return null;
    }
    Session.heard([key]);
    if (Session.again(id, text) === null) {
      return "Session " + s.name + " can't take a message now.";
    }
    return Sessions.launch(s, text);
  }

  // the session's latest run tried again where it stopped (its holder
  // gone, or stopped)
  export function resume(id: string): string | null {
    const s = Session.get(id);
    const last = Session.run(id);
    if (s === null || last === null || s.archived !== 0) {
      return "No session " + id + ".";
    }
    if (s.status === "done" || LIVE.includes(s.status)) {
      return "Session " + s.name + " is " + s.status + ": nothing to resume.";
    }
    if (Sessions.alive(s)) {
      return STOPPING;
    }
    Session.again(id, null);
    return Sessions.launch(s, s.sdk === "" ? last.prompt : AGAIN + last.prompt);
  }

  // its holder and everything it started killed (the whole unit); the
  // messages it didn't take in are dropped with it
  export function stop(id: string): string | null {
    const s = Session.get(id);
    if (s === null) {
      return "No session " + id + ".";
    }
    if (Session.move(id, "stop") === null) {
      return "Session " + s.name + " is " + s.status + " already.";
    }
    Sessions.drop(id);
    Session.heard(Session.unheard(id).map((say) => say.id));
    Sessions.unlink(id);
    if (s.launches > 0) {
      Sessions.systemctl(["stop", "--no-block", Sessions.unit(s)]);
    }
    return null;
  }

  // its worktree and branch removed, the record kept; force: even with
  // work found nowhere else
  export function archive(id: string, force: boolean): string | null {
    const s = Session.get(id);
    if (s === null || s.archived !== 0) {
      return "No session " + id + ".";
    }
    if (LIVE.includes(s.status)) {
      return "Session " + s.name + " is " + s.status + ": stop it first.";
    }
    if (Sessions.alive(s)) {
      return STOPPING;
    }
    const why = Worktree.remove(s.repo, s.base, s.branch, s.worktree, force);
    if (why !== null) {
      return why;
    }
    Session.set(id, { archived: 1 });
    LINKS.delete(id);
    return null;
  }

  // what the session told, after seq, at most n
  export function log(id: string, after: number, n: number): Told[] {
    const s = Session.get(id);
    return s === null ? [] : Hold.told(s.dir).filter((t) => t.seq > after).slice(0, n);
  }

  export async function http(req: Request, p: string): Promise<Response> {
    const url = new URL(req.url);
    const m = /^\/api\/sessions(?:\/([0-9a-f]{8})(?:\/(say|resume|stop|archive))?)?$/.exec(p);
    if (m === null) {
      return Response.json({ error: "No such session call." }, { status: 404 });
    }
    const [, id, act] = m;
    const out = (why: string | null) => Response.json(why === null ? Session.get(id) : { error: why }, { status: why === null ? 200 : 409 });
    if (req.method === "GET" && act === undefined) {
      if (id === undefined) {
        return Response.json(Session.list(url.searchParams.get("agent")));
      }
      const s = Session.get(id);
      const after = Number(url.searchParams.get("after") ?? 0) || 0;
      const asked = Number(url.searchParams.get("n") ?? PAGE);
      const n = Math.min(Math.max(0, Number.isNaN(asked) ? PAGE : asked), PAGE_MOST);
      return s === null ? Response.json({ error: "No session " + id + "." }, { status: 404 }) : Response.json({ ...s, runs: Session.runs(id), parked: Session.parked(id), log: Sessions.log(id, after, n) });
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
      const s = Sessions.start({ agent: text("agent"), repo: Machine.home(text("repo")), base: text("base"), branch: text("branch"), name: text("name"), brief: text("brief"), prompt: text("prompt"), model: text("model") });
      return typeof s === "string" ? Response.json({ error: s }, { status: 409 }) : Response.json(s);
    }
    switch (act) {
      case "say":
        return out(Sessions.say(id, text("text"), text("request") || crypto.randomUUID()));
      case "resume":
        return out(Sessions.resume(id));
      case "stop":
        return out(Sessions.stop(id));
      default:
        return out(Sessions.archive(id, get(body, "force") === true));
    }
  }

}
