// Wire
// ====
// A holder (Hold) and the server talk over a unix socket,
// one JSON message a line. The holder numbers what it tells (seq) and keeps
// it until the server acks it, telling it again after each hello; the
// newest hello owns the holder, the connection it replaces is closed.
// Either side may run an older program than the other (a holder outlives
// the server that started it): a message or event a side doesn't know is
// ignored (an event still acked), and a message's fields are only ever
// added, never renamed or removed. v: the sender's VERSION, raised with
// each change, so a side can tell what the other knows (2: the holder's
// start names its driver; 3: a start may give a whole job to the driver
// its provider picks, a run tells a usage limit it waits out, the server
// runs Montroop's tools for holders, and the devices' scratch folders the
// rules read; 4: a start may run a subagent, whose question tool is ask,
// and the server pokes holders when the usage limits were reset).

import type * as net from "node:net";
import type { Out } from "./Agent.ts";
import { get, list, rec, text_of } from "./Json.ts";
import type { Spec } from "./Machine.ts";
import type { Rule } from "./Rules.ts";

// a call a rule named, parked until the owner answers it (id: the
// provider's tool use id, which the answer names; tool and input: the
// provider's own)
export type Ask = { id: string; tool: string; input: Record<string, unknown>; what: string };

// a call of one of Montroop's tools, which the server runs, once however
// often it's told (id: the provider's tool use id)
export type Calling = { id: string; tool: string; input: Record<string, unknown> };

// one of Montroop's tools as a run is offered it; device: the device whose
// scratch folder the rules read its arguments with, null for the one they
// name, if any
export type Kit = Spec & { device: string | null };

// Montroop's one MCP server in Claude Code, the server's (ClaudeSub) and a
// holder's (Code), which names each of its tools for the model
// mcp__montroop__<name> (#190)
export const MCP = "montroop";
export const HELD = "mcp__" + MCP + "__";

// each open device's scratch folder, by its name
export type Scratch = Record<string, string>;

// a question the run asked its agent (ask_owner), its call waiting
// for the answer
export type Asking = { id: string; text: string };

// what a run did. began: the provider's session id, which resumes it;
// heard: a message the server sent went in; replied: a question got its
// answer; report: the run's result; turn: the model finished a turn;
// limit: a usage limit stopped it, till until (ms since 1970), when it
// goes on by itself; used: the tokens of its latest request; end: the
// holder's run is over and it exits
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
  | { k: "limit"; until: number }
  | { k: "used"; tokens: number }
  | { k: "end"; ok: boolean; text: string };

export type Told = { seq: number; at: number; ev: Ev };

export const VERSION = 4;

// the first version whose server runs Montroop's tools for holders
export const TOOLS = 3;

const CLIP = 2000;

// rules: the ask rules or the scratch folders changed; say: a message for
// the run (answer: the answer to its first question waiting, if one still
// waits); result: what a call did, kept by the server till the holder took
// it; poke: the owner says the usage limits were reset, so a wait for one
// asks again
export type ToHold =
  | { $: "hello"; v: number; ack: number; rules: Rule[]; scratch: Scratch }
  | { $: "ack"; seq: number }
  | { $: "rules"; rules: Rule[]; scratch: Scratch }
  | { $: "answer"; id: string; ok: boolean; note: string }
  | { $: "say"; id: string; text: string; answer: boolean }
  | { $: "result"; id: string; out: Out }
  | { $: "poke" };

// call: told when made and again after each welcome till its result comes;
// took: a result is in, the server forgets it
type FromHold =
  | { $: "welcome"; v: number; seq: number; asks: Ask[]; questions: Asking[] }
  | ({ $: "ev" } & Told)
  | ({ $: "call" } & Calling)
  | { $: "took"; id: string };

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

  // a text told cut to what a message carries
  export function clip(text: string): string {
    return text.length > CLIP ? text.slice(0, CLIP) + "…" : text;
  }

  // what a tool did, as a message carries it (an image's type and data
  // only, the rest dropped)
  export function out(x: unknown): Out {
    const imgs = list(get(x, "imgs")).flatMap((img) => {
      const [type, data] = [get(img, "type"), get(img, "data")];
      return typeof type === "string" && typeof data === "string" ? [{ type, data }] : [];
    });
    return { text: text_of(get(x, "text")), fail: get(x, "fail") === true, ...(get(x, "imgs") === undefined ? {} : { imgs }) };
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
