import type { Block } from "./AskAI.ts";
import * as Pins from "./Pins.ts";
import * as Prompts from "./Prompts.ts";
import { Tools } from "./Tools.ts";

type Chat = { tools: Tools; id: string; dir: string };

// an agent's turn, an agent's goal check; leader: leader mode's block, if
// on
type For =
  | { kind: "agent"; chat: Chat; leader: string | null }
  | { kind: "goal"; leader: string | null };

// what a worker is told beside its view, in one place for every kind
export namespace Brief {
  // after the view, before the call's own last block, in an order the
  // prompt cache keys on: pins, devices, skills, at work, leader
  export function blocks(f: For): Block[] {
    const leader = f.leader === null ? [] : [{ text: f.leader, mark: false }];
    if (f.kind === "goal") {
      return leader;
    }
    const { tools, id, dir } = f.chat;
    return [Pins.block(id, true), Tools.devices(tools, id, dir), Tools.skills(tools), Tools.at_work(tools, id), ...leader];
  }

  // a subagent's system prompt, the same for its agent's subagents so they
  // share a cache entry, and its first message's blocks before its task.
  // With a repo the view ends the system prompt: a worktree's instructions,
  // named by its path, come first in the first message
  export function subagent(agent: { id: string; name: string }, view: Block[], repo: boolean, own: string, tools: Tools | null): { system: string; first: Block[] } {
    const pins = Pins.block(agent.id, false).text.trim();
    const shared = [Prompts.prompt("subagent", { agent: agent.name, id: agent.id }), pins, ...(repo ? view.map((b) => b.text.trim()) : [])].filter((t) => t !== "").join("\n\n");
    const dir = tools === null ? undefined : Tools.seat(tools, agent.id)?.mem.dir;
    const kit = tools === null || dir === undefined ? [] : [Tools.devices(tools, agent.id, dir), Tools.skills(tools)];
    return { system: shared, first: [...(repo ? [] : view), ...kit, { text: own + "\n\n", mark: false }] };
  }
}
