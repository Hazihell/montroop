import { afterAll, expect, test } from "bun:test";
import * as path from "node:path";
import { wake_text } from "../../Wake.ts";
import { down, fake, gate, Kny, older, repo, said, tag, until, waiting } from "../rig.ts";

afterAll(down);

test.concurrent("a holder of the version before is adopted by this version's server and its run seen through; the session's next run is this version's", async () => {
  const k = await Kny.up(older());
  const t = tag();
  await fake.next(t + ": work", { what: "tool", calls: [["Bash", { command: gate(t) }]] });
  await fake.next(t + "-done", { what: "reply", text: t + " finished" });
  await fake.next(t + ": more", { what: "reply", text: t + " more done" });
  const s = await k.session("old", t + ": work", repo());
  await until("the command running", () => waiting(t));
  const holder = s.holder();
  await k.kill();
  k.root = path.resolve(import.meta.dir, "../..");
  await k.start();

  expect(s.holder()).toBe(holder);
  s.open(t);
  expect((await s.status("done")).runs).toMatchObject([{ n: 1, status: "done", attempts: 1 }]);
  await until("the done wake", async () => await said(k, wake_text("session", "old", "done: ") + t + " finished") === 1);
  await until("its holder ended", () => s.holder() === null);
  expect((await s.say(t + ": more", "more-1")).status).toBe(200);
  const next = await until("the next run done", async () => {
    const p = await s.page();
    return p.status === "done" && p.runs.length === 2 ? p : null;
  });
  expect(next.log.filter((x) => x.ev.k === "text").map((x) => x.ev.text)).toEqual([t + " finished", t + " more done"]);
  await until("its done wake", async () => await said(k, wake_text("session", "old", "done: ") + t + " more done") === 1);
});
