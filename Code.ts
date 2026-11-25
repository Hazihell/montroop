// Code
// ====
// The Claude Code driver: one Claude Code session in the job's folder, with
// its own tools, settings and compaction, resumed by its session id. Every
// tool call it makes passes the holder's gate first. It has two tools of
// Kunumy's: ask_owner, a question for the agent that waits for the answer,
// and report, the run's result. It runs until it has nothing left to do:
// no message waiting, no task in the background, no call parked.

import * as path from "node:path";
import type { CanUseTool, HookCallback, McpSdkServerConfigWithInstance, SDKMessage, SDKResultMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { Anthropic } from "./Anthropic.ts";
import { BIN } from "./Browser.ts";
import { ClaudeSub } from "./ClaudeSub.ts";
import type { Driver, End, Io } from "./Driver.ts";
import { get, list, str } from "./Json.ts";
import { Wire, type Ev } from "./Wire.ts";

const ENV = {
  CLAUDE_AGENT_SDK_CLIENT_APP              : "kunumy",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC : "1",
};

// it asks no one in it: the owner's answers come through the gate
const DISALLOWED = ["AskUserQuestion"];

// claude.ai's connectors left out; a project's AGENTS.md loaded beside any
// CLAUDE.md (by default it's skipped when one is found further up, as the
// account's own often is)
const SETTINGS = {
  disableClaudeAiConnectors : true,
  pluginConfigs             : { "cc-plugin-agents-md@builtin": { options: { instructionFiles: "claude-md-and-agents-md" } } },
};

export namespace Code {

  export const native: Driver = async (job, io) => {
    const sdk = await ClaudeSub.sdk();
    const env = Object.fromEntries(Object.entries(ClaudeSub.bare_env()).filter(([k]) => k !== "DISABLE_AUTO_COMPACT"));
    // the owner's notes to approved calls, told with their results
    const notes = new Map<string, string>();
    let id = job.resume;
    let tasks = 0;
    let gating = 0;
    let end: End = { ok: false, text: "Claude Code ended before its turn did." };

    // every call goes on to the gate (canUseTool), even one Claude Code
    // would let run by itself
    const pre: HookCallback = (input) => Promise.resolve(input.hook_event_name !== "PreToolUse" ? {} : { hookSpecificOutput: { hookEventName: "PreToolUse" as const, permissionDecision: "ask" as const } });
    const post: HookCallback = (input) => {
      const note = input.hook_event_name === "PostToolUse" ? notes.get(input.tool_use_id) : undefined;
      if (input.hook_event_name !== "PostToolUse" || note === undefined) {
        return Promise.resolve({});
      }
      notes.delete(input.tool_use_id);
      return Promise.resolve({ hookSpecificOutput: { hookEventName: "PostToolUse" as const, additionalContext: note } });
    };
    const can: CanUseTool = async (tool, input, { signal, toolUseID }) => {
      gating += 1;
      try {
        const args = tool === "Bash" ? { command: input.command } : input;
        const said = await io.gate({ id: toolUseID, tool: tool === "Bash" ? "shell" : tool, args, native: tool, input }, signal);
        if (said.ok && said.note !== "") {
          notes.set(toolUseID, said.note);
        }
        return said.ok ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: said.note };
      } finally {
        gating -= 1;
      }
    };
    async function* inbox(): AsyncGenerator<SDKUserMessage> {
      for (let text = await io.inbox.next(); text !== null; text = await io.inbox.next()) {
        yield { type: "user", message: { role: "user", content: Anthropic.content([text], []) as Exclude<SDKUserMessage["message"]["content"], string> }, parent_tool_use_id: null };
      }
    }

    const q = sdk.query({ prompt: inbox(), options: {
      cwd                        : job.cwd,
      model                      : job.model === "" ? undefined : job.model,
      pathToClaudeCodeExecutable : await ClaudeSub.bin_on_disk(),
      env                        : { ...env, ...ENV, CLAUDE_CONFIG_DIR: job.account, PATH: [path.join(job.dir, BIN), env.PATH].filter((p) => p !== undefined).join(path.delimiter) },
      systemPrompt               : { type: "preset", preset: "claude_code", append: job.own },
      tools                      : { type: "preset", preset: "claude_code" },
      settingSources             : ["user", "project", "local"],
      permissionMode             : "default",
      disallowedTools            : DISALLOWED,
      settings                   : SETTINGS,
      mcpServers                 : { kunumy: tools(io, sdk) },
      resume                     : id === "" ? undefined : id,
      canUseTool                 : can,
      hooks                      : {
        PreToolUse  : [{ hooks: [pre], onFailure: "block" }],
        PostToolUse : [{ hooks: [post] }],
      },
    } });
    for await (const msg of q) {
      if (msg.type === "system" && msg.subtype === "init" && msg.session_id !== id) {
        id = msg.session_id;
        io.emit({ k: "began", sdk: id });
      }
      if (msg.type === "system" && msg.subtype === "background_tasks_changed") {
        tasks = msg.tasks.filter((t) => t.ambient !== true).length;
      }
      told_of(msg).forEach(io.emit);
      if (msg.type === "result") {
        end = outcome(msg);
        if (!io.inbox.pending() && tasks === 0 && gating === 0) {
          io.inbox.close();
        }
      }
    }
    return end;
  };

  function tools(io: Io, sdk: Awaited<ReturnType<typeof ClaudeSub.sdk>>): McpSdkServerConfigWithInstance {
    const said = (text: string) => ({ content: [{ type: "text" as const, text }] });
    return sdk.createSdkMcpServer({ name: "kunumy", alwaysLoad: true, tools: [
      sdk.tool("ask_owner", "Ask the agent that started this session a question, when you can't go on without its answer (a decision, missing information). The call waits for the answer, which can take a while; it comes back as this call's result.", { question: z.string() }, async ({ question }) => said("The answer: " + await io.ask(question))),
      sdk.tool("report", "Give your result to the agent that started this session, once, when you're done: what you did, where (branch, commits, files), how you checked it, what is left. Then end your turn.", { result: z.string() }, ({ result }) => {
        io.emit({ k: "report", text: result });
        return Promise.resolve(said("Reported. End your turn now."));
      }),
    ] });
  }

  function outcome(msg: SDKResultMessage): End {
    return { ok: msg.subtype === "success" && !msg.is_error, text: msg.subtype === "success" ? msg.result : msg.errors.join("; ") };
  }

  // a tool's input or result as text
  function shown(x: unknown): string {
    if (typeof x === "string") {
      return x;
    }
    const blocks = list(x).filter((b) => get(b, "type") === "text").map((b) => str(get(b, "text")) ?? "");
    return blocks.length > 0 ? blocks.join("\n") : JSON.stringify(x);
  }

  // what a message of Claude Code's tells the server (only the session's
  // own, not its subagents')
  function told_of(msg: SDKMessage): Ev[] {
    if (msg.type === "assistant" && msg.parent_tool_use_id === null) {
      return msg.message.content.flatMap((b): Ev[] =>
        b.type === "text" && b.text.trim() !== "" ? [{ k: "text", text: b.text }] :
        b.type === "tool_use" ? [{ k: "tool", id: b.id, name: b.name, input: Wire.clip(shown(b.input)) }] : []);
    }
    if (msg.type === "user" && msg.parent_tool_use_id === null && Array.isArray(msg.message.content)) {
      return msg.message.content.flatMap((b): Ev[] => (b.type === "tool_result" ? [{ k: "result", id: b.tool_use_id, text: Wire.clip(shown(b.content ?? "")), error: b.is_error === true }] : []));
    }
    if (msg.type === "system" && msg.subtype === "compact_boundary") {
      return [{ k: "compacted" }];
    }
    if (msg.type === "result") {
      return [{ k: "turn", ...outcome(msg) }];
    }
    return [];
  }

}
