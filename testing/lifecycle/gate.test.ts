import { afterAll, expect, test } from "bun:test";
import { down, fake, Kny, tag, until } from "../rig.ts";

afterAll(down);

// the connector's tool calls whose arguments have t
async function ran(t: string): Promise<string[]> {
  return (await fake.seen(t)).filter((s) => s.model === "").map((s) => s.latest);
}

// whether a model call's newest message has text
async function told(text: string): Promise<boolean> {
  return (await fake.seen(text)).some((s) => s.model !== "");
}

test.concurrent("a connector's call an ask rule names waits for the owner, and runs once approved", async () => {
  const k = await Kny.up();
  const t = tag();
  await fake.next(t + ": mail", { what: "tool", calls: [["mcp__claude_ai_Gmail__send_message", { to: t + "@example.com", body: "hi" }]] });
  await k.tell(t + ": mail");
  const card = await until("its card", () => k.cards()[0]);
  expect([card.tool, card.input]).toEqual(["mcp__claude_ai_Gmail__send_message", '{"to":"' + t + '@example.com","body":"hi"}']);
  await Bun.sleep(500);
  expect(await ran(t)).toEqual([]);

  expect((await k.api("POST", "/api/approve", { id: card.id, ok: true, note: "" })).status).toBe(200);
  await until("the model told it was sent", () => told("Sent to " + t + "@example.com."));
  expect(await ran(t)).toEqual(['send_message {"to":"' + t + '@example.com","body":"hi"}']);
});

test.concurrent("a connector's call the owner denies never runs, and the model is told so", async () => {
  const k = await Kny.up();
  const t = tag();
  await fake.next(t + ": mail", { what: "tool", calls: [["mcp__claude_ai_Gmail__send_message", { to: t + "@example.com", body: "hi" }]] });
  await k.tell(t + ": mail");
  const card = await until("its card", () => k.cards()[0]);

  expect((await k.api("POST", "/api/approve", { id: card.id, ok: false, note: "not " + t })).status).toBe(200);
  await until("the model told it was denied", () => told("The user denied this (send a message or email as you): “not " + t + "”"));
  expect(await ran(t)).toEqual([]);
});

// (the suite's only ToolSearch call, so Claude Code's answer "Tool loaded." is its)
test.concurrent("a tool of Claude Code's own an ask rule names waits for the owner, and runs once approved", async () => {
  const k = await Kny.up({ ask: [{ what: "Look up a tool", tools: "ToolSearch", args: "" }] });
  const t = tag();
  const loaded = async () => (await fake.seen("Tool loaded.")).some((s) => s.tools.includes("mcp__claude_ai_Gmail__list_messages"));
  await fake.next(t + ": find", { what: "tool", calls: [["ToolSearch", { query: "select:mcp__claude_ai_Gmail__list_messages", max_results: 1 }]] });
  await k.tell(t + ": find");
  const card = await until("its card", () => k.cards()[0]);
  expect(card.tool).toBe("ToolSearch");
  await Bun.sleep(500);
  expect(await loaded()).toBe(false);

  expect((await k.api("POST", "/api/approve", { id: card.id, ok: true, note: "" })).status).toBe(200);
  await until("the tool it looked up given to the model", loaded);
});

test.concurrent("a connector's call no ask rule names runs without asking", async () => {
  const k = await Kny.up();
  const t = tag();
  await fake.next(t + ": inbox", { what: "tool", calls: [["mcp__claude_ai_Gmail__list_messages", { label: t }]] });
  await k.tell(t + ": inbox");
  await until("the call run", async () => (await ran(t)).length === 1);
});

test.concurrent("a call an ask rule names, made where no one can approve it (the compactor), is refused", async () => {
  const k = await Kny.up();
  const t = tag();
  await fake.next("Compaction: " + t, { what: "tool", calls: [["mcp__claude_ai_Gmail__send_message", { to: t + "@example.com", body: "hi" }]] });
  await k.tell(t + ": " + "a long message ".repeat(50));
  await until("the compactor told no one can approve it", () => told("This call needs the user's approval, and no one can give it here."));
  expect(await ran(t)).toEqual([]);
});
