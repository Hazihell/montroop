// Subagents
// =========
// The subagent tool: an agent's workers, each on one task, run on the
// engine (a session of a provider, which Sessions runs, through restarts).
// A task's options make its job: its model and effort (by default its
// agent's) pick its provider and account; memory gives it its agent's
// view and the memory tools on its agent's chat; repo, a worktree of its
// own on a new branch (troop/<name> unless named), or (write false) on
// none, its edit tools denied; without one, a folder of its own. Every
// task is checked before any starts, and none starts while the computer
// is nearly out of memory (Room); how many to start is the agent's call.
// The rest of what the tool does is Sessions'.

import * as fs from "node:fs";
import * as path from "node:path";
import type { Out } from "./Agent.ts";
import type { Block, Vendor } from "./AskAI.ts";
import { Brief } from "./Brief.ts";
import { Browser, MEDIA } from "./Browser.ts";
import * as config from "./Config.ts";
import type { Job } from "./Driver.ts";
import { list, rec, text_of } from "./Json.ts";
import { Machine } from "./Machine.ts";
import * as Names from "./Names.ts";
import { Pick } from "./Pick.ts";
import * as Prompts from "./Prompts.ts";
import { Room } from "./Room.ts";
import { transients } from "./Service.ts";
import { Session } from "./Session.ts";
import { Setup } from "./Setup.ts";
import { DIR, NAME, Sessions } from "./Sessions.ts";
import { Sub, type Role } from "./Sub.ts";
import { Team } from "./Team.ts";
import { SEARCHES, type Tools } from "./Tools.ts";
import { Worktree } from "./Worktree.ts";

// a task checked: its name, model and effort as its agent's pick makes
// them, its account, the repo's top folder ("": none), its base and its
// new branch ("": none)
type Task = { task: string; name: string; role: Role; pick: Pick; account: Job["account"]; memory: boolean; repo: string; base: string; branch: string; write: boolean; mcp: boolean; browser: boolean };

// each vendor's account for an agent whose Claude account is claude
const ACCOUNTS: Record<Vendor, (claude: string) => Job["account"]> = {
  "claude-sub" : (claude) => ({ provider: "claude", id: claude, kind: "plan", dir: config.claude_dir(claude) }),
  "claude-api" : () => ({ provider: "claude", id: "key", kind: "key", dir: null }),
  "openai-sub" : () => ({ provider: "openai", id: "chatgpt", kind: "plan", dir: config.CODEX_HOME }),
  "openai-api" : () => ({ provider: "openai", id: "key", kind: "key", dir: null }),
};

// a repo's work needs a provider with tools of its own in a folder
const OWN_TOOLS: Vendor[] = ["claude-sub", "openai-sub"];

// the server's: its tools; an agent's view now, or why there's none; its
// pick, null for no such agent
const HOOKS = {
  tools : null as Tools | null,
  view  : (_agent: string) => Promise.resolve<Block[] | string>([]),
  pick  : (_agent: string): Pick | null => null,
};

export namespace Subagents {

  export function boot(tools: Tools, view: typeof HOOKS.view, pick: typeof HOOKS.pick): void {
    Object.assign(HOOKS, { tools, view, pick });
  }

  export async function tool(agent: string, args: Record<string, unknown>): Promise<Out> {
    if (text_of(args.action, "") !== "start") {
      return Sessions.act(agent, "subagent", args);
    }
    const tasks = checked(agent, args.tasks);
    if (typeof tasks === "string") {
      return { text: tasks, fail: true };
    }
    const view = tasks.some((t) => t.memory) ? await HOOKS.view(agent) : [];
    if (typeof view === "string") {
      return { text: view + " Nothing started.", fail: true };
    }
    const no = Room.refused(Room.now(agent));
    if (no !== null) {
      return { text: no, fail: true };
    }
    const made = tasks.map((t) => start(agent, t, t.memory ? view : []));
    const ids = made.flatMap((m) => (typeof m === "string" ? [] : [m.id]));
    Sessions.begin(ids);
    const said = made.map((m, k) => {
      const t = tasks[k];
      const s = typeof m === "string" ? null : Session.get(m.id);
      const knobs = [t.pick.model, t.pick.effort === "" ? null : "effort " + t.pick.effort, t.memory ? "your view" : null, t.repo === "" ? null : (t.branch === "" ? "read-only" : "branch " + t.branch) + " in " + t.repo].filter((x) => x !== null);
      return typeof m === "string" ? t.name + " not started: " + m : s?.status === "failed" ? t.name + " didn't start: " + (Session.run(m.id)?.why ?? "") : t.name + " (" + knobs.join(", ") + ")";
    });
    const any = ids.some((id) => Session.get(id)?.status !== "failed");
    return { text: (any ? "Started " : "") + said.join("; ") + "." + (any ? " Each works on its own: you get one message \"[Subagent name] …\" when it's done (with its result), fails, waits on the user's approval or a usage limit, or asks you something. Don't wait for them or read them to check: go on with other work, or end your turn. This computer now: " + Room.said(Room.now(agent)) + "." : ""), fail: !any };
  }

  // the tasks given, each checked, or why one can't start (then none does)
  function checked(agent: string, given: unknown): Task[] | string {
    const a = Team.get(agent);
    const base = HOOKS.pick(agent);
    if (a === null || base === null) {
      return "No agent " + agent + ".";
    }
    const all = list(given);
    if (all.length === 0) {
      return "No tasks. Nothing started.";
    }
    if (!transients()) {
      return "Subagents run as systemd user units, and systemd-run isn't here. Nothing started.";
    }
    const taken = new Set(Session.list(agent).map((s) => s.name));
    // each task's branch and its repo's git folder, so no two clash
    const branches: Array<{ git: string; branch: string }> = [];
    const offered = new Set(Pick.models(config.OFFER.vendors, config.OFFER.models).map(([, m]) => m.label));
    const out: Task[] = [];
    for (const [k, x] of all.entries()) {
      const t: Record<string, unknown> = typeof x === "string" ? { task: x } : rec(x) ? x : {};
      const task = typeof t.task === "string" ? t.task.trim() : "";
      const role: Role = { model: t.model === undefined ? null : text_of(t.model, "null"), effort: t.effort === undefined ? null : text_of(t.effort, "null") };
      const name = t.name === undefined ? fresh(taken) : text_of(t.name, "").trim();
      const repo = t.repo === undefined ? "" : text_of(t.repo, "").trim();
      const top = repo === "" ? { dir: "", git: "" } : Worktree.top(Machine.home(repo));
      const pick = role.model !== null && !offered.has(role.model) ? null : picked(base, role, name);
      const vendor = pick?.vendor;
      const bad = task === "" ? "no task text" :
        !NAME.test(name) ? "a name is 1 to 40 lowercase letters, digits and dashes" :
        taken.has(name) ? "you have a session or subagent " + name + " already: pick another name, or leave it out" :
        pick === null || vendor === undefined ? "no model " + (role.model ?? base.model) + "; one of " + [...offered].join(", ") :
        Sub.no_effort(base, role) ?? ("why" in top ? top.why : repo !== "" && !OWN_TOOLS.includes(vendor) ? pick.model + " has no tools of its own to work on a repo with: pick a model on a Claude or ChatGPT plan" : null);
      if (bad !== null || pick === null || "why" in top) {
        return Sub.refused(k, task, bad ?? "");
      }
      const write = t.write !== false;
      const named = text_of(t.branch, "").trim();
      const branch = top.dir !== "" && write ? named || "troop/" + name : "";
      const other = branch === "" ? undefined : branches.find((b) => b.git === top.git && Worktree.clash(b.branch, branch))?.branch;
      const no_branch = named !== "" && branch === "" ? (top.dir === "" ? "branch needs a repo: without one it works in a folder of its own" : "branch needs write true: with write false it works on no branch") :
        branch === "" ? null :
        other !== undefined ? "another of these tasks works on branch " + other + " in this repo" + (other === branch ? " already: give each its own" : ", so git can't keep " + branch + " beside it: pick another name") :
        Worktree.taken(top.dir, branch);
      if (no_branch !== null) {
        return Sub.refused(k, task, no_branch);
      }
      taken.add(name);
      branches.push({ git: top.git, branch });
      out.push({ task, name, role, pick, account: ACCOUNTS[pick.vendor](a.claude), memory: typeof t.memory === "boolean" ? t.memory : top.dir === "", repo: top.dir, base: top.dir === "" ? "" : Worktree.named(top.dir, text_of(t.base ?? "", "").trim() || "HEAD"), branch, write, mcp: t.mcp !== false, browser: t.browser !== false });
    }
    return out;
  }

  // the agent's pick with the task's model and effort; null: its model
  // isn't offered
  function picked(base: Pick, role: Role, name: string): Pick | null {
    try {
      return Sub.pick(base, role, name);
    } catch {
      return null;
    }
  }

  // a name none of the agent's sessions and subagents has: an adjective
  // and an animal
  function fresh(taken: Set<string>): string {
    for (;;) {
      const name = Names.name_random().replace(/(?<=.)([A-Z])/g, "-$1").toLowerCase();
      if (!taken.has(name)) {
        return name;
      }
    }
  }

  // a task's record and job, its folder or worktree made; its holder not
  // launched yet. A string: why it can't be
  function start(agent: string, t: Task, view: Block[]): Session | string {
    const a = Team.get(agent);
    if (a === null) {
      return "No agent " + agent + ".";
    }
    const folder = path.join(Machine.agent_dir(agent), "sessions", t.name);
    fs.mkdirSync(path.dirname(folder), { recursive: true });
    const why = t.repo === "" ? (fs.existsSync(folder) ? folder + " exists already" : null) : t.branch === "" ? Worktree.detach(t.repo, t.base, folder) : Worktree.make(t.repo, t.base, t.branch, folder);
    if (why !== null) {
      return why;
    }
    fs.mkdirSync(folder, { recursive: true });
    const id = crypto.randomUUID().slice(0, 8);
    const dir = path.join(DIR, id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (t.repo !== "") {
      Setup.arm(agent, t.repo, folder, dir);
    }
    const media = t.browser && Browser.make(dir, id) ? Prompts.prompt("session-browser", { media: path.join(dir, MEDIA) }) : "";
    const own = "Your folder on this server's computer, where your own tools work: " + folder + (t.repo === "" ? "" : ", a worktree of " + t.repo + (t.branch === "" ? " at " + t.base + " on no branch; your edit tools are denied" : " on your branch " + t.branch + " from " + t.base)) + "." + (media === "" ? "" : "\n" + media);
    const { system, first } = Brief.subagent(a, view, t.repo !== "", own, HOOKS.tools);
    const model = Pick.model(t.pick.vendor, t.pick.model)?.id ?? t.pick.model;
    const job: Omit<Job, "dir" | "tools"> = { account: t.account, model, effort: t.pick.effort, speed: t.pick.speed, system, own: "", context: { kind: "native", resume: "", first, brief: t.task }, cwd: folder, write: t.write, web: SEARCHES };
    return Sessions.subagent({ id, name: t.name, agent, repo: t.repo, base: t.base, branch: t.branch, worktree: folder, provider: t.account.provider, account: t.account.id, model, effort: t.pick.effort, memory: t.memory ? 1 : 0, write: t.write ? 1 : 0, device: "", dir }, { job, mcp: t.mcp }, t.task);
  }

}
