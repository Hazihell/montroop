// Room
// ====
// How many more subagents and work sessions this computer has room for
// now: what its free memory and its idle cores leave, and at most PER_CORE
// running per core across all agents. How busy the cores are is measured
// (/proc/stat, sampled every SAMPLE over the last WINDOW), not read from the
// load average, which counts tasks waiting on anything (WSL's runs far above
// what the CPU does); where /proc/stat is missing, the load average stands
// in. One started lately counts against the room as if it used its share
// already, since the CPU and the free memory show it only later. Montroop's config can set the most that
// run at once instead (submons). Each turn of an agent whose subagents run
// on the engine tells it, and its subagent tool starts no more than that.

import * as fs from "node:fs";
import * as os from "node:os";
import * as config from "./Config.ts";
import { LIVE, Session } from "./Session.ts";

// the computer now: its cores, how many of them are busy (the last
// WINDOW's average), its memory free and in all, in bytes; the subagents and work sessions
// running, and those of them started within FRESH; the most that may run
// at once (0: as the computer allows)
type State = { cores: number; busy: number; free: number; total: number; running: number; fresh: number; most: number };

const GB = 2 ** 30;

// a subagent's or session's memory: its holder and Claude Code take about
// 315 MB once it has worked a while, and the builds and tests it runs more
const EACH = 0.5 * GB;

// the memory left to the rest of the computer: this much, or this share
// of it all, the more
const RESERVE = 2 * GB;
const RESERVE_SHARE = 0.1;

// the cores a subagent's builds and tests keep busy while they run
const CORES_EACH = 1;

// Claude Code's own work starving the cores past this many per core
const PER_CORE = 2;

// how long one just started may not show in the CPU and free memory yet
const FRESH = 2 * 60e3;

// how often the CPU's counters are read, and how far back its use is
// averaged
const SAMPLE = 5e3;
const WINDOW = 60e3;

// the CPU's counters read lately (/proc/stat's cpu line), oldest first,
// none before WINDOW but the one it starts from; sampled: reading them
// every SAMPLE has started
const TICKS: Array<{ at: number; line: string }> = [];
let SAMPLED = false;

export namespace Room {

  export function now(): State {
    const live = Session.list(null).filter((s) => LIVE.includes(s.status));
    const fresh = live.filter((s) => Date.now() - (Session.run(s.id)?.started ?? s.made) < FRESH).length;
    sample();
    const cores = os.availableParallelism();
    const busy = Room.busy(TICKS.length > 1 ? TICKS[0].line : null, TICKS.at(-1)?.line ?? null, os.loadavg()[0], cores);
    return { cores, busy, free: available(), total: os.totalmem(), running: live.length, fresh, most: config.WORKERS };
  }

  // how many more fit beside those running
  export function fit(s: State): number {
    if (s.most > 0) {
      return Math.max(0, s.most - s.running);
    }
    const memory = Math.floor((s.free - Math.max(RESERVE, s.total * RESERVE_SHARE)) / EACH) - s.fresh;
    const cores = Math.floor((s.cores - s.busy) / CORES_EACH) - s.fresh;
    return Math.max(0, Math.min(memory, cores, s.cores * PER_CORE - s.running));
  }

  // the room as an agent is told it
  export function said(s: State): string {
    return s.cores + " cores, CPU " + Math.round((100 * s.busy) / s.cores) + "% busy, " + (s.free / GB).toFixed(1) + " GB of memory free, " + s.running + (s.running === 1 ? " subagent or work session" : " subagents and work sessions") + " running across all agents: room for " + Room.fit(s) + " more now" + (s.most > 0 ? "; Montroop's config lets " + s.most + " run at once" : "");
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
    return total > 0 ? (cores * (b.busy - (a?.busy ?? 0))) / total : 0;
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

  // the CPU's counters read now, and every SAMPLE from the first time on;
  // none where /proc/stat isn't
  function sample(): void {
    if (SAMPLED) {
      return;
    }
    SAMPLED = true;
    const read = () => {
      const line = stat();
      if (line === null) {
        return;
      }
      const at = Date.now();
      TICKS.push({ at, line });
      while (TICKS.length > 2 && TICKS[1].at <= at - WINDOW) {
        TICKS.shift();
      }
    };
    read();
    if (TICKS.length > 0) {
      setInterval(read, SAMPLE).unref();
    }
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
