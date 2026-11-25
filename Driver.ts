// Driver
// ======
// What runs a model's work in a holder (Hold), whichever provider it is: a
// driver is given the job and the holder's Io, and runs until the work is
// done. The holder keeps the rest: the socket to the server, what was told
// and not acked, the log, the calls parked for the owner, the questions
// waiting for an answer. Providers picks a job's driver.

import type { Out } from "./Agent.ts";
import type { Block, Img } from "./AskAI.ts";
import type { Spec } from "./Machine.ts";
import type { Ev } from "./Wire.ts";

// the credential a run uses: a plan's sign-in folder, or the server's API
// key for its provider (Config's keys); id: the account's name
// (Config.claude_accounts)
type Account = { provider: string; id: string } & ({ kind: "plan"; dir: string } | { kind: "key"; dir: null });

// a run's job: the holder's folder; its account, model (an API id; "":
// the account's default, Claude Code's only), effort and speed ("": the
// model's default); its system prompt, the part every worker of its kind
// shares (it ends a cache entry) and its own; its context, given whole
// (blocks: a main agent's turn, its view) or kept by the provider
// (native: the session it resumes, "" for a new one, and the blocks a new
// one's first message starts with, before the holder's first message,
// and the brief it's told again after each compaction, "" for none);
// the folder the provider's own tools work in (null: none); write: false
// denies its edit tools; Kunumy's tools, each run through io.call; the
// web searches a request may make
export type Job = {
  dir     : string;
  account : Account;
  model   : string;
  effort  : string;
  speed   : string;
  system  : string;
  own     : string;
  context : { kind: "given"; blocks: Block[]; imgs: Img[] } | { kind: "native"; resume: string; first: Block[]; brief: string };
  cwd     : string | null;
  write   : boolean;
  tools   : Spec[];
  web     : number;
};

// a tool call as the rules know it (tool and args: shell and its command),
// and as the provider made it, which the owner's card shows
export type Call = { id: string; tool: string; args: Record<string, unknown>; native: string; input: Record<string, unknown> };

// ok: it may run; note: what the model is told with it ("": nothing)
export type Gated = { ok: boolean; note: string };

// the messages for the model, each once: pending, whether one waits to be
// taken; next, the next one, waiting for it (null: closed, no more come);
// close, the run takes no more, so a message sent after goes to the next
export type Inbox = { pending: () => boolean; next: () => Promise<string | null>; close: () => void };

// emit: an event told to the server and logged; parks: whether a rule has
// the owner answer the call first; gate: before a tool of the provider's
// own runs, parked if a rule says so (stop: dropped); call: one of
// Kunumy's tools (Job.tools), run once, gated where a rule says so
export type Io = {
  emit  : (ev: Ev) => void;
  inbox : Inbox;
  parks : (call: Call) => boolean;
  gate  : (call: Call, stop: AbortSignal) => Promise<Gated>;
  call  : (call: Call) => Promise<Out>;
};

export type End = { ok: boolean; text: string };

export type Driver = (job: Job, io: Io) => Promise<End>;
