// Driver
// ======
// What runs a model's work in a holder (Hold), whichever provider it is: a
// driver is given the job and the holder's Io, and runs until the work is
// done. The holder keeps the rest: the socket to the server, what was told
// and not acked, the log, the calls parked for the owner, the questions
// waiting for an answer.

import type { Ev } from "./Wire.ts";

// a run's job: the holder's folder, the folder the model's own tools work
// in, its account's sign-in folder, its model ("": the account's default),
// its own part of the system prompt, the provider's session it resumes
// ("": a new one)
export type Job = { dir: string; cwd: string; account: string; model: string; own: string; resume: string };

// a tool call as the rules know it (tool and args: shell and its command),
// and as the provider made it, which the owner's card shows
export type Call = { id: string; tool: string; args: Record<string, unknown>; native: string; input: Record<string, unknown> };

// ok: it may run; note: what the model is told with it ("": nothing)
export type Gated = { ok: boolean; note: string };

// the messages for the model, each once: pending, whether one waits to be
// taken; next, the next one, waiting for it (null: closed, no more come);
// close, the run takes no more, so a message sent after goes to the next
export type Inbox = { pending: () => boolean; next: () => Promise<string | null>; close: () => void };

// emit: an event told to the server and logged; gate: before a tool runs,
// parked if a rule asks the owner first (stop: dropped); ask: a question to
// the agent that started the run, waiting for its answer
export type Io = {
  emit  : (ev: Ev) => void;
  inbox : Inbox;
  gate  : (call: Call, stop: AbortSignal) => Promise<Gated>;
  ask   : (text: string) => Promise<string>;
};

export type End = { ok: boolean; text: string };

export type Driver = (job: Job, io: Io) => Promise<End>;
