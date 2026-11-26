// Room
// ====
// What this computer has free for more subagents, and what those running
// use, measured, for an agent to judge how many more it starts: its cores
// and how busy they are, its memory available and in all, how many run
// (across all agents, and the agent's own) and the CPU and memory each
// one's processes use (its holder, the model's CLI and all they started, as
// Service measures a unit). How busy the cores are is read from /proc/stat,
// sampled every SAMPLE from the server's start and averaged over the last
// WINDOW, not from the load average, which counts tasks waiting on anything
// (WSL's runs far above what the CPU does); where /proc/stat is missing,
// the load average stands in. What the running ones use is sampled every
// SAMPLE too, and again as an agent is told it, once FRESH old. Nothing
// here caps how many start, but below FLOOR of memory available, none does:
// the computer would run out.

import * as fs from "node:fs";
import * as os from "node:os";
import { readings, spent } from "./Service.ts";
import { LIVE, Session } from "./Session.ts";

// a share of the computer: cores busy and memory held, in bytes (null:
// not measured yet)
type Use = { cores: number | null; memory: number | null };

// what some running ones use in all, and how many of them aren't measured
type Total = Use & { missing: number };

// the computer now: its cores, how many of them are busy (the last
// WINDOW's average), its memory available and in all, in bytes; the
// subagents running, and the agent's own of them; what
// they use, and the agent's own
type State = { cores: number; busy: number; available: number; total: number; running: number; mine: number; used: Total; own: Total };

// one's use: its unit, when it was last read and its CPU counters then
// (Service's), its use now (null: its processes weren't found, or it
// doesn't run), and the most it used at a reading in that unit's run
type Sampled = { unit: string; at: number; cpu: Map<string, number>; now: Use | null; most: Use };

const GB = 2 ** 30;
const MB = 2 ** 20;

// the memory available below which nothing starts
const FLOOR = GB;

// how often the CPU's counters and the running ones' use are read, and how
// far back the CPU's use is averaged
const SAMPLE = 5e3;
const WINDOW = 60e3;

// how old the running ones' use may be when an agent is told it, read
// again if older
const FRESH = 1e3;

// the CPU's counters read lately (/proc/stat's cpu line), oldest first,
// none before WINDOW but the one it starts from; sampled: reading them
// every SAMPLE has started
const TICKS: Array<{ at: number; line: string }> = [];
let SAMPLED = false;

// each subagent's use, by its id, kept after its run
// till it's archived; and when they were last read
const USED = new Map<string, Sampled>();
let MEASURED = -Infinity;

export namespace Room {

  export function now(agent: string): State {
    Room.sample();
    fresh();
    const live = Session.list(null).filter((s) => LIVE.includes(s.status));
    const mine = live.filter((s) => s.agent === agent);
    const cores = os.availableParallelism();
    const busy = Room.busy(TICKS.length > 1 ? TICKS[0].line : null, TICKS.at(-1)?.line ?? null, os.loadavg()[0], cores);
    return { cores, busy, available: available(), total: os.totalmem(), running: live.length, mine: mine.length, used: summed(live), own: summed(mine) };
  }

  // the computer as an agent is told it
  export function said(s: State): string {
    // what's available rounded down, never told as more than it is
    const head = s.cores + " cores, " + Math.round((100 * s.busy) / s.cores) + "% busy; memory " + gb(Math.floor((s.available / GB) * 10) * (GB / 10)) + " available of " + gb(s.total) + "; ";
    if (s.running === 0) {
      return head + "no subagents running";
    }
    const all = s.running + (s.running === 1 ? " subagent" : " subagents") + " running across all agents";
    const own = s.mine === 0 ? ", none of them yours" : s.mine === s.running ? (s.running === 1 ? ", yours" : ", all of them yours") : ", " + s.mine + " of them yours";
    if (s.used.memory === null) {
      return head + all + own + (s.running === 1 ? ": its use isn't measured yet" : ": their use isn't measured yet");
    }
    return head + all + own + (s.running === 1 ? ": it uses " : ": they use ") + total_said(s.used) + (s.mine === 0 || s.mine === s.running ? "" : ", yours " + total_said(s.own));
  }

  // why nothing may start now; null: it may
  export function refused(s: State): string | null {
    return s.available >= FLOOR ? null : "Only " + Math.floor(s.available / MB) + " MB of memory is available on this computer, under the " + FLOOR / GB + " GB kept free so it doesn't run out. Nothing started: wait for some subagents to end, or do the work yourself. This computer: " + Room.said(s) + ".";
  }

  // what a subagent uses, or used in its last run, as its
  // agent is told it; null: not measured
  export function used(id: string): string | null {
    fresh();
    const u = USED.get(id);
    const s = Session.get(id);
    if (u === undefined || u.most.memory === null || s === null || (LIVE.includes(s.status) && u.unit !== s.unit)) {
      return null;
    }
    if (!LIVE.includes(s.status)) {
      return "used at most " + use_said(u.most) + " in its last run";
    }
    return (u.now === null ? "its processes not found now" : "uses now " + use_said(u.now)) + "; at most " + use_said(u.most) + " so far";
  }

  // the cores busy between two readings of /proc/stat's cpu line (then
  // null: since the computer started): all its time but idle and iowait,
  // as a share of the cores; with no reading, the load average, at most
  // every core
  export function busy(then: string | null, now: string | null, load: number, cores: number): number {
    const b = now === null ? null : counted(now);
    if (b === null) {
      return Math.min(cores, load);
    }
    const a = then === null ? null : counted(then);
    const total = b.total - (a?.total ?? 0);
    return total > 0 ? Math.min(cores, Math.max(0, (cores * (b.busy - (a?.busy ?? 0))) / total)) : 0;
  }

  // a cpu line's busy and whole time: user, nice, system, idle, iowait,
  // irq, softirq, steal (guest time is in user already)
  function counted(line: string): { busy: number; total: number } | null {
    const f = line.trim().split(/\s+/).slice(1, 9).map(Number);
    if (!line.startsWith("cpu ") || f.length < 5 || f.some((n) => !Number.isFinite(n))) {
      return null;
    }
    const total = f.reduce((a, n) => a + n, 0);
    return { busy: total - f[3] - f[4], total };
  }

  // the CPU's counters and the running ones' use read now, and every
  // SAMPLE from the first time on (the server's start)
  export function sample(): void {
    if (SAMPLED) {
      return;
    }
    SAMPLED = true;
    const read = () => {
      fresh();
      const line = stat();
      if (line === null) {
        return;
      }
      const at = performance.now();
      TICKS.push({ at, line });
      while (TICKS.length > 2 && TICKS[1].at <= at - WINDOW) {
        TICKS.shift();
      }
    };
    read();
    setInterval(read, SAMPLE).unref();
  }

  function fresh(): void {
    if (performance.now() - MEASURED >= FRESH) {
      measure();
    }
  }

  function measure(): void {
    MEASURED = performance.now();
    const all = Session.list(null);
    const ids = new Set(all.map((s) => s.id));
    [...USED.keys()].filter((id) => !ids.has(id)).forEach((id) => USED.delete(id));
    const live = all.filter((s) => LIVE.includes(s.status) && s.unit !== "");
    for (const s of all.filter((x) => !live.includes(x))) {
      const was = USED.get(s.id);
      if (was !== undefined) {
        USED.set(s.id, { ...was, now: null });
      }
    }
    if (live.length === 0) {
      return;
    }
    const got = readings(live.map((s) => ({ name: s.unit, dir: s.dir })));
    const at = performance.now();
    for (const s of live) {
      const was = USED.get(s.id);
      const u = got.get(s.unit);
      // CPU counters only from a reading of the same run's processes
      const same = was !== undefined && was.unit === s.unit ? was : null;
      const cores = u === undefined || same === null || same.now === null ? null : spent(same.cpu, u.cpu) / ((at - same.at) * 1e3);
      const most = { cores: larger(same?.most.cores ?? null, cores), memory: larger(same?.most.memory ?? null, u?.memory ?? null) };
      USED.set(s.id, { unit: s.unit, at, cpu: u?.cpu ?? new Map<string, number>(), now: u === undefined ? null : { cores, memory: u.memory }, most });
    }
  }

  function larger(a: number | null, b: number | null): number | null {
    return a === null ? b : b === null ? a : Math.max(a, b);
  }

  function summed(list: Session[]): Total {
    const now = list.flatMap((s) => USED.get(s.id)?.now ?? []);
    const sum = (k: keyof Use) => now.reduce<number | null>((a, u) => (u[k] === null ? a : (a ?? 0) + u[k]), null);
    return { cores: sum("cores"), memory: sum("memory"), missing: list.length - now.length };
  }

  function total_said(t: Total): string {
    return t.memory === null ? "not measured yet" : use_said(t) + (t.missing > 0 ? " (" + t.missing + " of them not measured yet)" : "");
  }

  function use_said(u: Use): string {
    return u.memory === null ? "not measured yet" : u.cores === null ? gb(u.memory) + " (CPU not measured yet)" : u.cores.toFixed(1) + " cores and " + gb(u.memory);
  }

  function gb(bytes: number): string {
    return (bytes / GB).toFixed(1) + " GB";
  }

  function stat(): string | null {
    try {
      return fs.readFileSync("/proc/stat", "utf8").split("\n").find((l) => l.startsWith("cpu ")) ?? null;
    } catch {
      return null;
    }
  }

  // the memory free for new work: Linux's estimate, page cache it can
  // drop counted in; elsewhere, what's unused
  function available(): number {
    try {
      const kb = /^MemAvailable:\s+(\d+) kB/m.exec(fs.readFileSync("/proc/meminfo", "utf8"))?.[1];
      if (kb !== undefined) {
        return Number(kb) * 1024;
      }
    } catch {}
    return os.freemem();
  }

}
