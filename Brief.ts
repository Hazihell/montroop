import type { Block } from "./AskAI.ts";
import * as Pins from "./Pins.ts";
import * as Prompts from "./Prompts.ts";
import { Tools } from "./Tools.ts";

type Chat = { tools: Tools; id: string; dir: string };

// an agent's turn, a subagent's call, an agent's goal check; who: whose
// work counts as at work; leader: leader mode's block, if on
type For =
  | { kind: "agent"; chat: Chat; who: string; leader: string | null }
  | { kind: "sub"; chat: Chat; who: string }
  | { kind: "goal"; leader: string | null };

// what a worker is told beside its view, in one place for every kind
export namespace Brief {
  // after the view, before the call's own last block, in an order the
  // prompt cache keys on: pins, devices, skills, at work, leader
  export function blocks(f: For): Block[] {
    const leader = f.kind === "sub" || f.leader === null ? [] : [{ text: f.leader, mark: false }];
    if (f.kind === "goal") {
      return leader;
    }
    const { tools, id, dir } = f.chat;
    return [Pins.block(f.kind === "agent"), Tools.devices(tools, id, dir), Tools.skills(tools), Tools.at_work(tools, f.who), ...leader];
  }

  // a subagent's system prompt, the same for its agent's subagents so they
  // share a cache entry, and its first message's blocks before its task.
  // With a repo the view ends the system prompt: a worktree's instructions,
  // named by its path, come first in the first message
  export function subagent(agent: { id: string; name: string }, view: Block[], repo: boolean, own: string, tools: Tools | null): { system: string; first: Block[] } {
    const pins = Pins.block(false).text.trim();
    const shared = [Prompts.prompt("subagent", { agent: agent.name, id: agent.id }), pins, ...(repo ? view.map((b) => b.text.trim()) : [])].filter((t) => t !== "").join("\n\n");
    const dir = tools === null ? undefined : Tools.seat(tools, agent.id)?.mem.dir;
    const kit = tools === null || dir === undefined ? [] : [Tools.devices(tools, agent.id, dir), Tools.skills(tools)];
    return { system: shared, first: [...(repo ? [] : view), ...kit, { text: own + "\n\n", mark: false }] };
  }

  // a work session's addition to its system prompt, for its agent, with
  // its browser's media folder if it has one, and the devices and skills
  // its agent's tools reach now
  export function append(agent: { id: string; name: string }, media: string | null, brief: string, tools: Tools | null): string {
    const own = Prompts.prompt("session", { agent: agent.name, id: agent.id }) + (media === null ? "" : "\n" + Prompts.prompt("session-browser", { media }));
    const dir = tools === null ? undefined : Tools.seat(tools, agent.id)?.mem.dir;
    const kit = tools === null || dir === undefined ? [] : [Tools.devices(tools, agent.id, dir).text, Tools.skills(tools).text];
    return [own, brief.trim(), ...kit.map((t) => t.trim()), Pins.block(false).text.trim()].filter((t) => t !== "").join("\n\n");
  }
}
