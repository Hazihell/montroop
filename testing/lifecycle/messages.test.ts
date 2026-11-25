import { afterAll, expect, test } from "bun:test";
import { wake_text } from "../../Wake.ts";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { down, fake, gate, git, Kny, repo, said, tag, until, waiting } from "../rig.ts";

afterAll(down);

const AGAIN = "A message with this request was sent already: not sent twice.";

test.concurrent("a message sent twice with the same request goes in once, to a running session and to a done one", async () => {
  const k = await Kny.up();
  const t = tag();
  await fake.next(t + ": work", { what: "tool", calls: [["Bash", { command: gate(t) }]] });
  const s = await k.session("so", t + ": work", repo());
  await until("the command running", () => waiting(t));
  const live = await Promise.all([s.say(t + ": steer", "dup-live"), s.say(t + ": steer", "dup-live")]);
  expect(live.map((r) => r.status)).toEqual([200, 200]);
  expect(live.filter((r) => r.json.sent === AGAIN)).toHaveLength(1);
  s.open(t);
  await s.status("done");
  await until("its holder ended", () => s.holder() === null);
  const done = await Promise.all([s.say(t + ": later", "dup-done"), s.say(t + ": later", "dup-done")]);
  expect(done.map((r) => r.status)).toEqual([200, 200]);
  expect(done.filter((r) => r.json.sent === AGAIN)).toHaveLength(1);
  const after = await until("its second run done", async () => {
    const p = await s.page();
    return p.status === "done" && p.runs.length === 2 ? p : null;
  });
  expect(after.says.map((x) => x.id)).toEqual([s.id + "/dup-live", s.id + "/dup-done"]);
  expect(after.log.filter((x) => x.ev.k === "heard" && x.ev.id === s.id + "/dup-live")).toHaveLength(1);
});

test.concurrent("a stop by the session tool wakes no one, a stop by the user wakes its agent once, and each ends what the session runs", async () => {
  const k = await Kny.up();
  const r = repo();
  const [ta, tb] = [tag(), tag()];
  await fake.next(ta + ": work", { what: "tool", calls: [["Bash", { command: gate(ta) }]] });
  await fake.next(tb + ": work", { what: "tool", calls: [["Bash", { command: gate(tb) }]] });
  const a = await k.session("st-a", ta + ": work", r);
  const b = await k.session("st-b", tb + ": work", r);
  await until("both commands running", () => waiting(ta) && waiting(tb));

  await fake.next(ta + ": stop st-a", { what: "tool", calls: [["session", { action: "stop", name: "st-a" }]] });
  await k.tell(ta + ": stop st-a");
  await a.status("stopped");
  expect((await k.api("POST", "/api/sessions/" + b.id + "/stop", {})).status).toBe(200);
  await b.status("stopped");
  await until("both commands ended", () => !waiting(ta) && !waiting(tb));
  await until("the user's stop's wake", async () => await said(k, wake_text("session", "st-b", "stopped: by the user.")) === 1);
  expect(await said(k, wake_text("session", "st-a", ""))).toBe(0);
});

test.concurrent("a call that asks first waits across a server restart, runs once when approved, and not when denied", async () => {
  const k = await Kny.up();
  const r = repo();
  const canary = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "outside-")), "canary.txt");
  fs.writeFileSync(canary, "keep\n");
  const t = tag();
  await fake.next(t + ": work", { what: "tool", calls: [["Bash", { command: "git commit --allow-empty -qm ap && git push -q --force origin HEAD && echo " + t + "-pushed" }]] });
  await fake.next(t + "-pushed", { what: "tool", calls: [["Bash", { command: "rm -f " + canary }]] });
  const s = await k.session("ap", t + ": work", r);
  expect((await s.status("waiting")).waits).toBe("approval");
  const push = await until("the push's card", () => k.cards().find((c) => c.input.includes("git push")));
  await k.kill();
  await k.start();

  const back = await s.page();
  expect([back.status, back.waits, back.parked.length]).toEqual(["waiting", "approval", 1]);
  expect((await k.api("POST", "/api/approve", { id: push.id, ok: true, note: "" })).status).toBe(200);
  const rm = await until("the rm's card", () => k.cards().find((c) => c.input.includes("rm -f")));
  expect((await k.api("POST", "/api/approve", { id: rm.id, ok: false, note: "" })).status).toBe(200);

  await s.status("done");
  expect(git(path.join(path.dirname(r), "origin.git"), "rev-list", "--count", "main..kny/ap")).toBe("1");
  expect(fs.existsSync(canary)).toBe(true);
  await until("the done wake", async () => await said(k, wake_text("session", "ap", "done:")) === 1);
  expect(await said(k, wake_text("session", "ap", "waiting:"))).toBe(2);
});

test.concurrent("the owner's note to an approved call, and to a denied one, reaches the session with the call's result", async () => {
  const k = await Kny.up();
  const t = tag();
  await fake.next(t + ": work", { what: "tool", calls: [["Bash", { command: "git push -q --force origin HEAD:" + t + " && echo " + t + "-pushed" }]] });
  await fake.next(t + "-pushed", { what: "tool", calls: [["Bash", { command: "git push -q --force origin HEAD:" + t + "-2" }]] });
  await fake.next("“not that one " + t + "”. Don't do it another way", { what: "reply", text: t + " left it" });
  const s = await k.session("nt", t + ": work", repo());
  const card = async (ref: string) => await until("the card of " + ref, () => {
    const all = JSON.parse(fs.readFileSync(path.join(k.dir, "asks.json"), "utf8")) as Array<{ id: string; input: string }>;
    return all.find((c) => c.input.includes("HEAD:" + ref + " ") || c.input.includes("HEAD:" + ref + "\"")) ?? null;
  });
  expect((await k.api("POST", "/api/approve", { id: (await card(t)).id, ok: true, note: "quietly " + t })).status).toBe(200);
  expect((await k.api("POST", "/api/approve", { id: (await card(t + "-2")).id, ok: false, note: "not that one " + t })).status).toBe(200);

  expect((await s.status("done")).log.filter((x) => x.ev.k === "text").map((x) => x.ev.text)).toEqual([t + " left it"]);
  expect((await fake.last(t + "-pushed")).filter((m) => m.role === "system").map((m) => m.text)).toContain("PostToolUse:Bash hook additional context: The user approved this with a note: “quietly " + t + "”");
});
