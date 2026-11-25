import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { down, fake, git, repo, tag, Troop, until } from "../rig.ts";

afterAll(down);

// the agent sets its setup for repo's new worktrees with its tool: the
// session tool, or the subagent tool once its setting is on
async function set_up(k: Troop, tool: "session" | "subagent", repo: string, command: string): Promise<void> {
  if (tool === "subagent") {
    await k.api("POST", "/api/agents/" + k.agent, { subagents: true });
  }
  const t = tag();
  await fake.next(t + ": set up", { what: "tool", calls: [[tool, { action: "setup", repo, command }]] });
  await k.tell(t + ": set up");
  await until("the setup set", async () => (await fake.seen("Set: each new worktree of " + repo)).length > 0);
}

// a repo whose main checkout has a gitignored .env that its
// .worktreeinclude names, and a gitignored file it doesn't
function with_env(): string {
  const r = repo();
  fs.writeFileSync(path.join(r, ".gitignore"), ".env\nbig.log\n");
  fs.writeFileSync(path.join(r, ".worktreeinclude"), ".env\n");
  git(r, "add", ".");
  git(r, "commit", "-qm", "ignore");
  fs.writeFileSync(path.join(r, ".env"), "SECRET=1\n");
  fs.writeFileSync(path.join(r, "big.log"), "x\n");
  return r;
}

const WAYS = [
  ["a work session", "session", {}],
  ["a subagent", "subagent", {}],
  ["a review on no branch", "subagent", { write: false }],
] as const;

test.concurrent.each(WAYS)("%s: a new worktree runs its agent's setup before the first turn, in the worktree with the repo and its path, the files .worktreeinclude names copied in first", async (_what, via, more) => {
  const k = await Troop.up();
  const t = tag();
  const r = with_env();
  await set_up(k, via, r, "echo \"$TROOP_REPO|$TROOP_WORKTREE|$PWD|$(cat .env)\" > ../setup-" + t);
  await fake.next(t + ": work", { what: "reply", text: "Done." });
  const s = await k.work(via, "su", t + ": work", r, { ...more });

  const done = await s.status("done");
  expect(fs.readFileSync(path.join(path.dirname(s.worktree), "setup-" + t), "utf8")).toBe([r, s.worktree, s.worktree, "SECRET=1"].join("|") + "\n");
  expect(fs.existsSync(path.join(r, "big.log"))).toBe(true);
  const kinds = done.log.map((x) => x.ev.k).filter((k) => ["setup", "began", "text", "turn"].includes(k));
  expect(kinds.slice(0, 2)).toEqual(["setup", "setup"]);
  expect(done.log.filter((x) => x.ev.k === "setup").map((x) => x.ev.ok)).toEqual([null, true]);
});

test.concurrent("a worktree's .worktreeinclude files are copied even with no setup command, and no other gitignored file", async () => {
  const k = await Troop.up();
  const t = tag();
  const r = with_env();
  await fake.next(t + ": work", { what: "tool", calls: [["Bash", { command: "ls -a" }]] });
  const [s] = await k.subagents({ task: t + ": work", name: "si", repo: r, base: "main" });

  const done = await s.status("done");
  const result = done.log.find((x) => x.ev.k === "result")?.ev.text;
  const listed = (typeof result === "string" ? result : "").split("\n");
  expect(listed).toContain(".env");
  expect(listed).not.toContain("big.log");
});

test.concurrent.each(WAYS)("%s: a setup that fails still starts it, its first message telling it so with the setup's last lines", async (_what, via, more) => {
  const k = await Troop.up();
  const t = tag();
  const r = repo();
  await set_up(k, via, r, "echo installing; echo broken-" + t + " >&2; exit 3");
  await fake.next(t + ": work", { what: "reply", text: "Fixed it." });
  const s = await k.work(via, "sf", t + ": work", r, { ...more });

  const done = await s.status("done");
  expect(done.log.filter((x) => x.ev.k === "setup").map((x) => [x.ev.ok, x.ev.text])).toEqual([[null, "echo installing; echo broken-" + t + " >&2; exit 3"], [false, "installing\nbroken-" + t]]);
  const first = (await fake.last(t + ": work")).find((m) => m.role === "user")?.text ?? "";
  expect(first).toContain("The setup of your worktree failed (it exited with 3)");
  expect(first).toContain("installing\nbroken-" + t);
  expect(first).toContain(t + ": work");
});

test.concurrent("a submon of another agent gets no setup of this agent's", async () => {
  const k = await Troop.up();
  const t = tag();
  const r = repo();
  await set_up(k, "session", r, "touch ../setup-" + t);
  const other = ((await k.api("POST", "/api/agents", { name: "Other", about: "Another agent.", prompt: "You are Other." })).json as { agent: { id: string } }).agent.id;
  await fake.next(t + ": work", { what: "reply", text: "Done." });
  const res = await k.api("POST", "/api/sessions", { agent: other, repo: r, base: "main", name: "so", brief: "", prompt: t + ": work" });
  expect(res.status).toBe(200);

  const page = await until("its run over", async () => {
    const p = (await k.api("GET", "/api/sessions/" + String(res.json.id))).json as { status: string; worktree: string; log: Array<{ ev: { k: string } }> };
    return p.status === "done" ? p : null;
  });
  expect(fs.existsSync(path.join(path.dirname(page.worktree), "setup-" + t))).toBe(false);
  expect(page.log.filter((x) => x.ev.k === "setup")).toEqual([]);
});
