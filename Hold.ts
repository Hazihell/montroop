// Hold
// ====
// `kny hold <dir>`: a holder, a process of its own (a unit the server
// starts, Holders) so the run in it outlives a server restart. Its driver
// (Driver) does the run, until it has nothing left to do; the holder tells
// the server everything it does (Wire), parks each call a rule names until
// the server sends the owner's answer, has the server run Kunumy's tools,
// and passes on the questions the run asks its agent and the messages sent
// to it. What it tells is also kept in its log, which the server reads what
// it missed from once the holder is gone.

import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import type { Out } from "./Agent.ts";
import type { Call, End, Gated, Inbox, Io, Job } from "./Driver.ts";
import { err_why } from "./Err.ts";
import { rec, str, text_of } from "./Json.ts";
import { spec, STR, type Spec as Tool } from "./Machine.ts";
import { Providers } from "./Providers.ts";
import { Rules, type Rule } from "./Rules.ts";
import { reap } from "./Service.ts";
import { TOOLS, VERSION, Wire, type Ask, type Asking, type Calling, type Kit, type Outbox, type Scratch, type Told } from "./Wire.ts";

// what a session keeps for its life: its worktree, its Claude account's
// folder, its model ("": the account's default) and what its system
// prompt adds, fixed at its start
export type Spec = { cwd: string; claude: string; model: string; append: string };

// what one holder starts with: the driver that runs it (claude-code: a
// work session's, on its spec and the provider's session it resumes, ""
// for a new one; provider: the one the job's provider picks), its first
// message, the rules that ask the owner first and the devices' scratch
// folders they read, the kit of Kunumy's tools a work session is offered
// (a provider job's is its job's tools), the socket it listens on
export type Start = { driver: "claude-code" | "provider"; job?: Omit<Job, "dir">; prompt: string; resume: string; rules: Rule[]; scratch: Scratch; tools: Kit[]; sock: string };

// a start written before drivers were named runs Claude Code; one before
// the server ran tools for holders offers none
type Written = Omit<Start, "driver" | "scratch" | "tools"> & { driver?: string; scratch?: Scratch; tools?: Kit[] };

type Parked = { ask: Ask; done: (g: Gated) => void };

type Sent = { calling: Calling; done: (out: Out) => void };

type Waiting = { q: Asking; done: (answer: string) => void };

// the messages not yet taken, the driver's wait for the next, closed
type Box = { queue: string[]; wake: () => void; shut: boolean };

// a holder's state: what it told and the server hasn't acked, the calls
// parked, the calls the server runs till their results come, the
// questions waiting for an answer, the messages the server sent (by id),
// the driver's inbox, the rules that park a call and the devices' scratch
// folders they read, whether the linked server is from before Kunumy's
// tools ran in sessions, the connection that owns it now, how it tells an
// event
type Held = {
  out     : Outbox;
  asks    : Map<string, Parked>;
  calls   : Map<string, Sent>;
  waits   : Map<string, Waiting>;
  says    : Set<string>;
  box     : Box;
  rules   : Rule[];
  scratch : Scratch;
  older   : boolean;
  conn    : net.Socket | null;
  emit    : Io["emit"];
};

// Kunumy's tools the holder answers itself, before those the server runs
export const HOLDS: Tool[] = [
  spec("ask_owner", "Ask the agent that started this session a question, when you can't go on without its answer (a decision, missing information). The call waits for the answer, which can take a while; it comes back as this call's result.", { question: STR }, ["question"]),
  spec("report", "Give your result to the agent that started this session, once, when you're done: what you did, where (branch, commits, files), how you checked it, what is left. Then end your turn.", { result: STR }, ["result"]),
];

// what a call of Kunumy's gets while an older server, which runs none,
// owns the holder
const OLD = { text: "The server runs an older Kunumy, which runs no tools for work sessions.", fail: true };

// a gate's wait no one ends: a call of Kunumy's waits for its answer
// while the run does
const NEVER = new AbortController().signal;

export const SPEC = "spec.json";
export const START = "start.json";
const LOG = "log.jsonl";

// each log as read so far: the bytes taken in, and what they told
const READ = new Map<string, { at: number; told: Told[] }>();

// how long a holder whose run is over waits for the server to take what
// it has not acked yet; the rest stays in the log
const LINGER = 60e3;

export namespace Hold {

  // what the log holds, oldest first (a line cut short by a crash is
  // skipped); the log only grows, so each read takes in only what came
  // since the last
  export function told(dir: string): Told[] {
    const file = path.join(dir, LOG);
    let kept = READ.get(file) ?? { at: 0, told: [] };
    let fd: number | null = null;
    try {
      fd = fs.openSync(file, "r");
      const size = fs.fstatSync(fd).size;
      kept = size < kept.at ? { at: 0, told: [] } : kept;
      const buf = Buffer.alloc(size - kept.at);
      fs.readSync(fd, buf, 0, buf.length, kept.at);
      const whole = buf.lastIndexOf(10) + 1;
      if (whole > 0 || kept.at === 0) {
        kept = { at: kept.at + whole, told: [...kept.told, ...lines(buf.subarray(0, whole).toString("utf8"))] };
        READ.set(file, kept);
      }
    } catch {
    } finally {
      if (fd !== null) {
        fs.closeSync(fd);
      }
    }
    return kept.told;
  }

  // a log no longer read
  export function forget(dir: string): void {
    READ.delete(path.join(dir, LOG));
  }

  function lines(text: string): Told[] {
    return text.split("\n").flatMap((line) => {
      try {
        const t: unknown = JSON.parse(line);
        return rec(t) && typeof t.seq === "number" && rec(t.ev) ? [t as Told] : [];
      } catch {
        return [];
      }
    });
  }

  // a message from a connection: a hello takes the holder over (closing
  // the one it had) and gets a welcome, then what isn't acked yet; the
  // rest counts only from the connection that owns it
  function got(h: Held, msg: Record<string, unknown>, s: net.Socket): void {
    if (msg.$ === "hello") {
      if (h.conn !== null && h.conn !== s) {
        h.conn.destroy();
      }
      h.conn = s;
      h.older = !(Number(msg.v) >= TOOLS);
      ruled(h, msg);
      Wire.ack(h.out, Number(msg.ack) || 0);
      Wire.send(s, { $: "welcome", v: VERSION, seq: h.out.seq, asks: [...h.asks.values()].map((a) => a.ask), questions: [...h.waits.values()].map((w) => w.q) });
      h.out.kept.forEach((t) => Wire.send(s, { $: "ev", ...t }));
      for (const [id, c] of h.calls) {
        if (h.older) {
          h.calls.delete(id);
          c.done(OLD);
        } else {
          Wire.send(s, { $: "call", ...c.calling });
        }
      }
    } else if (s !== h.conn) {
      return;
    } else if (msg.$ === "ack") {
      Wire.ack(h.out, Number(msg.seq) || 0);
    } else if (msg.$ === "rules") {
      ruled(h, msg);
    } else if (msg.$ === "result" && typeof msg.id === "string") {
      const sent = h.calls.get(msg.id);
      h.calls.delete(msg.id);
      Wire.send(s, { $: "took", id: msg.id });
      sent?.done(Wire.out(msg.out));
    } else if (msg.$ === "answer") {
      answer(h, String(msg.id), msg.ok === true, str(msg.note) ?? "");
    } else if (msg.$ === "say" && typeof msg.id === "string" && typeof msg.text === "string" && !h.says.has(msg.id) && !h.box.shut) {
      h.says.add(msg.id);
      const [first] = h.waits.values();
      if (msg.answer !== true || first === undefined) {
        put(h.box, msg.text);
      } else {
        h.waits.delete(first.q.id);
        h.emit({ k: "replied", id: first.q.id });
        first.done(msg.text);
      }
      h.emit({ k: "heard", id: msg.id });
    }
  }

  // the rules and scratch folders a hello or a change gives, each kept as
  // it was if not given
  function ruled(h: Held, msg: Record<string, unknown>): void {
    h.rules = Array.isArray(msg.rules) ? (msg.rules as Rule[]) : h.rules;
    h.scratch = rec(msg.scratch) ? Object.fromEntries(Object.entries(msg.scratch).filter((e): e is [string, string] => typeof e[1] === "string")) : h.scratch;
  }

  function put(box: Box, text: string): void {
    box.queue.push(text);
    box.wake();
  }

  function inbox(box: Box): Inbox {
    return {
      pending : () => box.queue.length > 0,
      next    : async () => {
        while (box.queue.length === 0 && !box.shut) {
          await new Promise<void>((ok) => (box.wake = ok));
        }
        return box.queue.shift() ?? null;
      },
      close   : () => {
        box.shut = true;
        box.wake();
      },
    };
  }

  // a call parked under the rule it matched (null: none, it runs) till
  // the owner answers it, or the driver drops it; the card shows the tool
  // as shown
  function gate(h: Held, rule: Rule | null, call: Call, stop: AbortSignal, shown = call.native): Promise<Gated> {
    if (rule === null) {
      return Promise.resolve({ ok: true, note: "" });
    }
    return new Promise((ok) => {
      const ask: Ask = { id: call.id, tool: shown, input: call.input, what: rule.what };
      const off = () => {
        if (h.asks.delete(call.id)) {
          h.emit({ k: "dropped", id: call.id });
          ok({ ok: false, note: "Stopped." });
        }
      };
      h.asks.set(call.id, { ask, done: (g) => (stop.removeEventListener("abort", off), ok(g)) });
      stop.addEventListener("abort", off, { once: true });
      h.emit({ k: "ask", ...ask });
    });
  }

  // the owner's answer to a parked call; one it already had, or for a
  // call no longer parked, does nothing
  function answer(h: Held, id: string, ok: boolean, note: string): void {
    const parked = h.asks.get(id);
    if (parked === undefined) {
      return;
    }
    h.asks.delete(id);
    h.emit({ k: "answered", id, ok });
    const said = note === "" ? "." : ": “" + note + "”.";
    parked.done(ok ? { ok, note: note === "" ? "" : "The user approved this with a note: “" + note + "”" } : { ok, note: "The user denied this (" + parked.ask.what.toLowerCase() + ")" + said + " Don't do it another way; if it's still needed, say so when you finish." });
  }

  // one of Kunumy's tools: the holder's own answered here; the server's
  // gated as the in-server endpoint gates them (by Kunumy's name, reading
  // the scratch folder of the device it runs on), then sent to the server,
  // and again after each hello till its result comes
  async function call(h: Held, kit: Kit[], c: Call): Promise<Out> {
    if (c.tool === "ask_owner") {
      return { text: "The answer: " + await ask(h, text_of(c.args.question)), fail: false };
    }
    if (c.tool === "report") {
      h.emit({ k: "report", text: text_of(c.args.result) });
      return { text: "Reported. End your turn now.", fail: false };
    }
    const tool = kit.find((t) => t.name === c.tool);
    if (tool === undefined) {
      return { text: "No tool " + c.tool + ".", fail: true };
    }
    if (h.older) {
      return OLD;
    }
    const said = await gate(h, Rules.kunumy(h.rules, c.tool, c.args, tool.device, h.scratch), c, NEVER, c.tool);
    if (!said.ok) {
      return { text: said.note, fail: true };
    }
    // the server may have become an older one while the call waited
    if (h.older) {
      return OLD;
    }
    const out = await new Promise<Out>((done) => {
      const calling: Calling = { id: c.id, tool: c.tool, input: c.args };
      h.calls.set(c.id, { calling, done });
      Wire.send(h.conn, { $: "call", ...calling });
    });
    return said.note === "" ? out : { ...out, text: out.text + "\n\n(" + said.note + ")" };
  }

  // a question for the run's agent, answered by the next message the
  // server sends as an answer
  function ask(h: Held, text: string): Promise<string> {
    const id = crypto.randomUUID();
    return new Promise<string>((done) => {
      h.waits.set(id, { q: { id, text }, done });
      h.emit({ k: "question", id, text });
    });
  }

  // a work session's job: Claude Code on its plan, in its worktree, the
  // way its spec says
  function sessions(dir: string, start: Written): Omit<Job, "dir"> {
    const spec = JSON.parse(fs.readFileSync(path.join(dir, SPEC), "utf8")) as Spec;
    return {
      account : { provider: "claude", id: "", kind: "plan", dir: spec.claude },
      model   : spec.model,
      effort  : "",
      speed   : "",
      system  : "",
      own     : spec.append,
      context : { kind: "native", resume: start.resume, first: [] },
      cwd     : spec.cwd,
      write   : true,
      tools   : [],
      web     : 0,
    };
  }

  export async function main(dir: string): Promise<void> {
    const start = JSON.parse(fs.readFileSync(path.join(dir, START), "utf8")) as Written;
    const file = path.join(dir, LOG);
    const log = fs.openSync(file, "a");
    // a holder killed mid-line left it unended: the next line starts anew
    const size = fs.fstatSync(log).size;
    if (size > 0 && fs.readFileSync(file).at(size - 1) !== 0x0a) {
      fs.writeSync(log, "\n");
    }
    const h: Held = { out: Wire.outbox(Hold.told(dir).at(-1)?.seq ?? 0), asks: new Map(), calls: new Map(), waits: new Map(), says: new Set(), box: { queue: [start.prompt], wake: () => {}, shut: false }, rules: start.rules, scratch: start.scratch ?? {}, older: false, conn: null, emit: () => {} };
    h.emit = (ev) => {
      const told = Wire.push(h.out, ev, Date.now());
      fs.writeSync(log, JSON.stringify(told) + "\n");
      Wire.send(h.conn, { $: "ev", ...told });
    };

    fs.rmSync(start.sock, { force: true });
    const server = net.createServer((s) => {
      s.setEncoding("utf8");
      s.on("data", Wire.lines((msg) => got(h, msg, s)));
      s.on("error", () => {});
      s.on("close", () => {
        if (h.conn === s) {
          h.conn = null;
          h.older = false;
        }
      });
    });
    await new Promise<void>((ok) => server.listen(start.sock, ok));

    const name = start.driver ?? "claude-code";
    const given = name === "claude-code" ? sessions(dir, start) : name === "provider" ? start.job ?? null : null;
    const kit: Kit[] = name === "provider" ? (given?.tools ?? []).map((t) => ({ device: null, ...t })) : start.tools ?? [];
    const job: Job | null = given === null ? null : { ...given, dir, tools: [...HOLDS, ...kit] };
    const driver = job === null ? null : Providers.driver(job);
    const cwd = job?.cwd ?? null;
    const own = (call: Call) => Rules.match(h.rules, call.tool, call.args, cwd);
    const io: Io = { emit: h.emit, inbox: inbox(h.box), parks: (call) => own(call) !== null, gate: (call, stop) => gate(h, own(call), call, stop), call: (c) => call(h, kit, c) };
    let end: End;
    try {
      end = job === null || driver === null ? { ok: false, text: "This holder has no driver " + name + ": a newer kny started it." } : typeof driver === "string" ? { ok: false, text: driver } : await driver(job, io);
    } catch (err) {
      end = { ok: false, text: err_why(err) };
    }
    io.inbox.close();
    h.emit({ k: "end", ...end });
    for (const at = Date.now(); h.out.kept.length > 0 && Date.now() - at < LINGER; ) {
      await Bun.sleep(200);
    }
    server.close();
    fs.rmSync(start.sock, { force: true });
    fs.closeSync(log);
    reap();
    process.exit(0);
  }

}
