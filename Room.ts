// Room
// ====
// How many more submons this computer has room for now: what its free
// memory, its cores and their load leave, and at most PER_CORE running per
// core across all mons. Montroop's config can set the most submons that run
// at once instead (submons). Each turn of a mon whose subagents run on the
// engine tells it, and its subagent tool starts no more than that.

import * as fs from "node:fs";
import * as os from "node:os";
import * as config from "./Config.ts";
import { LIVE, Session } from "./Session.ts";

// the computer now: its cores, their load (the last minute's average),
// its memory free and in all, in bytes, and the submons running on it
type State = { cores: number; load: number; free: number; total: number; running: number };

const GB = 2 ** 30;

// a submon's memory: its holder and Claude Code take about 315 MB once it
// has worked a while, and the builds and tests it runs take more
const EACH = 0.5 * GB;

// the memory left to the rest of the computer: this much, or this share
// of it all, the more
const RESERVE = 2 * GB;
const RESERVE_SHARE = 0.1;

// the cores a submon's builds and tests keep busy while they run
const CORES_EACH = 1;

// Claude Code's own work starving the cores past this many per core
const PER_CORE = 2;

// the most one start of the subagent tool takes
export const TASKS = 10;

export namespace Room {

  export function now(): State {
    const running = Session.list(null).filter((s) => LIVE.includes(s.status)).length;
    return { cores: os.availableParallelism(), load: os.loadavg()[0], free: available(), total: os.totalmem(), running };
  }

  // the submons that fit beside those running; most: how many run at once
  // at most (0: as the computer allows)
  export function fit(s: State, most: number): number {
    if (most > 0) {
      return Math.max(0, most - s.running);
    }
    const memory = Math.floor((s.free - Math.max(RESERVE, s.total * RESERVE_SHARE)) / EACH);
    const cores = Math.floor((s.cores - s.load) / CORES_EACH);
    return Math.max(0, Math.min(memory, cores, s.cores * PER_CORE - s.running));
  }

  // the room as a mon is told it
  export function said(s: State): string {
    const set = config.SUBMONS > 0 ? " (Montroop's config lets " + config.SUBMONS + " run at once)" : "";
    return s.cores + " cores at load " + s.load.toFixed(1) + ", " + (s.free / GB).toFixed(1) + " GB of memory free, " + s.running + " submon" + (s.running === 1 ? "" : "s") + " running across all mons: room for " + Room.fit(s, config.SUBMONS) + " more now" + set + ", at most " + TASKS + " per start";
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
