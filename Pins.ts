import type { Block } from "./AskAI.ts";
import type { Out } from "./Agent.ts";
import * as config from "./Config.ts";
import { get, text_of } from "./Json.ts";
import fs from "node:fs";
import { Team } from "./Team.ts";
import { write_whole } from "./Write.ts";

// what the agents learned about the user that must not fade with the
// memory's compression: one line each, in pins.json in Montroop's dir.
// mons: the agents it holds for, with their subagents and work sessions
// (null: every agent); ids run in one sequence across them all. A pin
// with until is temporary; a lasting one leaves when unused for STALE days
export type Pin = {
  id    : number;
  text  : string;
  from  : number | null;
  until : string | null;
  mons  : string[] | null;
  made  : string;
  used  : string;
};

const FILE = config.DIR + "/pins.json";

const CAP = 60;

const STALE = 45;

const LONGEST = 400;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const HEAD = `Pinned: what the user taught you and the team, kept outside the view's
compression, for the whole team (every agent, its subagents and sessions) or
for you (yours see them too). Each line is id|pin (#the message it came from),
with until on a temporary one and the other agents it holds for. Follow them as
the user's standing instructions. With the pin tool: mark as used each pin that
shaped what you did this turn (a lasting pin unused ${STALE} days is unpinned); pin a
correction, preference or rule of the user's on how you work in general, never
one-time context (unsure: ask the user once, "pin …?"; "one-time" means no pin);
choose its for: "all" for how the user wants the whole team to work, yourself
(the default) for your own domain or project, or the agents it fits when it
fits a few; give until to a pin tied to a goal or a date; replace the pin a new
rule changes instead of adding one, and give for to move it; unpin when the
user asks. Say each change in your reply, as "📌 pinned: …" or "📌 unpinned: …".
At ${CAP} pins in a group, propose merges or drops to the user before adding one.`;

const SUB_HEAD = "Pinned: what the user taught the team you work for, its standing instructions; follow them. Each line is id|pin (#the message it came from), with until on a temporary one.";

const ALL = "Pinned for the whole team:";
const YOU = "Pinned for you:";

function today(now = new Date()): string {
  return now.toLocaleDateString("sv-SE");
}

export function read(): Pin[] {
  try {
    const all = JSON.parse(fs.readFileSync(FILE, "utf8") || "[]") as unknown;
    return Array.isArray(all) ? (all as Pin[]).map((pin) => ({ ...pin, mons: pin.mons ?? null })) : [];
  } catch {
    return [];
  }
}

function sees(pin: Pin, mon: string): boolean {
  return pin.mons === null || pin.mons.includes(mon);
}

function name(id: string): string {
  return Team.get(id)?.name ?? id;
}

// where a pin's news goes: the active agents it holds for, or the first
// agent for a shared one or one whose agents are all archived
export function homes(pin: Pin): string[] {
  const active = Team.active().map((a) => a.id);
  const own = (pin.mons ?? []).filter((id) => active.includes(id));
  return own.length === 0 ? [Team.first().id] : own;
}

function scope(mons: string[] | null): string {
  return mons === null ? "the whole team" : mons.map(name).join(", ");
}

function write(pins: Pin[]): void {
  write_whole(FILE, JSON.stringify(pins, null, 1) + "\n");
}

export function line(pin: Pin): string {
  return pin.id + "|" + pin.text + (pin.from === null ? "" : " (#" + pin.from + ")") + (pin.until === null ? "" : " until " + pin.until);
}

// the block every turn of mon's gets after the chat (boss: the agent's
// own, else one of its subagents' or sessions'): no used dates in it, so
// marking a pin used leaves the prompt's cache alone
export function block(mon: string, boss: boolean): Block {
  const pins = read().filter((pin) => sees(pin, mon));
  if (!boss) {
    return { text: pins.length === 0 ? "" : SUB_HEAD + "\n" + pins.map(line).join("\n") + "\n\n", mark: false };
  }
  const lines = (group: Pin[], also: (pin: Pin) => string) => (group.length === 0 ? "(None yet.)" : group.map((pin) => line(pin) + also(pin)).join("\n"));
  const others = (pin: Pin) => (pin.mons ?? []).filter((id) => id !== mon);
  const shared = lines(pins.filter((pin) => pin.mons === null), () => "");
  const own = lines(pins.filter((pin) => pin.mons !== null), (pin) => (others(pin).length === 0 ? "" : " (also for " + scope(others(pin)) + ")"));
  return { text: [HEAD, ALL, shared, YOU, own].join("\n") + "\n\n", mark: false };
}

// the pins whose time is up: a temporary one past its until, a lasting
// one unused STALE days. Takes them out, and answers them with why
export function sweep(day = today()): { pin: Pin; why: string }[] {
  const pins = read();
  const stale = new Date(Date.parse(day) - STALE * 864e5).toISOString().slice(0, 10);
  const gone = pins.flatMap((pin) => {
    if (pin.until !== null && pin.until < day) {
      return [{ pin, why: "expired " + pin.until }];
    }
    if (pin.until === null && pin.used < stale) {
      return [{ pin, why: "unused " + STALE + "d" }];
    }
    return [];
  });
  if (gone.length > 0) {
    write(pins.filter((pin) => !gone.some((g) => g.pin === pin)));
  }
  return gone;
}

// an agent deleted: it leaves its pins, and the pins only it had go
export function drop(mon: string): void {
  const pins = read().map((pin) => ({ ...pin, mons: pin.mons?.filter((id) => id !== mon) ?? null }));
  write(pins.filter((pin) => pin.mons === null || pin.mons.length > 0));
}

export function unpin(id: number): Pin | null {
  const pins = read();
  const pin = pins.find((p) => p.id === id) ?? null;
  if (pin !== null) {
    write(pins.filter((p) => p !== pin));
  }
  return pin;
}

function ids(args: Record<string, unknown>): number[] {
  const all = get(args, "ids");
  return Array.isArray(all) ? all.map(Number).filter(Number.isInteger) : [];
}

function fields(args: Record<string, unknown>): Pick<Pin, "text" | "from" | "until"> | string {
  const text = text_of(args.text, "").replace(/\s+/g, " ").trim();
  const from = args.from === undefined || args.from === null ? null : Number(args.from);
  const until = args.until === undefined || args.until === null || args.until === "" ? null : text_of(args.until, "");
  if (text === "") {
    return "A pin needs its text.";
  }
  if (Buffer.byteLength(text) > LONGEST) {
    return "A pin is one line of at most " + LONGEST + " bytes: shorten it.";
  }
  if (from !== null && !Number.isInteger(from)) {
    return "from is the id of the message the pin came from.";
  }
  if (until !== null && (!DAY.test(until) || Number.isNaN(Date.parse(until)))) {
    return "until is a date, YYYY-MM-DD.";
  }
  return { text, from, until };
}

// for: "all" (null), or the agents named, "me" the caller; by default
// the caller alone
function mons(want: unknown, mon: string): string[] | null | string {
  const names = (want === undefined || want === null ? ["me"] : Array.isArray(want) ? want : [want]).map((n) => text_of(n, "").trim());
  if (names.length === 1 && names[0].toLowerCase() === "all") {
    return null;
  }
  const out: string[] = [];
  for (const n of names) {
    const them = Team.by_name(n);
    const id = n.toLowerCase() === "me" ? mon : them?.archived === 0 ? them.id : null;
    if (id === null) {
      return n.toLowerCase() === "all" ? "for is \"all\" alone, or agents' names." : "No agent " + n + " in the team.";
    }
    out.push(...(out.includes(id) ? [] : [id]));
  }
  return out.length === 0 ? "for names at least one agent, or \"all\"." : out;
}

// why a pin can't join the group of mons (null: the whole team's): one
// of them is full
function full(pins: Pin[], mons: string[] | null): string | null {
  if (mons === null) {
    return pins.filter((p) => p.mons === null).length >= CAP ? "There are " + CAP + " pins for the whole team, the most kept: propose merges or drops to the user first." : null;
  }
  const at = mons.find((id) => pins.filter((p) => p.mons?.includes(id) === true).length >= CAP);
  return at === undefined ? null : name(at) + " has " + CAP + " pins of its own, the most kept: propose merges or drops to the user first.";
}

// the pin tool of mon, the agent calling it: it sees and changes only the
// pins shared or held for it
export function tool(args: Record<string, unknown>, mon: string, day = today()): Out {
  const all = read();
  const pins = all.filter((pin) => sees(pin, mon));
  const action = text_of(args.action, "");
  switch (action) {
    case "add": {
      const f = fields(args);
      const to = mons(args.for, mon);
      if (typeof f === "string" || typeof to === "string") {
        return { text: typeof f === "string" ? f : String(to), fail: true };
      }
      const why = full(all, to);
      if (why !== null) {
        return { text: why, fail: true };
      }
      const pin: Pin = { id: Math.max(0, ...all.map((p) => p.id)) + 1, ...f, mons: to, made: day, used: day };
      write([...all, pin]);
      return { text: "Pinned for " + scope(to) + ": " + line(pin), fail: false };
    }
    case "replace": {
      const id = Number(args.id);
      const old = pins.find((p) => p.id === id);
      if (old === undefined) {
        return { text: "No pin " + String(args.id) + ".", fail: true };
      }
      const f = fields({ text: old.text, from: old.from, until: old.until, ...args });
      const to = args.for === undefined ? old.mons : mons(args.for, mon);
      if (typeof f === "string" || typeof to === "string") {
        return { text: typeof f === "string" ? f : String(to), fail: true };
      }
      const why = full(all.filter((p) => p !== old), to);
      if (why !== null) {
        return { text: why, fail: true };
      }
      const pin: Pin = { ...old, ...f, mons: to, used: day };
      write(all.map((p) => (p === old ? pin : p)));
      return { text: "Replaced " + line(old) + "\nwith " + line(pin) + ", for " + scope(to), fail: false };
    }
    case "unpin": {
      const want = ids(args);
      const gone = pins.filter((p) => want.includes(p.id));
      if (gone.length === 0) {
        return { text: "No pin " + want.join(", ") + ".", fail: true };
      }
      write(all.filter((p) => !gone.includes(p)));
      return { text: "Unpinned " + gone.map(line).join("\n"), fail: false };
    }
    case "used": {
      const want = ids(args);
      const hit = pins.filter((p) => want.includes(p.id));
      write(all.map((p) => (hit.includes(p) ? { ...p, used: day } : p)));
      return { text: hit.length === 0 ? "No pin " + want.join(", ") + "." : "Marked used: " + hit.map((p) => p.id).join(", ") + ".", fail: hit.length === 0 };
    }
    default: {
      return { text: "action is add, replace, unpin or used.", fail: true };
    }
  }
}
