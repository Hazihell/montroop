import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fake, Kny, repo, running, said, until } from "../rig.ts";

test.concurrent("a second connection's hello takes the holder over, and the server takes it back with nothing lost", async () => {
  const k = await Kny.up();
  await fake.next("sk: work", { what: "tool", calls: [["Bash", { command: "sleep 2.4 && echo sk-slept" }]] });
  await fake.next("sk-slept", { what: "reply", text: "sk finished" });
  const s = await k.session("sk", "sk: work", repo());
  await until("the command running", () => running(/^sleep 2.4$/).length > 0);
  const got: string[] = [];
  let closed = false;
  await Bun.connect({ unix: path.join(s.dir, "hold-1.sock"), socket: {
    open: (c) => void c.write(JSON.stringify({ $: "hello", ack: 0 }) + "\n"),
    data: (_c, d) => void got.push(...d.toString().split("\n").filter((l) => l !== "")),
    close: () => void (closed = true),
  } });
  await until("its welcome", () => got.some((l) => (JSON.parse(l) as { $: string }).$ === "welcome"));
  await until("the server taking the holder back", () => closed);

  expect((await s.status("done")).log.filter((t) => t.ev.k === "text").map((t) => t.ev.text)).toEqual(["sk finished"]);
  await until("the done wake", async () => await said(k, "[Session sk] done: sk finished") === 1);
  await k.kill();
});

test.concurrent("a command left running in the background keeps the session at work past its turn, till it ends", async () => {
  const k = await Kny.up();
  await fake.next("bg: work", { what: "tool", calls: [["Bash", { command: "sleep 2.5 && echo bg-done > bg.txt", run_in_background: true }]] });
  const s = await k.session("bg", "bg: work", repo());
  await until("its first turn's end", () => s.logged().some((t) => t.ev.k === "turn"));
  const mid = await s.page();
  expect(fs.existsSync(path.join(mid.worktree, "bg.txt"))).toBe(false);
  expect(mid.status).toBe("running");

  const done = await s.status("done");
  expect(fs.readFileSync(path.join(done.worktree, "bg.txt"), "utf8")).toBe("bg-done\n");
  expect(done.log.filter((t) => t.ev.k === "turn")).toHaveLength(2);
  await k.kill();
});
