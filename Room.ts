// Room
// ====
// How many more subagents and work sessions this computer has room for
// now: what its free memory, its cores and their load leave, and at most
// PER_CORE running per core across all agents. One started lately counts
// against the room as if it used its share already, since the load and the
// free memory show it only later. Montroop's config can set the most that
// run at once instead (submons). Each turn of an agent whose subagents run
// on the engine tells it, and its subagent tool starts no more than that.

import * as fs from "node:fs";
import * as os from "node:os";
import * as config from "./Config.ts";
import { LIVE, Session } from "./Session.ts";

// the computer now: its cores, their load (the last minute's average),
// its memory free and in all, in bytes; the subagents and work sessions
// running, and those of them started within FRESH; the most that may run
// at once (0: as the computer allows)
type State = { cores: number; load: number; free: number; total: number; running: number; fresh: number; most: number };

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

// how long one just started may not show in the load and free memory yet
const FRESH = 2 * 60e3;

export namespace Room {

  export function now(): State {
    const live = Session.list(null).filter((s) => LIVE.includes(s.status));
    const fresh = live.filter((s) => Date.now() - (Session.run(s.id)?.started ?? s.made) < FRESH).length;
    return { cores: os.availableParallelism(), load: os.loadavg()[0], free: available(), total: os.totalmem(), running: live.length, fresh, most: config.WORKERS };
  }

  // how many more fit beside those running
  export function fit(s: State): number {
    if (s.most > 0) {
      return Math.max(0, s.most - s.running);
    }
    const memory = Math.floor((s.free - Math.max(RESERVE, s.total * RESERVE_SHARE)) / EACH) - s.fresh;
    const cores = Math.floor((s.cores - s.load) / CORES_EACH) - s.fresh;
    return Math.max(0, Math.min(memory, cores, s.cores * PER_CORE - s.running));
  }

  // the room as an agent is told it
  export function said(s: State): string {
    return s.cores + " cores at load " + s.load.toFixed(1) + ", " + (s.free / GB).toFixed(1) + " GB of memory free, " + s.running + (s.running === 1 ? " subagent or work session" : " subagents and work sessions") + " running across all agents: room for " + Room.fit(s) + " more now" + (s.most > 0 ? "; Montroop's config lets " + s.most + " run at once" : "");
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
