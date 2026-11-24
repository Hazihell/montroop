// Gate
// ====
// Risky tool calls wait for the owner's yes. Every tool call of every agent,
// subagent and vendor goes through Ki's MCP endpoint (Tools.fetch), so the
// gate stands there: a call whose tool name and arguments match a rule
// (Settings, config.json's `ask`) waits, shown in its agent's chat as a
// card and pushed to the owner's phones, until a browser approves or
// denies it. A call waiting is kept in Ki's folder (asks.json), so it is
// still asked after a restart: the same caller's next same call waits on
// it again, and one answered while no call waits reaches it as a message.

import * as fs from "node:fs";
import { call_parse, call_text } from "./Call.ts";
import { write_whole } from "./Write.ts";
import { rec } from "./Json.ts";

// a waiting call as the chat shows it: agent is the chat it shows in, who
// the subagent that called ("" for the agent itself), input its arguments
// as JSON, whole, so a card shows all that its yes runs
export type Asked = { id: string; agent: string; who: string; tool: string; input: string; what: string; at: number };

type Said = { ok: boolean; note: string };

type Held = Asked & { key: string; ok: boolean | null; note: string };

export type Gate = { file: string; held: Held[]; waits: Map<string, (said: Said | null) => void>; change: () => void };

type Decided = { held: Asked; waited: boolean };

// how long a yes given while no call waited holds for the agent's next call
const KEPT = 24 * 60 * 60 * 1000;

export namespace Gate {

  function key(x: unknown): string {
    const sorted = (y: unknown): unknown => (Array.isArray(y) ? y.map(sorted) : rec(y) ? Object.fromEntries(Object.keys(y).sort().map((k) => [k, sorted(y[k])])) : y);
    return JSON.stringify(sorted(x));
  }

  export function open(file: string, change: () => void): Gate {
    let held: Held[] = [];
    try {
      const kept: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      held = (Array.isArray(kept) ? kept : []).filter((h): h is Held => rec(h) && typeof h.id === "string" && typeof h.key === "string" && typeof h.agent === "string");
    } catch {}
    const gate = { file, held, waits: new Map(), change };
    prune(gate, Date.now());
    return gate;
  }

  function save(gate: Gate): void {
    write_whole(gate.file, gate.held.length === 0 ? null : JSON.stringify(gate.held) + "\n");
  }

  function prune(gate: Gate, now: number): void {
    const left = gate.held.filter((h) => h.ok !== true || now - h.at < KEPT);
    if (left.length !== gate.held.length) {
      gate.held = left;
      save(gate);
    }
  }

  function drop(gate: Gate, h: Held): void {
    gate.held = gate.held.filter((x) => x !== h);
    save(gate);
  }

  // the owner's answer to a call a rule named; null: the call was stopped
  // first. asked runs for a new card, not when a call re-attaches to one
  export function wait(gate: Gate, agent: string, who: string, tool: string, args: Record<string, unknown>, what: string, signal: AbortSignal, asked: (a: Asked) => void): Promise<Said | null> {
    const now = Date.now();
    prune(gate, now);
    const keyed = key(args);
    const same = (h: Held) => h.agent === agent && h.who === who && h.tool === tool && h.key === keyed;
    const yes = gate.held.find((h) => same(h) && h.ok === true);
    if (yes !== undefined) {
      drop(gate, yes);
      return Promise.resolve({ ok: true, note: yes.note });
    }
    let h = gate.held.find((x) => same(x) && x.ok === null && !gate.waits.has(x.id));
    if (h === undefined) {
      h = { id: crypto.randomUUID().slice(0, 8), agent, who, tool, input: JSON.stringify(args), what, at: now, key: keyed, ok: null, note: "" };
      gate.held = [...gate.held, h];
      save(gate);
      asked(h);
    }
    const held = h;
    gate.change();
    return new Promise((ok) => {
      const done = (said: Said | null) => {
        gate.waits.delete(held.id);
        signal.removeEventListener("abort", off);
        ok(said);
      };
      const off = () => {
        if (gate.waits.get(held.id) === done) {
          drop(gate, held);
          done(null);
          gate.change();
        }
      };
      gate.waits.set(held.id, done);
      if (signal.aborted) {
        off();
      } else {
        signal.addEventListener("abort", off, { once: true });
      }
    });
  }

  export function decide(gate: Gate, id: string, said: Said): Decided | null {
    const h = gate.held.find((x) => x.id === id && x.ok === null);
    if (h === undefined) {
      return null;
    }
    const wait = gate.waits.get(id);
    if (wait !== undefined || !said.ok) {
      drop(gate, h);
    } else {
      Object.assign(h, { ok: true, note: said.note, at: Date.now() });
      save(gate);
    }
    wait?.(said);
    gate.change();
    return { held: card(h), waited: wait !== undefined };
  }

  // the calls waiting in one agent's chat
  export function shown(gate: Gate, agent: string): Asked[] {
    return gate.held.filter((h) => h.ok === null && h.agent === agent).map(card);
  }

  function card({ id, agent, who, tool, input, what, at }: Held): Asked {
    return { id, agent, who, tool, input, what, at };
  }

  export function line(a: Asked): string {
    return call_text(call_parse(a.tool + " " + a.input)).replace(/\s+/g, " ").trim();
  }

}
