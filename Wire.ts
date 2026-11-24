// Wire
// ====
// A work session's holder (Hold) and the server talk over a unix socket,
// one JSON message a line. The holder numbers what it tells (seq) and keeps
// it until the server acks it, telling it again after each hello; the
// newest hello owns the session, the connection it replaces is closed.
// Either side may run an older program than the other (a holder outlives
// the server that started it): a message or event a side doesn't know is
// ignored (an event still acked), and a message's fields are only ever
// added, never renamed or removed. v: the sender's VERSION, raised with
// each change, so a side can tell what the other knows.

import type * as net from "node:net";
import { rec } from "./Json.ts";
import type { Rule } from "./Rules.ts";

// a call a rule named, parked until the owner answers it (id: Claude
// Code's tool use id, which the answer names)
export type Ask = { id: string; tool: string; input: Record<string, unknown>; what: string };

// a question the session asked its agent (ask_owner), its call waiting
// for the answer
export type Asking = { id: string; text: string };

// what a session did. began: Claude Code's session id, which resumes it;
// heard: a message the server sent went in; replied: a question got its
// answer; report: the session's result; turn: Claude Code finished a turn;
// end: the holder's run is over and it exits
export type Ev =
  | { k: "began"; sdk: string }
  | { k: "text"; text: string }
  | { k: "tool"; id: string; name: string; input: string }
  | { k: "result"; id: string; text: string; error: boolean }
  | ({ k: "ask" } & Ask)
  | { k: "answered"; id: string; ok: boolean }
  | { k: "dropped"; id: string }
  | { k: "heard"; id: string }
  | ({ k: "question" } & Asking)
  | { k: "replied"; id: string }
  | { k: "report"; text: string }
  | { k: "compacted" }
  | { k: "turn"; ok: boolean; text: string }
  | { k: "end"; ok: boolean; text: string };

export type Told = { seq: number; at: number; ev: Ev };

export const VERSION = 1;

// rules: the ask rules changed; say: a message for the session (answer:
// the answer to its first question waiting, if one still waits)
type ToHold =
  | { $: "hello"; v: number; ack: number; rules: Rule[] }
  | { $: "ack"; seq: number }
  | { $: "rules"; rules: Rule[] }
  | { $: "answer"; id: string; ok: boolean; note: string }
  | { $: "say"; id: string; text: string; answer: boolean };

type FromHold =
  | { $: "welcome"; v: number; seq: number; asks: Ask[]; questions: Asking[] }
  | ({ $: "ev" } & Told);

export type Outbox = { seq: number; kept: Told[] };

export namespace Wire {

  // a message sent on a connection still open (none: dropped; the outbox
  // or the server's record has it for the next one)
  export function send(sock: net.Socket | null | undefined, msg: ToHold | FromHold): void {
    if (sock !== null && sock !== undefined && !sock.destroyed) {
      sock.write(JSON.stringify(msg) + "\n");
    }
  }

  // what comes in, cut into messages (a line that is no JSON object is
  // dropped); a message can arrive in pieces, or several in one
  export function lines(on: (msg: Record<string, unknown>) => void): (chunk: string) => void {
    let rest = "";
    return (chunk) => {
      const parts = (rest + chunk).split("\n");
      rest = parts.pop() ?? "";
      for (const part of parts) {
        let msg: unknown = null;
        try {
          msg = JSON.parse(part);
        } catch {}
        if (rec(msg)) {
          on(msg);
        }
      }
    };
  }

  export function outbox(seq: number): Outbox {
    return { seq, kept: [] };
  }

  export function push(box: Outbox, ev: Ev, at: number): Told {
    box.seq += 1;
    const told = { seq: box.seq, at, ev };
    box.kept.push(told);
    return told;
  }

  export function ack(box: Outbox, seq: number): void {
    box.kept = box.kept.filter((t) => t.seq > seq);
  }

}
