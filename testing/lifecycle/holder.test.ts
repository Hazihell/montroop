import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Hold } from "../../Hold.ts";
import { down, fake, gate, git, shell, Troop, repo, said, tag, until, VIAS, waiting } from "../rig.ts";

afterAll(down);

// a holder started by hand on a start.json as given, no server linked to
// it: what it logged once its run is over
async function hold(k: Troop, start: Record<string, unknown>): Promise<unknown[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hold-"));
  fs.writeFileSync(path.join(dir, "spec.json"), JSON.stringify({ cwd: repo(), claude: path.join(k.dir, "claude-sub"), model: "", append: "" }));
  fs.writeFileSync(path.join(dir, "start.json"), JSON.stringify({ ...start, resume: "", rules: [], sock: path.join(dir, "hold.sock") }));
  const p = Bun.spawn(["bun", path.resolve(import.meta.dir, "../../Cli.ts"), "hold", dir], { env: k.env(), stdio: ["ignore", "ignore", "ignore"] });
  // with no server to take what it told, it would wait a minute to exit
  await until("its run over", () => Hold.told(dir).some((x) => x.ev.k === "end"));
  p.kill("SIGKILL");
  return Hold.told(dir).map((x) => x.ev);
}

test.concurrent("a start that names no driver, as one from before drivers were named, runs Claude Code", async () => {
  const k = await Troop.up();
  const t = tag();
  await fake.next(t + ": work", { what: "reply", text: t + " fine" });

  const logged = await hold(k, { prompt: t + ": work" });
  expect(logged).toContainEqual(expect.objectContaining({ k: "began" }));
  expect(logged.at(-1)).toEqual({ k: "end", ok: true, text: t + " fine" });
});

for (const via of VIAS) {
  test.concurrent(via + ": a second connection's hello takes the holder over, and the server takes it back and sees the run through", async () => {
    const k = await Troop.on(via);
    const t = tag();
    await fake.next(t + ": work", { what: "tool", calls: [shell(via, gate(t))] });
    await fake.next(t + "-done", { what: "reply", text: t + " finished" });
    const s = await k.work(via, "sk", t + ": work", repo());
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
    await until("the done wake", async () => await said(k, s.woke("done: ") + t + " finished") === 1);
  });

}

// what Claude Code alone does
test.concurrent("a command left running in the background keeps it at work past its turn, till it ends", async () => {
  const k = await Troop.up();
  const t = tag();
  await fake.next(t + ": work", { what: "tool", calls: [["Bash", { command: gate(t) + " > bg.txt", run_in_background: true }]] });
  const s = await k.work("subagent", "bg", t + ": work", repo());
  await until("its first turn's end", () => s.logged().some((x) => x.ev.k === "turn"));
  expect((await s.page()).status).toBe("running");
  s.open(t);

  const done = await s.status("done");
  expect(fs.readFileSync(path.join(done.worktree, "bg.txt"), "utf8")).toBe(t + "-done\n");
});

test.concurrent("a project's own deny rule still stops its call", async () => {
  const k = await Troop.up();
  const t = tag();
  const r = repo();
  fs.mkdirSync(path.join(r, ".claude"));
  fs.writeFileSync(path.join(r, ".claude", "settings.json"), JSON.stringify({ permissions: { deny: ["Bash(touch:*)"] } }));
  git(r, "add", ".");
  git(r, "commit", "-qm", "deny touch");
  await fake.next(t + ": work", { what: "tool", calls: [["Bash", { command: "touch denied-" + t }]] });
  const s = await k.work("subagent", "dn", t + ": work", r);

  const done = await s.status("done");
  expect(done.log.find((x) => x.ev.k === "result")?.ev).toMatchObject({ error: true });
  expect(fs.existsSync(path.join(s.worktree, "denied-" + t))).toBe(false);
});
