import { afterAll, expect, test } from "bun:test";
import { wake_text } from "../../Wake.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import { down, fake, gate, Kny, repo, said, tag, until, waiting } from "../rig.ts";

afterAll(down);

test.concurrent("a second connection's hello takes the holder over, and the server takes it back and sees the run through", async () => {
  const k = await Kny.up();
  const t = tag();
  await fake.next(t + ": work", { what: "tool", calls: [["Bash", { command: gate(t) }]] });
  await fake.next(t + "-done", { what: "reply", text: t + " finished" });
  const s = await k.session("sk", t + ": work", repo());
  await until("the command running", () => waiting(t));
  const got: string[] = [];
  let closed = false;
  await Bun.connect({ unix: path.join(s.dir, "hold-1.sock"), socket: {
    open: (c) => void c.write(JSON.stringify({ $: "hello", ack: 0 }) + "\n"),
    data: (_c, d) => void got.push(...d.toString().split("\n").filter((l) => l !== "")),
    close: () => void (closed = true),
  } });
  await until("its welcome", () => got.some((l) => (JSON.parse(l) as { $: string }).$ === "welcome"));
  await until("the server taking the holder back", () => closed);
  s.open(t);

  expect((await s.status("done")).log.filter((x) => x.ev.k === "text").map((x) => x.ev.text)).toEqual([t + " finished"]);
  await until("the done wake", async () => await said(k, wake_text("session", "sk", "done: ") + t + " finished") === 1);
});

test.concurrent("a command left running in the background keeps the session at work past its turn, till it ends", async () => {
  const k = await Kny.up();
  const t = tag();
  await fake.next(t + ": work", { what: "tool", calls: [["Bash", { command: gate(t) + " > bg.txt", run_in_background: true }]] });
  const s = await k.session("bg", t + ": work", repo());
  await until("its first turn's end", () => s.logged().some((x) => x.ev.k === "turn"));
  expect((await s.page()).status).toBe("running");
  s.open(t);

  const done = await s.status("done");
  expect(fs.readFileSync(path.join(done.worktree, "bg.txt"), "utf8")).toBe(t + "-done\n");
});
