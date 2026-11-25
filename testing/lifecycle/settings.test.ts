import { afterAll, expect, test } from "bun:test";
import { chat, down, fake, tag, Troop, until } from "../rig.ts";

afterAll(down);

type Shown = { name: string; about: string; prompt: string; own: boolean; leader: boolean; lines: number; manage: boolean; subagents: boolean };

const SETUP = "Your Lasting submons setting is on now";

// the agent calls its settings tool with args, as the fake model is told to,
// and ends its turn: the call's result as its chat shows it ("error: …" for
// a call that failed)
async function settings(k: Troop, args: Record<string, unknown>): Promise<string> {
  const t = tag();
  await fake.next(t + ": settings", { what: "tool", calls: [["settings", args]] });
  await k.tell(t + ": settings");
  const call = await until("its call and its turn's end", async () => {
    const all = await chat(k);
    const after = all.slice(all.findIndex((m) => m.text === t + ": settings"));
    const at = after.findIndex((m) => m.kind === "tool" && m.text.includes("\n"));
    return at > 0 && after.slice(at).some((m) => m.kind === "reply") ? after[at].text : null;
  });
  return call.slice(call.indexOf("\n") + 1);
}

// the agent's settings as the app reads them (what it has unread aside)
async function shown(k: Troop): Promise<Shown> {
  const all = (await k.api("GET", "/api/agents")).json as { agents: Array<Shown & { id: string; unread: number }> };
  const { unread: _, ...a } = all.agents.find((x) => x.id === k.agent) as Shown & { unread: number };
  return a;
}

test.concurrent("a mon sets its own settings, the answer telling each change before and after, and shows them as the app reads them back", async () => {
  const k = await Troop.up();
  const t = tag();

  const set = await settings(k, { action: "set", name: "Nova", about: "Watches the " + t + " herons.", leader: true, lines: 5, effort: "medium" });
  expect(set).toStartWith([
    "Changed your settings:",
    "name: Montroop → Nova",
    "about: The user's assistant and first point of contact. → Watches the " + t + " herons.",
    "effort: low → medium",
    "leader: off → on",
    "lines: 6 → 5",
    "prompt:",
  ].join("\n"));
  expect(set).toEndWith("\n-You are Montroop.\n+You are Nova.\nThey apply from your next turn.");
  expect(await shown(k)).toMatchObject({ name: "Nova", about: "Watches the " + t + " herons.", prompt: "You are Nova.", own: false, leader: true, lines: 5 });

  const show = await settings(k, { action: "show" });
  expect(show).toStartWith("name: Nova\nabout: Watches the " + t + " herons.\npicture: logo (a drawn look av:shape.eyes.glasses.extra.body.detail, shape: scallop, ");
  expect(show).toContain("\nclaude: personal (the user's to change, in the app)\nmodel: openai-api:gpt-6-luna (offered: ");
  expect(show).toContain("\neffort: medium (gpt-6-luna's: none, low, medium, high, xhigh, max)\nleader: on\nlines: 5 (1 to 30)\nsubagents: off\nmanage: on (the user's to change, in the app)\nWorktree setups: none.\nprompt (the default):\nYou are Nova.");
});

test.concurrent("a mon's change of what only the owner changes, or to a model not offered, or Leader mode as anything but on or off, is refused and saves nothing", async () => {
  const k = await Troop.up();
  const before = await shown(k);

  expect(await settings(k, { action: "set", manage: false, about: "Changed." })).toStartWith("error: Manage mons");
  expect(await settings(k, { action: "set", model: "gpt-99", about: "Changed." })).toStartWith("error: No model gpt-99; one of: ");
  expect(await settings(k, { action: "set", leader: "true", about: "Changed." })).toBe("error: leader is true or false.");
  expect(await shown(k)).toEqual(before);
  expect(await settings(k, { action: "show" })).toContain("\nmodel: openai-api:gpt-6-luna (offered: ");
});

test.concurrent("the settings tool is offered to a mon, not to its subagents", async () => {
  const k = await Troop.up();
  const t = tag();
  await k.tell(t + ": hello");
  const [s] = await k.subagents({ task: t + ": sub", name: "sb", memory: false });
  await s.status("done");

  const offered = async (text: string) => (await until("a request with " + text, async () => (await fake.seen(text))[0])).tools.map((n) => n.replace(/^mcp__montroop__/, ""));
  expect(await offered(t + ": hello")).toContain("settings");
  expect(await offered(t + ": sub")).not.toContain("settings");
});

test.concurrent("a system prompt a mon sets keeps the one before in its history, as that mon's change, and the owner reverts to it", async () => {
  const k = await Troop.up();
  const t = tag();
  const mine = "You are Montroop. Answer in haiku about " + t + ".";

  const set = await settings(k, { action: "set", prompt: mine });
  expect(set).toStartWith("Changed your settings:\nprompt:\n");
  expect(set).toEndWith("\n-You are Montroop.\n+" + mine + "\nThey apply from your next turn. Your system prompt before is kept in your prompt history: the user can revert to it in your settings in the app, or you can set it back with prompt.");
  const history = (await k.api("GET", "/api/agents/" + k.agent + "/prompts")).json as { prompt: string; versions: Array<{ id: number; who: string | null; prompt: string }> };
  expect(history.prompt).toBe(mine);
  expect(history.versions.map((v) => [v.who, v.prompt])).toEqual([["Montroop", "You are Montroop."]]);

  expect((await k.api("POST", "/api/agents/" + k.agent + "/prompts", { id: history.versions[0].id })).status).toBe(200);
  expect(await shown(k)).toMatchObject({ prompt: "You are Montroop.", own: false });
});

test.concurrent("Lasting submons turned on, from the app or by the mon itself, or on for a new mon, sends it one message from the app, which starts its turn; left on, none", async () => {
  const k = await Troop.up();
  const notes = async (agent = k.agent) => (await chat(k, agent)).filter((m) => m.kind === "note" && m.text.startsWith(SETUP));

  expect(await k.api("POST", "/api/agents/" + k.agent, { subagents: "yes" })).toEqual({ status: 400, json: { error: "subagents is true or false." } });
  await k.api("POST", "/api/agents/" + k.agent, { subagents: true });
  await until("its turn on the message", async () => (await chat(k)).at(-1)?.kind === "reply" && (await notes()).length === 1);
  await k.api("POST", "/api/agents/" + k.agent, { subagents: true, about: "Still on." });
  expect(await settings(k, { action: "set", subagents: false })).toBe("Changed your settings:\nsubagents: on → off\nThey apply from your next turn.");
  expect(await notes()).toHaveLength(1);

  expect(await settings(k, { action: "set", subagents: true })).toBe("Changed your settings:\nsubagents: off → on\nThey apply from your next turn.");
  await until("the second message", async () => (await notes()).length === 2);
  const text = (await notes())[0].text;
  expect(text).toContain("worktree setup command");
  expect(text).toContain("the subagent tool's setup action");
  expect(text).toContain("one-time step");

  const made = ((await k.api("POST", "/api/agents", { name: "Other", about: "Another agent.", prompt: "You are Other.", subagents: true })).json as { agent: { id: string } }).agent.id;
  await until("the new mon's turn on the message", async () => (await chat(k, made)).at(-1)?.kind === "reply" && (await notes(made)).length === 1);
  await k.tell("hello", made);
  await until("its next turn", async () => (await chat(k, made)).filter((m) => m.kind === "reply").length === 2);
  expect(await notes(made)).toHaveLength(1);
});
