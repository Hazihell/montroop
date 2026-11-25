// Providers
// =========
// Which driver runs a job: its provider's, for the kind of account it
// runs on and the kind of context it has. A plan runs on its provider's
// harness (Claude Code, in either context) or its plan's API (ChatGPT's),
// an API key on the API, with Montroop's own loop (Loop) over the vendor's
// wire. A model or effort the provider doesn't offer is refused before
// any call; Claude Code takes names of its own for its models too (opus),
// as its default.

import type { Vendor } from "./AskAI.ts";
import { Anthropic } from "./Anthropic.ts";
import { ChatGPT } from "./ChatGPT.ts";
import { Code } from "./Code.ts";
import type { Driver, Job } from "./Driver.ts";
import { Loop } from "./Loop.ts";
import { OpenAI } from "./OpenAI.ts";
import { LABELS, Pick } from "./Pick.ts";

type Kind = Job["account"]["kind"];

// each provider's accounts, as the vendors the rest of Montroop names, and
// the driver for a job on each
const PROVIDERS: Record<string, Record<Kind, { vendor: Vendor; driver: (job: Job) => Driver }>> = {
  claude: {
    plan : { vendor: "claude-sub", driver: (job) => (job.context.kind === "given" ? Code.given : Code.native) },
    key  : { vendor: "claude-api", driver: () => Loop.over(Anthropic.wire, "claude-api") },
  },
  openai: {
    plan : { vendor: "openai-sub", driver: () => Loop.over(ChatGPT.wire, "openai-sub") },
    key  : { vendor: "openai-api", driver: () => Loop.over(OpenAI.wire, "openai-api") },
  },
};

export namespace Providers {

  // the driver for a job, or why there's none: no such provider, or a
  // model or effort it doesn't offer (effort "": the model's default)
  export function driver(job: Job): Driver | string {
    const provider = job.account.provider;
    if (!Object.hasOwn(PROVIDERS, provider)) {
      return "No provider " + provider + "; one of " + Object.keys(PROVIDERS).join(", ") + ".";
    }
    const { vendor, driver } = PROVIDERS[provider][job.account.kind];
    const model = Pick.models([vendor], LABELS).find(([, m]) => m.id === job.model)?.[1];
    if (model === undefined && vendor !== "claude-sub") {
      return "No model " + job.model + " on " + vendor + ".";
    }
    if (model !== undefined && job.effort !== "" && !Pick.offers(model, job.effort)) {
      return Pick.no_effort(model, job.effort) + ".";
    }
    return driver(job);
  }

}
