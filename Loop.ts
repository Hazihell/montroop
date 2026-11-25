// Loop
// ====
// The driver over a vendor's API (a Wire, Agent): Kunumy runs the model's
// loop, each tool call it makes run through the holder (io.call) and its
// result sent in the next request, till a turn ends with none. Given, the
// first message is the job's blocks; native, the job's first blocks and
// the holder's first message, and the conversation is kept in a
// transcript in the holder's folder, which a later holder resumes by its
// id. The messages that come in go in before the next request, and those
// still waiting when a turn ends start another. A usage limit is waited
// out (Agent.step).

import * as fs from "node:fs";
import * as path from "node:path";
import { Agent, type Item, type Out, type Step, type Use, type Wire as Api } from "./Agent.ts";
import { AskAI, type Ask, type Vendor } from "./AskAI.ts";
import * as config from "./Config.ts";
import type { Driver, Io, Job } from "./Driver.ts";
import { err_why } from "./Err.ts";
import { rec } from "./Json.ts";
import { Limit } from "./Limit.ts";
import type { Spec } from "./Machine.ts";
import { Wire } from "./Wire.ts";

// a native conversation's blocks for the wires: its request's end marked,
// so each request caches all of it (Anthropic.body, OpenAI.body)
const GROWS = [{ text: "", mark: true }];

export namespace Loop {

  // the call the server's own path makes for the job (AskAI.ask): one
  // that waits out what it can
  export function asked(job: Job, vendor: Vendor): Ask {
    const c = job.context;
    return {
      vendor,
      model    : job.model,
      effort   : job.effort,
      speed    : job.speed,
      system   : job.system,
      own      : job.own,
      blocks   : c.kind === "given" ? c.blocks : GROWS,
      imgs     : c.kind === "given" ? c.imgs : [],
      searches : job.web,
      server   : "",
      patient  : true,
      account  : job.account.id,
    };
  }

  export function over<S, E>(wire: Api<S, E>, vendor: Vendor): Driver {
    return async (job, io) => {
      const ask = Loop.asked(job, vendor);
      const key = wire.auth ? "" : config.KEYS[wire.key];
      if (!key && !wire.auth) {
        return { ok: false, text: "no API key: set " + wire.key.toUpperCase() + "_API_KEY" };
      }
      const abort = new AbortController();
      const on = () => {};
      const run = { ask, on, abort, end: AskAI.end(""), limit: Limit.make(ask, on, abort.signal) };
      const c = job.context;
      const items: Item[] = [];
      let keep = (more: Item[]) => void items.push(...more);
      if (c.kind === "given") {
        keep([{ $: "User", parts: c.blocks.filter((b) => b.text !== ""), imgs: c.imgs }]);
      } else {
        const id = c.resume === "" ? crypto.randomUUID() : c.resume;
        const file = path.join(job.dir, "loop-" + id + ".jsonl");
        items.push(...(c.resume === "" ? [] : read(file)));
        keep = (more) => {
          items.push(...more);
          fs.appendFileSync(file, JSON.stringify(more) + "\n", { mode: 0o600 });
        };
        if (c.resume === "") {
          io.emit({ k: "began", sdk: id });
        }
        const text = await io.inbox.next();
        if (text === null) {
          return { ok: true, text: "" };
        }
        keep([{ $: "User", parts: [...(items.length === 0 ? c.first : []), { text, mark: false }].filter((b) => b.text !== ""), imgs: [] }]);
      }
      for (;;) {
        keep(await steered(io, items));
        const step = await Agent.step(wire, run, key, (max) => wire.body(ask, items, job.tools, max), items);
        told(io, step);
        if (step.stop === "down" || step.stop === "lost" || step.stop === "fail") {
          return { ok: false, text: step.refusal?.say ?? Agent.said(step.why) };
        }
        const turn: Item = { $: "Turn", out: step.out, open: step.open, container: step.container };
        if (step.stop === "again") {
          keep([turn]);
          continue;
        }
        const backs: Array<{ id: string; out: Out }> = [];
        for (const use of step.uses) {
          run.end.acted = true;
          const out = await called(io, job.tools, use);
          io.emit({ k: "result", id: use.id, text: Wire.clip(out.text), error: out.fail });
          backs.push({ id: use.id, out });
        }
        if (backs.length > 0) {
          keep([turn, { $: "Back", backs }]);
          continue;
        }
        keep([turn]);
        const text = step.entries.filter((e) => e.kind === "reply").map((e) => e.text).join("\n\n");
        io.emit({ k: "turn", ok: true, text });
        if (!io.inbox.pending()) {
          io.inbox.close();
          return { ok: true, text };
        }
      }
    };
  }

  // a transcript's items (a line a crash cut short left out)
  function read(file: string): Item[] {
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    return text.split("\n").flatMap((line) => {
      try {
        const more: unknown = JSON.parse(line);
        return Array.isArray(more) ? (more as Item[]) : [];
      } catch {
        return [];
      }
    });
  }

  // the messages that came in, as one, unless a server tool call is open:
  // only its results may follow it (Agent.steered)
  async function steered(io: Io, items: Item[]): Promise<Item[]> {
    const turn = items.findLast((item) => item.$ === "Turn");
    if (turn?.$ === "Turn" && turn.open === true) {
      return [];
    }
    const texts: string[] = [];
    while (io.inbox.pending()) {
      const text = await io.inbox.next();
      if (text !== null && text !== "") {
        texts.push(text);
      }
    }
    return texts.length === 0 ? [] : [{ $: "User", parts: texts.map((text) => ({ text, mark: false })), imgs: [] }];
  }

  // what a step said and called, in order: a tool call of the model's as
  // it made it, a server tool's (a web search) with its result
  function told(io: Io, step: Step): void {
    const uses = new Map(step.uses.map((u) => [u.id, u]));
    for (const e of Agent.paired(step.entries)) {
      const use = e.of === undefined ? undefined : uses.get(e.of);
      if (e.kind === "reply") {
        io.emit({ k: "text", text: e.text });
      } else if (e.kind === "tool" && use !== undefined) {
        io.emit({ k: "tool", id: use.id, name: use.name, input: Wire.clip(JSON.stringify(use.input)) });
      } else if (e.kind === "tool") {
        const [name, ...input] = e.text.split(" ");
        io.emit({ k: "tool", id: e.of ?? "", name, input: Wire.clip(input.join(" ")) });
      } else if (e.kind === "echo") {
        io.emit({ k: "result", id: e.of ?? "", text: Wire.clip(e.text), error: false });
      }
    }
  }

  // a tool call run by the holder (Agent.use)
  async function called(io: Io, tools: Spec[], use: Use): Promise<Out> {
    if (!tools.some((t) => t.name === use.name)) {
      return { text: "No tool " + use.name + ".", fail: true };
    }
    if (!rec(use.input)) {
      return { text: "The input is not a JSON object.", fail: true };
    }
    try {
      const out = await io.call({ id: use.id, tool: use.name, args: use.input, native: use.name, input: use.input });
      return { ...out, text: out.text || "(no output)" };
    } catch (err) {
      return { text: err_why(err), fail: true };
    }
  }

}
