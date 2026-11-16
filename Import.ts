import type { Kind } from "./AskAI.ts";
import { stream_lines, text_pages } from "./Clip.ts";
import { get, list, text_of } from "./Json.ts";

// result: a tool call's message holds its result too (#188), dated as its
// result, as a chat logs it; call: when the call was made
type Msg = { kind: Kind; text: string; date: string; result?: number; call?: string };

// a message's page as an import sends it: the server joins a message's
// pages again (Server.ts reads)
type Page = { kind: Kind; text: string; date: string; page?: boolean; result?: number };

// what an import sends of a message: all of it, or of a call imported
// alone before, its result alone
type Part = "all" | "result";

// a message as a chat or a log has it, before it is paired and paged; id:
// a tool call's, or the call's a result is for, where the log has them
type Said = { kind: Kind; text: string; date: string; id?: string };

type Slot = { m: Said; echo: Said | null; open: boolean };

// sizes: its pages', all of it and its result alone (Part)
type Head = { kind: Kind; date: string; call?: string; sizes: Record<Part, number[]>; n: number };

export type Form = "log" | "msgs";

// last: the date of the last message imported of it, once planned
export type Session = { app: string; form: Form; where: string; start: string; file: Blob; heads: Head[]; last?: string };

export type Done = Record<string, string>;

export type Want = { off: string[]; since: string; tools: boolean };

export type Plan = { sessions: Session[]; picked: Session[]; msgs: number; first: string; sizes: number[] };

type Node = { bytes: number; depth: number };

const NODE = 512;

const LINE = 480;

const COMPACTION_MICRO_USD_FIT = { base: 187, per_source_doubling: 735, per_summary_under: 628 };

const PIECE_KEPT_AS_BLOB = 2 ** 20;

export const OLD = "Nothing new: these chats are in this agent's memory already.";

const NOT_EXPORT = "Not a Claude or ChatGPT export.";

export const MIDWAY = "Meanwhile, this agent can answer with a partial tree.";

export const DONE = "Your past chats are in this agent's memory: ask about them any time.";

const DAY   = new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric" });
const COUNT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 0 });

export const EXPORTS: Record<string, string> = { Claude: "Settings › Privacy › Export data", ChatGPT: "Settings › Data controls › Export data" };

const INJECTED = /^(<[a-z_]+[ >]|# AGENTS\.md)/;

const SKIP = /^(<command-|<local-command|\[Request interrupted)/;

type Block = { type?: string; text?: unknown; name?: string; input?: unknown; content?: unknown; id?: unknown; tool_use_id?: unknown };

type GptMsg = { author?: { role?: string }; recipient?: string; content?: { content_type?: string; parts?: unknown[]; text?: unknown }; metadata?: { is_visually_hidden_from_conversation?: boolean }; create_time?: unknown };

type Chat = {
  mapping?       : Record<string, { parent?: string; message?: GptMsg | null } | undefined>;
  current_node?  : string;
  create_time?   : unknown;
  chat_messages? : { created_at?: unknown; sender?: string; content?: unknown; text?: unknown; attachments?: { file_name?: string }[]; files?: { file_name?: string }[] }[];
  created_at?    : unknown;
  title?         : string;
  name?          : string;
};

type Codex = { type?: string; role?: string; content?: { text?: string }[]; name?: string; arguments?: string; input?: unknown; action?: { command?: unknown }; output?: unknown; call_id?: unknown; source?: { subagent?: unknown; internal?: unknown }; cwd?: unknown };

type Line = {
  type?             : string;
  timestamp?        : unknown;
  isMeta?           : boolean;
  isSidechain?      : boolean;
  isCompactSummary? : boolean;
  message?          : { content?: unknown };
  cwd?              : string;
  attachment?       : { type?: string; prompt?: unknown };
  payload?          : Codex;
};

export function import_file(path: string): boolean {
  const session = /(^|\/)(projects|sessions|archived_sessions)\//.test(path);
  return session && path.endsWith(".jsonl") && !path.includes("subagents/");
}

export async function import_session(file: Blob, form: Form, app = "", where = ""): Promise<Session | null> {
  const s: Session = { app, form, where, start: "", file, heads: [] };
  for await (const m of import_read(s)) {
    const sizes = { all: msg_pages(m, "all").map(import_size), result: m.call === undefined ? [] : msg_pages(m, "result").map(import_size) };
    s.heads.push({ kind: m.kind, date: m.date, ...(m.call === undefined ? {} : { call: m.call }), sizes, n: s.heads.length });
  }
  s.start = s.heads[0]?.call ?? s.heads[0]?.date ?? "";
  return s.heads.length > 0 ? s : null;
}

async function* import_read(s: Session): AsyncGenerator<Msg> {
  let date = "";
  const slots: Slot[] = [];
  for await (const lines of stream_lines(s.file.stream())) {
    for (const line of lines) {
      const said = line_msgs(s, line, date);
      date = said.at(-1)?.date ?? date;
      yield* said.flatMap((m) => slots_add(slots, m));
    }
  }
  yield* slots_take(slots, true);
}

// a tool call waits for its result, found by id where the log has ids,
// else the next result; anything else ends the wait of the calls before it
function slots_add(slots: Slot[], m: Said): Msg[] {
  const slot = m.kind === "echo" ? slots.find((x) => x.open && x.echo === null && (m.id === undefined || x.m.id === m.id)) : undefined;
  if (slot !== undefined) {
    slot.echo = m;
    slot.open = false;
  } else {
    slots.forEach((x) => (x.open &&= m.kind === "tool" || m.kind === "echo"));
    slots.push({ m, echo: null, open: m.kind === "tool" });
  }
  return slots_take(slots, false);
}

function slots_take(slots: Slot[], all: boolean): Msg[] {
  const out: Msg[] = [];
  while (slots.length > 0 && (all || !slots[0].open)) {
    const { m, echo } = slots.shift() as Slot;
    out.push(echo === null ? { kind: m.kind, text: m.text, date: m.date } : { kind: "tool", text: m.text + "\n" + echo.text, date: echo.date, result: m.text.length, call: m.date });
  }
  return out;
}

function line_log(s: Session, j: Line, last: string): Said[] {
  s.app ||= j.type === "session_meta" ? "ChatGPT" : "Claude";
  return s.app === "ChatGPT" ? line_codex(s, j, last) : line_claude(s, j, last);
}

function line_msgs(s: Session, line: string, last: string): Said[] {
  try {
    const j: unknown = JSON.parse(line);
    return s.form === "msgs" ? [j as Said] : line_log(s, j as Line, last);
  } catch {
    return [];
  }
}

function import_pick(sessions: Session[], want: Want, done: Done): Session[] {
  const old  = [...sessions].sort((a, b) => a.start.localeCompare(b.start));
  const keep = (m: Head, last?: string) => (want.tools || m.kind === "user" || m.kind === "reply") && m.date >= want.since && import_part(m, last) !== null;
  const last = (s: Session) => done[import_id(s)] ?? s.last;
  return old.map((s) => ({ ...s, heads: s.heads.filter((m) => keep(m, last(s))), last: last(s) })).filter((s) => s.heads.length > 0);
}

export function import_plan(sessions: Session[], want: Want, done: Done): Plan {
  const all    = import_pick(sessions, { ...want, since: "" }, done);
  const shown  = import_pick(all, want, {});
  const picked = shown.filter((s) => !want.off.includes(import_id(s)));
  const first  = all.map((s) => s.heads[0].date).sort()[0] ?? "";
  const sizes  = picked.flatMap((s) => [import_size(import_note(s)), ...s.heads.flatMap((m) => m.sizes[import_part(m, s.last) ?? "all"])]);
  return { sessions: shown, picked, msgs: sizes.length - picked.length, first: first.slice(0, 10), sizes };
}

export function import_new(m: { date?: string }, last: string | undefined): boolean {
  return last === undefined || (m.date ?? "") > last;
}

// none of it if imported already; its result alone if the call was, alone,
// before its result came (Part)
function import_part(m: { date: string; call?: string }, last: string | undefined): Part | null {
  return !import_new(m, last) ? null : m.call !== undefined && !import_new({ date: m.call }, last) ? "result" : "all";
}

function import_name(s: Session): string {
  return s.app + " " + s.where + ", from " + new Date(s.start).toLocaleString("sv-SE").slice(0, 16);
}

export function import_cells(s: Session): string[] {
  const day   = DAY.format(new Date(s.start));
  const where = s.where.startsWith("session in ") ? path_short(s.where.slice(11)) : s.where.replace(/^chat "(.*)"$/, "$1") || "untitled";
  return [day, count_short(s.heads.length), where];
}

function count_short(n: number): string {
  return COUNT.format(n).toLowerCase();
}

function path_short(path: string): string {
  const parts = path.replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, "~").split("/");
  const head  = parts[0] === "" ? 2 : 1;
  return parts.length - head > 3 ? [...parts.slice(0, head + 1), "…", ...parts.slice(-2)].join("/") : parts.join("/");
}

function import_note(s: Session): Msg {
  return { kind: "note", text: import_name(s) + " (imported)", date: s.start };
}

export function import_id(s: Session): string {
  return import_key(import_note(s));
}

export function import_key(note: { text: string; date?: string }): string {
  return note.date + " " + without_local_time(without_app(note.text));
}

function without_app(name: string): string {
  return name.replace(/^.*?(?= session in | chat ")/, "");
}

function without_local_time(name: string): string {
  return name.replace(/, from [^,]*$/, "");
}

export async function* import_body(picked: Session[]): AsyncGenerator<string> {
  let part = "";
  for (const s of picked) {
    const kept = new Set(s.heads.map((m) => m.n));
    let n = 0;
    part += JSON.stringify(import_note(s)) + "\n";
    for await (const m of import_read(s)) {
      const what = kept.has(n++) ? import_part(m, s.last) : null;
      part += what === null ? "" : msg_pages(m, what).map((page) => JSON.stringify(page) + "\n").join("");
      if (part.length >= PIECE_KEPT_AS_BLOB) {
        yield part;
        part = "";
      }
    }
  }
  yield part;
}

export function import_guess(a: number, sizes: number[]): number[][] {
  const usd: number[][] = [];
  let nodes: Node[] = sizes.map((bytes) => ({ bytes, depth: 0 }));
  for (let l = 0, i = a; nodes.length > 0; l++, i = Math.floor(i / 2)) {
    usd.push(nodes.map(node_usd));
    const line = (k: number) => (k < 0 ? { bytes: LINE, depth: l } : node_line(nodes[k]));
    const from = Math.floor(i / 2);
    nodes = Array.from({ length: Math.floor((i + nodes.length) / 2) - from }, (_, j) => node_merge(line(2 * (from + j) - i), line(2 * (from + j) + 1 - i)));
  }
  return usd;
}

function import_size(m: { kind: Kind; text: string }): number {
  return new TextEncoder().encode(m.kind + ": " + m.text).length;
}

export function import_count(n: number, what: string): string {
  return n.toLocaleString("en-US") + " " + what + (n === 1 ? "message" : "messages");
}

function node_usd(node: Node): number {
  if (node.bytes <= NODE) {
    return 0;
  }
  const fit = COMPACTION_MICRO_USD_FIT;
  return Math.round(fit.base + fit.per_source_doubling * Math.log2(node.bytes / NODE) + fit.per_summary_under * (node.depth + 1));
}

function node_line(node: Node): Node {
  return node.bytes > NODE ? { bytes: LINE, depth: node.depth + 1 } : { bytes: node.bytes, depth: 0 };
}

function node_merge(a: Node, b: Node): Node {
  return { bytes: a.bytes + 1 + b.bytes, depth: Math.max(a.depth, b.depth) };
}

export async function import_export(file: Blob): Promise<Session[]> {
  const zip  = (await file.slice(0, 2).text()) === "PK";
  const json = zip ? await zip_file(file, "conversations.json") : file;
  if (json === null) {
    throw new Error("No conversations.json in the zip.");
  }
  const chats: unknown = await json.text().then((text) => JSON.parse(text) as unknown).catch(() => null);
  if (!Array.isArray(chats) || !chats.every((chat: unknown) => get(chat, "mapping") !== undefined || Array.isArray(get(chat, "chat_messages")))) {
    throw new Error(NOT_EXPORT);
  }
  const sessions = await Promise.all(list(chats).map((chat) => chat_session(chat as Chat)));
  return sessions.filter((s) => s !== null);
}

function chat_session(chat: Chat): Promise<Session | null> {
  const [app, msgs] = chat.mapping ? ["ChatGPT", chat_openai(chat, chat.mapping)] : ["Claude", chat_claude(chat)];
  const file = new Blob(msgs.map((m) => JSON.stringify(m) + "\n"));
  return import_session(file, "msgs", app, 'chat "' + (chat.title ?? chat.name ?? "") + '"');
}

// a ChatGPT chat's messages: its thread shown, current_node up to the
// root (an edit or a retry leaves its old branch); a person's say,
// ChatGPT's, what it sent a tool (recipient) as a call, a tool's output
// as an echo; never thoughts, nor a hidden one
function chat_openai(chat: Chat, mapping: NonNullable<Chat["mapping"]>): Said[] {
  const nodes: (GptMsg | null | undefined)[] = [];
  for (let id = chat.current_node; id; id = mapping[id]?.parent) {
    nodes.unshift(mapping[id]?.message);
  }
  let date = import_date(chat.create_time, "");
  return nodes.flatMap((m) => {
    if (m === null || m === undefined) {
      return [];
    }
    const role = m.author?.role;
    const type = String(m.content?.content_type);
    const kind = role === "user" ? "user" : role === "assistant" ? (m.recipient === "all" ? "reply" : "tool") : role === "tool" ? "echo" : null;
    const skip = kind === null || m.metadata?.is_visually_hidden_from_conversation === true || type === "thoughts" || type === "reasoning_recap";
    date = import_date(m.create_time, date);
    return skip ? [] : said_of(kind, (kind === "tool" ? String(m.recipient) + " " : "") + parts_text(m.content?.parts ?? [m.content?.text]), date);
  });
}

function chat_claude(chat: Chat): Said[] {
  let date = import_date(chat.created_at, "");
  return (chat.chat_messages ?? []).flatMap((m) => {
    date = import_date(m.created_at, date);
    const kind   = m.sender === "human" ? "user" : "reply";
    const blocks: Block[] = Array.isArray(m.content) ? (m.content as Block[]) : [{ type: "text", text: text_of(m.text) }];
    const files  = [...(m.attachments ?? []), ...(m.files ?? [])].map((f) => ({ type: "text", text: "[file " + String(f.file_name) + "]" }));
    return blocks_said(kind, [...blocks, ...files], date);
  });
}

async function zip_file(zip: Blob, name: string): Promise<Blob | null> {
  const view = async (at: number, n: number) => new DataView(await zip.slice(at, at + n).arrayBuffer());
  const back = Math.min(zip.size, 65577);
  const tail = await view(zip.size - back, back);
  let end = tail.byteLength - 22;
  while (end >= 0 && tail.getUint32(end, true) !== 0x06054b50) {
    end -= 1;
  }
  if (end < 0) {
    return null;
  }
  const wide = end >= 20 && tail.getUint32(end - 20, true) === 0x07064b50;
  const z64  = wide ? await view(Number(tail.getBigUint64(end - 12, true)), 56) : null;
  const count = z64 === null ? tail.getUint16(end + 10, true) : Number(z64.getBigUint64(32, true));
  const size  = z64 === null ? tail.getUint32(end + 12, true) : Number(z64.getBigUint64(40, true));
  const from  = z64 === null ? tail.getUint32(end + 16, true) : Number(z64.getBigUint64(48, true));
  const dir   = await view(from, size);
  for (let p = 0, k = 0; k < count; k++) {
    const entry = new TextDecoder().decode(new Uint8Array(dir.buffer, p + 46, dir.getUint16(p + 28, true)));
    const [, packed, at] = zip_sizes(dir, p);
    if (entry === name || entry.endsWith("/" + name)) {
      const head = await view(at, 30);
      const data = zip.slice(at + 30 + head.getUint16(26, true) + head.getUint16(28, true)).slice(0, packed);
      return dir.getUint16(p + 10, true) === 8 ? new Response(data.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob() : data;
    }
    p += 46 + dir.getUint16(p + 28, true) + dir.getUint16(p + 30, true) + dir.getUint16(p + 32, true);
  }
  return null;
}

// a directory entry's size, size packed and local header's place, each
// as its 32 bits say; one too large for them reads 0xFFFFFFFF, its value
// in the entry's ZIP64 extra field (id 1), which holds only those, in
// this order
function zip_sizes(dir: DataView, p: number): number[] {
  const short = [p + 24, p + 20, p + 42].map((at) => dir.getUint32(at, true));
  const extra = p + 46 + dir.getUint16(p + 28, true);
  let x = extra;
  while (x + 4 <= extra + dir.getUint16(p + 30, true) && dir.getUint16(x, true) !== 1) {
    x += 4 + dir.getUint16(x + 2, true);
  }
  let k = 0;
  return short.map((n) => (n === 0xffffffff ? Number(dir.getBigUint64(x + 4 + 8 * k++, true)) : n));
}

function line_claude(s: Session, j: Line, last: string): Said[] {
  const date = import_date(j.timestamp, last);
  const own  = (j.type === "user" || j.type === "assistant") && !j.isMeta && !j.isSidechain && !j.isCompactSummary;
  const content = j.message?.content;
  const blocks: Block[] = !own ? [] : typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? (content as Block[]) : [];
  s.where ||= j.cwd ? "session in " + j.cwd : "";
  if (j.type === "attachment" && j.attachment?.type === "queued_command") {
    return said_of("user", text_of(j.attachment.prompt), date);
  }
  return blocks_said(j.type === "user" ? "user" : "reply", blocks, date);
}

function blocks_said(kind: Kind, blocks: Block[], date: string): Said[] {
  const say   = blocks.filter((b) => b.type === "image" || (b.type === "text" && !SKIP.test(String(b.text))));
  const tools = blocks.flatMap((b) => b.type === "tool_use" ? said_of("tool", String(b.name) + " " + JSON.stringify(b.input), date, b.id) : b.type === "tool_result" ? said_of("echo", parts_text(b.content), date, b.tool_use_id) : []);
  return [...said_of(kind, parts_text(say), date), ...tools];
}

function line_codex(s: Session, j: Line, last: string): Said[] {
  const p    = j.payload ?? {};
  const date = import_date(j.timestamp, last);
  if (j.type === "session_meta") {
    s.where = (p.source?.subagent ?? p.source?.internal) ? "" : "session in " + text_of(p.cwd);
  }
  return j.type === "response_item" && s.where !== "" ? item_codex(p, date) : [];
}

function item_codex(p: Codex, date: string): Said[] {
  switch (p.type) {
    case "message": {
      const kind  = p.role === "user" ? "user" : p.role === "assistant" ? "reply" : null;
      const parts = (p.content ?? []).filter((c) => !INJECTED.test(c.text ?? ""));
      return kind === null ? [] : said_of(kind, parts_text(parts), date);
    }
    case "function_call": {
      return said_of("tool", String(p.name) + " " + String(p.arguments), date, p.call_id);
    }
    case "custom_tool_call": {
      return said_of("tool", String(p.name) + " " + JSON.stringify({ input: p.input }), date, p.call_id);
    }
    case "local_shell_call": {
      return said_of("tool", "shell " + JSON.stringify({ command: p.action?.command }), date, p.call_id);
    }
    case "function_call_output":
    case "custom_tool_call_output": {
      return said_of("echo", parts_text(p.output), date, p.call_id);
    }
  }
  return [];
}

function import_date(at: unknown, last: string): string {
  const ms = typeof at === "number" ? at * 1000 : Date.parse(String(at));
  return Number.isNaN(ms) ? last : new Date(ms).toISOString();
}

function said_of(kind: Kind, text: string, date: string, id?: unknown): Said[] {
  return text.trim() === "" ? [] : [{ kind, text, date, ...(typeof id === "string" ? { id } : {}) }];
}

// its pages as the server makes them (Memory.pages), each a line of the
// import whatever its size
function msg_pages(m: Msg, part: Part): Page[] {
  const alone = part === "result" && m.result !== undefined;
  const kind = alone ? "echo" : m.kind;
  const text = alone && m.result !== undefined ? m.text.slice(m.result + 1) : m.text;
  const result = alone ? undefined : m.result;
  const pages = text_pages(text, kind, result);
  return pages.map((page, k) => ({ kind, text: page, date: m.date, ...(k > 0 ? { page: true } : {}), ...(k === 0 && result !== undefined ? { result } : {}) }));
}

function parts_text(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  return list(content).map((c) => {
    const text = get(c, "text");
    return typeof c === "string" ? c : typeof text === "string" ? text : String(get(c, "type") ?? get(c, "content_type")).includes("image") ? "[image]" : "";
  }).join("\n");
}
