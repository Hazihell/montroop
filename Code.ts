// Code
// ====
// The Claude Code driver: one Claude Code session in the job's folder, with
// its own tools, settings and compaction, resumed by its session id. Every
// tool call it makes passes the holder's gate first. Kunumy's tools
// (job.tools) are an in-process MCP server whose calls go to io.call. It
// runs until it has nothing left to do: no message waiting, no task in the
// background, no call parked.

import * as path from "node:path";
import type { CanUseTool, HookCallback, McpSdkServerConfigWithInstance, SDKMessage, SDKResultMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { Anthropic } from "./Anthropic.ts";
import { BIN } from "./Browser.ts";
import { ClaudeSub } from "./ClaudeSub.ts";
import type { Out } from "./Agent.ts";
import type { Call, Driver, End, Io, Job } from "./Driver.ts";
import { get, list, rec, str } from "./Json.ts";
import { Wire, type Ev } from "./Wire.ts";

const ENV = {
  CLAUDE_AGENT_SDK_CLIENT_APP              : "kunumy",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC : "1",
};

// it asks no one in it: the owner's answers come through the gate
const DISALLOWED = ["AskUserQuestion"];

// what its MCP server's tools are named, for the model, before their own
// names; io.call gates them on the holder's side
const KUNUMY = "mcp__kunumy__";

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
    let id = job.context.resume;
    let tasks = 0;
    let gating = 0;
    let end: End = { ok: false, text: "Claude Code ended before its turn did." };

    // a call a rule names goes on to the gate (canUseTool), even one
    // Claude Code would let run by itself; the rest as Claude Code's own
    // settings say
    const pre: HookCallback = (input) => Promise.resolve(input.hook_event_name !== "PreToolUse" || input.tool_name.startsWith(KUNUMY) || !io.parks(call_of(input.tool_name, rec(input.tool_input) ? input.tool_input : {}, input.tool_use_id)) ? {} : { hookSpecificOutput: { hookEventName: "PreToolUse" as const, permissionDecision: "ask" as const } });
    const post: HookCallback = (input) => {
      const note = input.hook_event_name === "PostToolUse" ? notes.get(input.tool_use_id) : undefined;
      if (input.hook_event_name !== "PostToolUse" || note === undefined) {
        return Promise.resolve({});
      }
      notes.delete(input.tool_use_id);
      return Promise.resolve({ hookSpecificOutput: { hookEventName: "PostToolUse" as const, additionalContext: note } });
    };
    const can: CanUseTool = async (tool, input, { signal, toolUseID }) => {
      if (tool.startsWith(KUNUMY)) {
        return { behavior: "allow", updatedInput: input };
      }
      gating += 1;
      try {
        const said = await io.gate(call_of(tool, input, toolUseID), signal);
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
      env                        : { ...env, ...ENV, CLAUDE_CONFIG_DIR: job.account.dir, PATH: [path.join(job.dir, BIN), env.PATH].filter((p) => p !== undefined).join(path.delimiter) },
      systemPrompt               : { type: "preset", preset: "claude_code", append: job.own },
      tools                      : { type: "preset", preset: "claude_code" },
      settingSources             : ["user", "project", "local"],
      permissionMode             : "default",
      disallowedTools            : DISALLOWED,
      settings                   : SETTINGS,
      mcpServers                 : { kunumy: tools(job, io, sdk) },
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

  // interim: item 4 of the one-engine plan replaces this file's Kunumy
  // server with its own Code.ts
  function tools(job: Job, io: Io, sdk: Awaited<ReturnType<typeof ClaudeSub.sdk>>): McpSdkServerConfigWithInstance {
    // a tool whose schema zod can't read is left out
    return sdk.createSdkMcpServer({ name: "kunumy", alwaysLoad: true, tools: job.tools.flatMap((t) => {
      let shape: z.ZodRawShape;
      try {
        shape = (z.fromJSONSchema(t.schema as Parameters<typeof z.fromJSONSchema>[0]) as z.ZodObject).shape;
      } catch {
        return [];
      }
      return [sdk.tool(t.name, t.info, shape, async (args: Record<string, unknown>, extra) => result(await io.call({ id: use_of(extra), tool: t.name, args, native: KUNUMY + t.name, input: args })))];
    }) });
  }

  // the tool use a call of its MCP server's answers
  function use_of(extra: unknown): string {
    return str(get(get(extra, "_meta"), "claudecode/toolUseId")) ?? crypto.randomUUID();
  }

  function result(out: Out) {
    return { content: [{ type: "text" as const, text: out.text }, ...(out.imgs ?? []).map((img) => ({ type: "image" as const, data: img.data, mimeType: img.type }))], isError: out.fail };
  }

  // a call as the rules name it: Bash is shell, with its command
  function call_of(tool: string, input: Record<string, unknown>, id: string): Call {
    return { id, tool: tool === "Bash" ? "shell" : tool, args: tool === "Bash" ? { command: input.command } : input, native: tool, input };
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
