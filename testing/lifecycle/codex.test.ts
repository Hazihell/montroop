import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { err_code } from "../../Err.ts";
import type { Job } from "../../Driver.ts";
import type { Rule } from "../../Rules.ts";
import { VERSION, type Ask, type Ev } from "../../Wire.ts";
import { Hold } from "../../Hold.ts";
import { connect, fake, hold, signed, tag, tell, until } from "../rig.ts";

// a rule that has the owner answer every call first
const EVERY: Rule[] = [{ what: "Do anything", tools: "*", args: "" }];

// one of Montroop's tools a start offers
const KIT = [{ name: "wipe", info: "Wipe the data.", schema: { type: "object", properties: {} }, device: null }];

// a Codex job on a data folder's ChatGPT plan, in a folder of its own
function codex(home: string, more: Partial<Omit<Job, "dir">> = {}): Omit<Job, "dir"> {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cwd-"));
  return { account: { provider: "openai", id: "chatgpt", kind: "plan", dir: path.join(home, "codex") }, model: "gpt-6-luna", effort: "low", speed: "slow", system: "You are a test agent.", own: "", context: { kind: "native", resume: "", first: [], brief: "" }, cwd, write: true, tools: [], web: 0, ...more };
}

// a server of the test's own for the holder in dir: each call parked
// answered as ok says (a question with answers, any with note), each call
// of Montroop's tools answered "done"
async function owner(dir: string, rules: Rule[], ok: (ask: Ask) => boolean, answers: Record<string, string> = {}, note = ""): Promise<void> {
  const send = (c: { write: (s: string) => unknown }, msg: object) => c.write(JSON.stringify(msg) + "\n");
  let rest = "";
  await connect(dir, {
    open: (c) => void send(c, { $: "hello", v: VERSION, ack: 0, rules, scratch: {} }),
    data: (c, d) => {
      const lines = (rest + d.toString()).split("\n");
      rest = lines.pop() ?? "";
      for (const msg of lines.map((l) => JSON.parse(l) as { $: string; id: string; ev?: Ev })) {
        if (msg.$ === "call") {
          send(c, { $: "result", id: msg.id, out: { text: "done", fail: false } });
        } else if (msg.$ === "ev" && msg.ev?.k === "ask") {
          send(c, { $: "answer", id: msg.ev.id, ok: ok(msg.ev), note, answers });
        }
      }
    },
  });
}

// an MCP server the Codex home's config starts, its one tool, with no
// hints, logging each call it gets
function mcp(home: string): string {
  const log = path.join(home, "mcp-calls.log");
  const script = path.join(home, "mcp-probe.js");
  fs.writeFileSync(script, `const fs = require("fs");
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  for (let k = buf.indexOf("\\n"); k >= 0; k = buf.indexOf("\\n")) {
    const line = buf.slice(0, k);
    buf = buf.slice(k + 1);
    const m = line.trim() === "" ? {} : JSON.parse(line);
    if (m.id === undefined) continue;
    let result = {};
    if (m.method === "initialize") result = { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "probe", version: "1" } };
    if (m.method === "tools/list") result = { tools: [{ name: "wipe", description: "Wipe the data.", inputSchema: { type: "object", properties: {} } }] };
    if (m.method === "tools/call") {
      fs.appendFileSync(${JSON.stringify(log)}, m.params.name + "\\n");
      result = { content: [{ type: "text", text: "wiped" }] };
    }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }) + "\\n");
  }
});
`);
  fs.mkdirSync(path.join(home, "codex"), { recursive: true });
  fs.writeFileSync(path.join(home, "codex", "config.toml"), "[mcp_servers.probe]\ncommand = " + JSON.stringify(process.execPath) + "\nargs = [" + JSON.stringify(script) + "]\n");
  return log;
}

// each call as a script Codex's exec tool runs, as a model in code mode
// writes it, what each returns or throws printed
function script(calls: string[]): [string, string] {
  return ["exec", calls.map((c) => "try { text(await " + c + "); } catch (e) { text(String(e)); }").join("\n")];
}

const patch = (body: string) => JSON.stringify("*** Begin Patch\n" + body + "*** End Patch\n");

test.concurrent("codex: every command, file change and tool call with an effect reaches the gate, and none the owner denies has one", async () => {
  const t = tag();
  const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
  const log = mcp(home);
  const job = codex(home);
  const cwd = String(job.cwd);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "outside-"));
  fs.writeFileSync(path.join(cwd, "keep.txt"), "keep\n");
  const commands = ["ls", "touch a.txt", "echo hi > b.txt", "ls && touch c.txt", "python3 -c \"open('d.txt', 'w').write('x')\"", "git init -q", "find . -name keep.txt -delete", "sed -i s/keep/gone/ keep.txt", "curl -s -m 2 https://chatgpt.com/", "touch " + path.join(outside, "out.txt")];
  await fake.next(t + ": work", { what: "tool", calls: [script([
    ...commands.map((cmd) => "tools.exec_command(" + JSON.stringify({ cmd }) + ")"),
    "tools.exec_command(" + JSON.stringify({ cmd: "touch " + path.join(outside, "escalated.txt"), sandbox_permissions: "require_escalated", justification: "It must." }) + ")",
    "tools.apply_patch(" + patch("*** Add File: e.txt\n+x\n") + ")",
    "tools.apply_patch(" + patch("*** Update File: keep.txt\n@@\n-keep\n+gone\n") + ")",
    "tools.apply_patch(" + patch("*** Delete File: keep.txt\n") + ")",
    "tools.apply_patch(" + patch("*** Add File: " + path.join(outside, "patched.txt") + "\n+x\n") + ")",
    "tools.montroop__wipe({})",
    "tools.mcp__probe__wipe({})",
  ])] });

  const told = (await hold(home, job, t + ": work", (dir) => owner(dir, EVERY, () => false), undefined, {}, { rules: EVERY, tools: KIT })).map((x) => x.ev);
  const asked = told.flatMap((e) => (e.k === "ask" ? [e] : []));
  expect(asked.filter((a) => a.tool === "exec_command").map((a) => a.input.command)).toEqual([...commands, "touch " + path.join(outside, "escalated.txt")]);
  expect(asked.filter((a) => a.tool === "apply_patch").map((a) => a.input.file_path)).toEqual([[path.join(cwd, "e.txt")], [path.join(cwd, "keep.txt")], [path.join(cwd, "keep.txt")], [path.join(outside, "patched.txt")]]);
  expect(asked.filter((a) => a.tool === "wipe" || a.tool === "mcp__probe__wipe").map((a) => a.tool)).toEqual(["wipe", "mcp__probe__wipe"]);
  expect(fs.readdirSync(cwd)).toEqual(["keep.txt"]);
  expect(fs.readFileSync(path.join(cwd, "keep.txt"), "utf8")).toBe("keep\n");
  expect(fs.readdirSync(outside)).toEqual([]);
  expect(fs.existsSync(log)).toBe(false);
  expect(told.at(-1)).toEqual({ k: "end", ok: true, text: "ok" });
});

test.concurrent("codex: with no rule naming them, its calls run at once, none parked", async () => {
  const t = tag();
  const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
  const log = mcp(home);
  const job = codex(home);
  const cwd = String(job.cwd);
  await fake.next(t + ": work", { what: "tool", calls: [script([
    "tools.exec_command(" + JSON.stringify({ cmd: "touch a.txt" }) + ")",
    "tools.apply_patch(" + patch("*** Add File: e.txt\n+x\n") + ")",
    "tools.montroop__wipe({})",
    "tools.mcp__probe__wipe({})",
  ])] });

  const told = (await hold(home, job, t + ": work", (dir) => owner(dir, [], () => false), undefined, {}, { tools: KIT })).map((x) => x.ev);
  expect(told.filter((e) => e.k === "ask")).toEqual([]);
  expect(fs.readdirSync(cwd).sort()).toEqual(["a.txt", "e.txt"]);
  expect(fs.readFileSync(log, "utf8")).toBe("wipe\n");
  expect(told as unknown[]).toContainEqual(expect.objectContaining({ k: "result", text: "done", error: false }));
  expect(told.at(-1)).toEqual({ k: "end", ok: true, text: "ok" });
});

// (what is typed into a shell that runs in Codex's sandbox asks no one:
// the sandbox keeps it in the workspace and temporary folders, off the
// network)
test.concurrent("codex: what is typed into a shell the owner let run outside its sandbox asks the owner again, and has no effect denied", async () => {
  const t = tag();
  const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "outside-"));
  const typed = path.join(outside, "typed.txt");
  const shell = "tools.exec_command(" + JSON.stringify({ cmd: "bash", tty: true, yield_time_ms: 500, sandbox_permissions: "require_escalated", justification: "It must." }) + ")";
  await fake.next(t + ": work", { what: "tool", calls: [script(["(async () => { const sh = await " + shell + "; return await tools.write_stdin({ session_id: sh.session_id, chars: " + JSON.stringify("touch " + typed + "\n") + ", yield_time_ms: 1000 }); })()"])] });

  const told = (await hold(home, codex(home), t + ": work", (dir) => owner(dir, EVERY, (a) => a.input.command === "bash"), undefined, {}, { rules: EVERY })).map((x) => x.ev);
  expect(told.flatMap((e) => (e.k === "ask" ? [e.input.command] : []))).toEqual(["bash", expect.stringMatching(new RegExp("^write_stdin --session-id \\d+ 'touch " + typed + "\n'$"))]);
  expect(fs.existsSync(typed)).toBe(false);
});

test.concurrent("codex: a job that may not write has its file changes denied, asking no one, and is told why", async () => {
  const t = tag();
  const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
  const job = codex(home, { write: false });
  await fake.next(t + ": review", { what: "tool", calls: [script(["tools.apply_patch(" + patch("*** Add File: e.txt\n+x\n") + ")"])] });

  const told = (await hold(home, job, t + ": review")).map((x) => x.ev);
  expect(told.filter((e) => e.k === "ask")).toEqual([]);
  expect(fs.readdirSync(String(job.cwd))).toEqual([]);
  expect((await fake.seen("This job may not write: its edits are denied.")).some((x) => x.model !== "")).toBe(true);
});

test.concurrent("codex: a new thread's first message starts with the job's first blocks, after its prompt as instructions of the developer's", async () => {
  const t = tag();
  const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
  const job = codex(home, { system: "You are the test agent " + t + ".", context: { kind: "native", resume: "", first: [{ text: "The view " + t + ".\n", mark: true }, { text: "Devices: none.\n", mark: false }], brief: "" } });

  expect((await hold(home, job, t + ": work")).at(-1)?.ev).toEqual({ k: "end", ok: true, text: "ok" });
  const input = ((await fake.body(t + ": work")) as { input: Array<{ role?: string; content?: Array<{ text?: string }> }> }).input;
  expect(input.filter((i) => i.role === "developer").some((i) => i.content?.some((c) => c.text === "You are the test agent " + t + "."))).toBe(true);
  expect(input.findLast((i) => i.role === "user")?.content?.map((c) => c.text)).toEqual(["The view " + t + ".\n", "Devices: none.\n", t + ": work"]);
});

test.concurrent("codex: a later holder resumes the thread, its history and Montroop's tools kept", async () => {
  const t = tag();
  const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hold-"));
  const job = codex(home);
  await fake.next(t + ": one", { what: "reply", text: t + " first answer" });
  const first = (await hold(home, job, t + ": one", (d) => owner(d, [], () => true), dir, {}, { tools: KIT })).map((x) => x.ev);
  const began = first.find((e) => e.k === "began");
  await fake.next(t + ": two", { what: "tool", calls: [["wipe", {}]] });

  const told = (await hold(home, { ...job, context: { kind: "native", resume: String(began?.k === "began" && began.sdk), first: [], brief: "" } }, t + ": two", (d) => owner(d, [], () => true), dir, {}, { tools: KIT })).map((x) => x.ev).slice(first.length);
  expect(told.filter((e) => e.k === "began")).toEqual([]);
  expect(told as unknown[]).toContainEqual(expect.objectContaining({ k: "result", text: "done", error: false }));
  expect(JSON.stringify(await fake.body(t + ": two"))).toContain(t + " first answer");
});

test.concurrent("codex: the ChatGPT sign-in stays Montroop's: a token due is refreshed by Montroop, and Codex keeps none of it", async () => {
  const t = tag();
  const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
  const file = path.join(home, "chatgpt.json");
  const before = JSON.parse(fs.readFileSync(file, "utf8")) as { tokens: { access_token: string; refresh_token: string }; last_refresh: string };
  const stale = before.tokens.access_token.split(".").map((part, k) => (k === 1 ? Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(part, "base64url").toString()), exp: Math.floor(Date.now() / 1e3) - 60 })).toString("base64url") : part)).join(".");
  fs.writeFileSync(file, JSON.stringify({ ...before, tokens: { ...before.tokens, access_token: stale } }));

  expect((await hold(home, codex(home), t + ": work")).at(-1)?.ev).toEqual({ k: "end", ok: true, text: "ok" });
  const after = JSON.parse(fs.readFileSync(file, "utf8")) as { tokens: { access_token: string; refresh_token: string } };
  expect(after.tokens.refresh_token).not.toBe(before.tokens.refresh_token);
  expect(JSON.stringify(await fake.body(t + ": work"))).not.toContain(stale);
  // Codex removes some of its files as it ends, maybe between the listing and the read
  const has = (f: string) => {
    try {
      return fs.readFileSync(path.join(home, "codex", f)).includes(after.tokens.refresh_token);
    } catch (err) {
      if (err_code(err) === "ENOENT" || err_code(err) === "EISDIR") {
        return false;
      }
      throw err;
    }
  };
  const kept = fs.readdirSync(path.join(home, "codex"), { recursive: true, encoding: "utf8" }).filter(has);
  expect(kept).toEqual([]);
  expect(fs.existsSync(path.join(home, "codex", "auth.json"))).toBe(false);
});

// (alone: the fake refuses the next renewal of any ChatGPT sign-in)
test("codex: an access token the backend refuses has Codex ask Montroop's sign-in for a fresh one", async () => {
  const t = tag();
  const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
  const since = new Date().toISOString();
  await fake.next(t + ": work", { what: "error", kind: "auth-expired", reset: 0 });

  expect((await hold(home, codex(home), t + ": work")).at(-1)?.ev).toEqual({ k: "end", ok: true, text: "ok" });
  const renewals = (await fake.seen("")).filter((x) => x.vendor === "auth.openai.com" && x.at >= since);
  expect(renewals.map((x) => x.path + " " + x.answer)).toEqual(["/oauth/token 401"]);
});

test.concurrent("codex: its brief is told again after Codex compacts its thread", async () => {
  const t = tag();
  const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
  // (Codex's own setting, in its home: it compacts past a thousand tokens)
  fs.mkdirSync(path.join(home, "codex"), { recursive: true });
  fs.writeFileSync(path.join(home, "codex", "config.toml"), "model_auto_compact_token_limit = 1000\n");
  const job = codex(home, { context: { kind: "native", resume: "", first: [], brief: "The brief " + t + "." } });
  await fake.next(t + ": work", { what: "tool", calls: [["exec_command", { cmd: "echo " + t + "-ran" }]] });

  const told = (await hold(home, job, t + ": work")).map((x) => x.ev);
  expect(told).toContainEqual({ k: "compacted" });
  expect(told.at(-1)).toEqual({ k: "end", ok: true, text: "ok" });
  expect((await fake.seen("Your task, as you were first given it:\n\nThe brief " + t + ".")).some((x) => x.model !== "")).toBe(true);
});

test.concurrent("codex: the owner's own instructions for Codex are in its request", async () => {
  const t = tag();
  const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
  const user = fs.mkdtempSync(path.join(os.tmpdir(), "user-"));
  fs.mkdirSync(path.join(user, ".codex"));
  fs.writeFileSync(path.join(user, ".codex", "AGENTS.md"), "Owner's rule " + t + ".\n");

  expect((await hold(home, codex(home), t + ": work", undefined, undefined, { HOME: user })).at(-1)?.ev).toEqual({ k: "end", ok: true, text: "ok" });
  expect(JSON.stringify(await fake.body(t + ": work"))).toContain("Owner's rule " + t + ".");
});

test.concurrent("codex: a message that comes in while its turn waits on the owner goes into that turn", async () => {
  const t = tag();
  const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
  await fake.next(t + ": work", { what: "tool", calls: [["exec_command", { cmd: "echo " + t + "-ran" }]] });

  const told = (await hold(home, codex(home), t + ": work", async (dir) => {
    const ask = await until("its ask", () => Hold.told(dir).find((x) => x.ev.k === "ask")?.ev);
    await tell(dir, { $: "say", id: t + "-1", text: t + " also this", answer: false });
    await until("the message heard", () => Hold.told(dir).some((x) => x.ev.k === "heard"));
    await tell(dir, { $: "answer", id: ask.k === "ask" ? ask.id : "", ok: true, note: "" });
  }, undefined, {}, { rules: EVERY })).map((x) => x.ev);
  expect(told.filter((e) => e.k === "turn")).toEqual([{ k: "turn", ok: true, text: "ok" }]);
  expect((await fake.seen(t + " also this")).some((x) => x.model !== "")).toBe(true);
});

test.concurrent("codex: a file change its own subagent makes reaches the gate as one its main thread makes", async () => {
  const t = tag();
  const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
  const job = codex(home);
  const file = path.join(String(job.cwd), "child-" + t + ".txt");
  const rules: Rule[] = [{ what: "Write a child's file", tools: "write", args: "child-" }];
  await fake.next("Message Type: NEW_TASK\nTask name: /root/writer_" + t, { what: "tool", calls: [["apply_patch", "*** Begin Patch\n*** Add File: " + file + "\n+x\n*** End Patch\n"]] });
  await fake.next(t + ": work", { what: "tool", calls: [["spawn_agent", { task_name: "writer_" + t, message: "Write the file." }]] });
  await fake.next('{"task_name":"/root/writer_' + t + '"}', { what: "tool", calls: [["wait_agent", { timeout_ms: 10000 }]] });

  const told = (await hold(home, job, t + ": work", (dir) => owner(dir, rules, () => false), undefined, {}, { rules })).map((x) => x.ev);
  expect(told.filter((e) => e.k === "ask").map((e) => e.k === "ask" && e.input.file_path)).toEqual([[file]]);
  expect(fs.existsSync(file)).toBe(false);
});

test.concurrent("codex: a call its own subagent waits to have approved leaves the owner's cards once Codex interrupts that subagent", async () => {
  const t = tag();
  const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
  const job = codex(home);
  const name = "/root/sleeper_" + t;
  await fake.next("Message Type: NEW_TASK\nTask name: " + name, { what: "tool", calls: [["exec_command", { cmd: "touch child.txt" }]] });
  await fake.next(t + ": work", { what: "tool", calls: [["spawn_agent", { task_name: "sleeper_" + t, message: "Make the file." }]] });
  await fake.next('{"task_name":"' + name + '"}', { what: "tool", calls: [["wait_agent", { timeout_ms: 3000 }]] });
  await fake.next('"timed_out":true', { what: "tool", calls: [["interrupt_agent", { target: name }]] });

  const since = new Date().toISOString();

  const told = (await hold(home, job, t + ": work", undefined, undefined, {}, { rules: EVERY })).map((x) => x.ev);
  const asked = told.flatMap((e) => (e.k === "ask" ? [e.id] : []));
  expect(asked).toHaveLength(1);
  expect(told).toContainEqual({ k: "dropped", id: asked[0] });
  expect(told.filter((e) => e.k === "turn")).toEqual([{ k: "turn", ok: true, text: "ok" }]);
  expect(fs.existsSync(path.join(String(job.cwd), "child.txt"))).toBe(false);
  expect((await fake.seen("Stopped.")).filter((x) => x.model !== "" && x.at >= since)).toEqual([]);
});

test.concurrent("codex: the owner's note to a call its own subagent made reaches the model", async () => {
  const t = tag();
  const home = signed(fs.mkdtempSync(path.join(os.tmpdir(), "home-")));
  const job = codex(home);
  const name = "/root/kid_" + t;
  await fake.next("Message Type: NEW_TASK\nTask name: " + name, { what: "tool", calls: [["exec_command", { cmd: "touch kid.txt" }]] });
  await fake.next(t + ": work", { what: "tool", calls: [["spawn_agent", { task_name: "kid_" + t, message: "Make the file." }]] });
  await fake.next('{"task_name":"' + name + '"}', { what: "tool", calls: [["wait_agent", { timeout_ms: 10000 }]] });

  const told = (await hold(home, job, t + ": work", (dir) => owner(dir, EVERY, () => true, {}, "kindly " + t), undefined, {}, { rules: EVERY })).map((x) => x.ev);
  expect(told.filter((e) => e.k === "ask")).toHaveLength(1);
  expect(fs.existsSync(path.join(String(job.cwd), "kid.txt"))).toBe(true);
  expect((await fake.seen("The user approved this with a note: “kindly " + t + "”")).some((x) => x.model !== "")).toBe(true);
});
