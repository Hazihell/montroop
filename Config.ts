import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Vendor } from "./AskAI.ts";
import { err_code, err_why } from "./Err.ts";
import { get, list as items, rec, text_of } from "./Json.ts";
import { LABELS, VENDORS, Pick, type Fall, type Offer } from "./Pick.ts";
import { Rules, type Rule } from "./Rules.ts";
import { install_cmd } from "./Update.ts";
import { write_whole } from "./Write.ts";

type ServerOnly = "runs a command";

export type Setting = { key: string; def: string; server_only: ServerOnly | null };

export type From = "env" | "file" | "default";

type Made = {
  offer     : Offer;
  pick      : Pick;
  compactor : Pick;
  context   : number;
  after     : string;
  hops      : number;
  thinking  : boolean;
  off       : string[];
  ask       : Rule[];
};

export type McpServer = {
  name    : string;
  device  : string;
  command : string;
  args    : string[];
  env     : Record<string, string>;
  cwd     : string;
  url     : string;
  headers : Record<string, string>;
  timeout : number;
};

export const DIR = config_path(process.env.KI_DIR ?? "~/.ki");

export const FILE_PATH = DIR + "/config.json";

// the data's layout, as release/upgrade.js writes it
export const LAYOUT     = DIR + "/layout";
export const LAYOUT_NOW = 47;

// the fixed prompts' files, which the installer writes
export const SHARE = process.platform === "win32" ? (process.env.LOCALAPPDATA ?? os.homedir() + "\\AppData\\Local") + "\\ki" : (process.env.XDG_DATA_HOME || os.homedir() + "/.local/share") + "/ki";
export const KEYS_PATH = DIR + "/keys.json";

export const SETTINGS: Setting[] = [
  { key: "vendors",   def: "claude-api",                        server_only: null },
  { key: "models",    def: LABELS.join(),                       server_only: null },
  { key: "pick",      def: "claude-api:sonnet-5.5:medium:slow", server_only: null },
  { key: "compactor", def: "claude-api:sonnet-5.5:medium:slow", server_only: null },
  { key: "compactor_context", def: "4",                         server_only: null },
  { key: "hops",      def: "4",                                 server_only: null },
  { key: "thinking",  def: "off",                               server_only: null },
  { key: "after",     def: "",                                  server_only: "runs a command" },
];

const USABLE: Record<Vendor, string> = {
  "claude-sub" : "signed in to Claude",
  "openai-sub" : "signed in to ChatGPT",
  "claude-api" : "Anthropic key set",
  "openai-api" : "OpenAI key set",
};
const DEFAULT_MODEL: Record<Vendor, string> = {
  "claude-sub" : "sonnet-5.5",
  "openai-sub" : "gpt-6.2-sol",
  "claude-api" : "sonnet-5.5",
  "openai-api" : "gpt-6.2-sol",
};

const NONE     = "Not signed in and no API key: sign in with `ki serve claude login` (or `ki serve chatgpt login`) on the server, or set a key in Settings";
const NONE_WHY = "not signed in, no key";

export const VARS: Record<string, string> = {
  anthropic       : "ANTHROPIC_API_KEY",
  openai          : "OPENAI_API_KEY",
};

const FILE: Record<string, unknown> = config_file();

export const CHATGPT    = config_path(config_get("chatgpt", DIR + "/chatgpt.json"));

export const CLAUDE_SUB = config_path(config_get("claude_sub", DIR + "/claude-sub"));

// the Claude account an agent takes unless set to another: CLAUDE_SUB's
export const PERSONAL = "personal";

// another Claude account's name, its sign-in in DIR/claude-<name>: a
// letter in it, so Claude Code's own claude-<uid> under DIR is none
const ACCOUNT = /^(?!sub$)(?=[a-z0-9-]*[a-z])[a-z0-9][a-z0-9-]{0,23}$/;
export const CLAUDE     = config_path(config_get("claude", ""));

const ENV_KEYS: Record<string, string> = Object.fromEntries(Object.entries(VARS).map(([name, v]) => [name, config_key(v)]));
export const KEYS: Record<string, string> = config_keys(keys_read());

let FOLLOWED = config_usable().join();

let KEPT: string[] = [];

export const RELOADED = new Set<() => void>();

const MADE = config_start();

export const OFFER: Offer = MADE.offer;

export let   AFTER      = MADE.after;
export let   HOPS       = MADE.hops;
export let   THINKING   = MADE.thinking;
export let   PICK       = MADE.pick;

export let   COMPACTOR  = MADE.compactor;
export let   COMPACTOR_CONTEXT = MADE.context;
// the MCP servers switched off in Settings, for every agent (config.json's mcp_off)
export let   MCP_OFF    = MADE.off;
export let   ASK        = MADE.ask;


export const MEDIA_MAX  = (Number(config_get("media_mb", "")) || 1024) * 2 ** 20;

const MCP_VAR = config_env_taken("KI_MCP");
export const MCP_ENV_NOTE: string | null = config_mcp_some(MCP_VAR)
  ? "KI_MCP is set, but ki serve runs no MCP servers, so they are left out: put them in the mcp of a device's own ~/.ki/config.json (for this computer, run ki device beside the server)."
  : null;
export const MCP_FILE_STARTUP_NOTE: string | null = config_mcp_some(FILE.mcp)
  ? "ki serve runs no MCP servers: the mcp in " + FILE_PATH + " runs only on a ki device that reads this file (ki device beside the server)."
  : null;

function config_env_taken(name: string): string | undefined {
  const value = process.env[name];
  delete process.env[name];
  return value;
}

export function config_value(file: Record<string, unknown>, key: string): string {
  return config_env_value(key) ?? config_str(file[key]) ?? config_default(file, key).value;
}

export function config_default(file: Record<string, unknown>, key: string): { value: string; why: string } {
  const def = SETTINGS.find((s) => s.key === key)?.def ?? "";
  if (key !== "vendors" && key !== "pick" && key !== "compactor") {
    return { value: def, why: "" };
  }
  return key === "vendors" ? config_default_vendors(file, def, config_usable()) : config_default_pick(file, def, config_usable());
}

function config_default_vendors(file: Record<string, unknown>, def: string, usable: Vendor[]): { value: string; why: string } {
  const named = config_named(file).filter((v) => !usable.includes(v));
  const whys = [...usable.map((v) => USABLE[v]), ...(named.length === 0 ? [] : [named.join(", ") + " chosen"])];
  return usable.length + named.length === 0 ? { value: def, why: NONE_WHY } : { value: [...usable, ...named].join(), why: whys.join(", ") };
}

function config_default_pick(file: Record<string, unknown>, def: string, usable: Vendor[]): { value: string; why: string } {
  const offered = config_value(file, "vendors").split(",").map((v) => v.trim());
  const models = config_value(file, "models").split(",").map((m) => m.trim());
  const model = (v: Vendor) => (models.includes(DEFAULT_MODEL[v]) ? DEFAULT_MODEL[v] : Pick.models([v], models)[0]?.[1].label);
  const order = [...usable, ...VENDORS.filter((v) => !usable.includes(v))].filter((v) => offered.includes(v));
  const vendor = order.find((v) => model(v) !== undefined);
  if (vendor === undefined) {
    return { value: def, why: "" };
  }
  const why = usable.includes(vendor) ? USABLE[vendor] : usable.length === 0 ? NONE_WHY : vendor + " has no sign-in or key here";
  return { value: vendor + ":" + model(vendor) + ":medium:slow", why };
}

function config_named(file: Record<string, unknown>): Vendor[] {
  const set = ["pick", "compactor"].map((key) => config_env_value(key) ?? config_str(file[key]) ?? "");
  let profiles: unknown = file.profiles;
  try {
    profiles = process.env.KI_PROFILES === undefined ? profiles : JSON.parse(process.env.KI_PROFILES);
  } catch {
    profiles = null;
  }
  const lists = typeof profiles === "object" && profiles !== null ? Object.values(profiles) : [];
  const falls = lists.flatMap((list: unknown) => (Array.isArray(list) ? list.map(String) : []));
  const named = [...set, ...falls].map((text) => text.split(":")[0].trim());
  return VENDORS.filter((v) => named.includes(v) || KEPT.includes(v));
}

export function config_keep(vendors: string[]): void {
  if (vendors.join() === KEPT.join()) {
    return;
  }
  KEPT = vendors;
  try {
    config_reload();
  } catch (err) {
    console.error("ki: " + (err instanceof Error ? err.message : String(err)));
  }
}

// the vendors that can be asked here, in the order a default takes
// them: claude-sub signed in, openai-sub signed in, claude-api and
// openai-api with a key. Claude Code keeps its sign-in in its config dir:
// .credentials.json, or (macOS, in the keychain) only its account in
// .claude.json
function config_usable(): Vendor[] {
  const claude = claude_signed(CLAUDE_SUB) || claude_accounts().length > 1;
  const chatgpt = typeof config_field(CHATGPT, "tokens", "refresh_token") === "string";
  const has: Record<Vendor, boolean> = { "claude-sub": claude, "openai-sub": chatgpt, "claude-api": KEYS.anthropic !== "", "openai-api": KEYS.openai !== "" };
  return (Object.keys(USABLE) as Vendor[]).filter((v) => has[v]);
}

function config_field(file: string, ...keys: string[]): unknown {
  let at: unknown;
  try {
    at = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
  for (const key of keys) {
    at = typeof at === "object" && at !== null ? (at as Record<string, unknown>)[key] : undefined;
  }
  return at;
}

function claude_signed(dir: string): boolean {
  return config_field(dir + "/.credentials.json", "claudeAiOauth") != null || config_field(dir + "/.claude.json", "oauthAccount") != null;
}

// a Claude account's sign-in folder ("" or PERSONAL: CLAUDE_SUB)
export function claude_dir(account: string): string {
  if (account === "" || account === PERSONAL) {
    return CLAUDE_SUB;
  }
  if (!ACCOUNT.test(account)) {
    throw new Error("a Claude account's name is 1 to 24 lowercase letters, digits and dashes, with a letter, and not \"sub\": " + account);
  }
  return DIR + "/claude-" + account;
}

// personal and the other Claude accounts signed in here
export function claude_accounts(): string[] {
  let files: string[] = [];
  try {
    files = fs.readdirSync(DIR);
  } catch {}
  const named = files.flatMap((f) => {
    const name = /^claude-(.+)$/.exec(f)?.[1];
    return name !== undefined && ACCOUNT.test(name) && claude_signed(DIR + "/" + f) ? [name] : [];
  });
  return [PERSONAL, ...named.sort()];
}

export function config_none(): string | null {
  return config_usable().length === 0 ? NONE : null;
}

export function config_follow(): boolean {
  const now = config_usable().join();
  if (now === FOLLOWED) {
    return false;
  }
  FOLLOWED = now;
  try {
    config_reload();
    return true;
  } catch (err) {
    console.error("ki: the sign-ins changed, but " + err_why(err));
    return false;
  }
}

function config_env_value(key: string): string | undefined {
  return process.env["KI_" + key.toUpperCase()];
}

function config_str(x: unknown): string | undefined {
  return x === undefined || x === null ? undefined : text_of(x);
}

export function config_key_from(name: string, kept: Record<string, string>): From {
  return ENV_KEYS[name] ? "env" : kept[name] ? "file" : "default";
}

function config_path(path: string): string {
  return path.startsWith("~/") ? os.homedir() + path.slice(1) : path;
}

export function config_get(key: string, def: string): string {
  return config_env_value(key) ?? config_str(FILE[key]) ?? def;
}

function config_file(): Record<string, unknown> {
  return config_file_of(config_text(FILE_PATH));
}

export function config_file_of(text: string | null): Record<string, unknown> {
  if (text === null) {
    return {};
  }
  const json = config_json(FILE_PATH, text);
  if (!rec(json)) {
    throw new Error("config: config.json is no JSON object");
  }
  return json;
}

function config_text(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err_code(err) === "ENOENT") {
      return null;
    }
    throw new Error("config: " + path.basename(file) + " can't be read (" + (err_code(err) ?? String(err)) + ")");
  }
}

// a file's JSON, of its text; an Error names the file (keys.json's,
// nothing more: a parser's message may quote what it read)
function config_json(file: string, text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    const why = file === KEYS_PATH ? "" : " (" + err_why(err) + ")";
    throw new Error("config: " + path.basename(file) + " is no JSON" + why);
  }
}

// a config an older ki wrote fails here, before ki serve can tell that the
// installer hasn't brought DIR to this version: the failure says so
function config_start(): Made {
  try {
    return config_make(FILE);
  } catch (err) {
    const older = config_older();
    throw older === null ? err : new Error(err_why(err) + ". " + older);
  }
}

// why ki can't use the data in DIR before the installer runs, if so
export function config_older(): string | null {
  const old = fs.existsSync(DIR + "/users") || fs.existsSync(DIR + "/chat");
  const agents = fs.existsSync(DIR + "/agents");
  const layout = Number((fs.existsSync(LAYOUT) ? fs.readFileSync(LAYOUT, "utf8") : "").trim()) || 0;
  const due = (old && !agents) || (agents && layout < LAYOUT_NOW) || fs.existsSync(DIR + "/.migrating");
  return due ? DIR + " holds an older ki's data, not yet (or not all) moved to this version's layout: run the installer (" + install_cmd(process.platform === "win32") + ") with no ki server running, then start again" : null;
}

export function config_make(file: Record<string, unknown>): Made {
  const offer: Offer = {
    vendors : config_vendors(config_value(file, "vendors")),
    models  : config_value(file, "models").split(",").map((m) => m.trim()),
  };
  offer.models.forEach((m) => config_replaced("models", m));
  offer.profiles = config_profiles(file, offer);
  return {
    offer,
    pick      : config_run("pick", config_value(file, "pick"), offer),
    compactor : config_run("compactor", config_value(file, "compactor"), offer),
    context   : config_context(config_value(file, "compactor_context")),
    after     : config_value(file, "after"),
    hops      : config_hops(config_value(file, "hops")),
    thinking  : config_value(file, "thinking") === "on",
    off       : items(file.mcp_off).filter((name): name is string => typeof name === "string"),
    ask       : config_ask(file.ask),
  };
}

function config_ask(x: unknown): Rule[] {
  const rules = Rules.read(x);
  if (typeof rules === "string") {
    throw new Error("config: ask: " + rules);
  }
  return rules;
}

export function config_mcp_off(off: string[]): void {
  const next = { ...config_file() };
  if (off.length === 0) {
    delete next.mcp_off;
  } else {
    next.mcp_off = off;
  }
  const mode = fs.existsSync(FILE_PATH) ? fs.statSync(FILE_PATH).mode & 0o777 : 0o600;
  write_whole(FILE_PATH, JSON.stringify(next, null, 2) + "\n", mode);
  config_reload();
}

function config_hops(text: string): number {
  const n = Number(text.trim());
  if (!Number.isInteger(n) || n < 0 || n > 100) {
    throw new Error("config: hops is a whole number from 0 to 100, not " + text);
  }
  return n;
}

function config_context(text: string): number {
  const kb = Number(text.trim());
  if (!/^\d+$/.test(text.trim()) || kb < 1 || kb > 128) {
    throw new Error("config: compactor_context is no whole number of KB from 1 to 128: " + text);
  }
  return kb * 1000;
}

function config_run(key: string, text: string, offer: Offer): Pick {
  const profile = Pick.profile(text, offer, "medium", "slow");
  if (profile !== null) {
    return profile;
  }
  const [vendor, model, effort, speed] = text.split(":");
  const pick = Pick.read({ vendor, model, effort, speed }, offer);
  if (pick === null) {
    config_replaced(key, model ?? "");
    const why = Pick.refused({ vendor, model, effort }, offer);
    throw new Error("config: " + key + (why === null ? " is no vendor:model:effort:speed or profile offered here: " + text : ": " + why));
  }
  return pick;
}

function config_profiles(file: Record<string, unknown>, offer: Offer): Record<string, Fall[]> {
  const env = process.env.KI_PROFILES;
  const all: unknown = env === undefined ? file.profiles ?? {} : JSON.parse(env);
  if (!rec(all)) {
    throw new Error("config: profiles is no object of names, each a list of models");
  }
  return Object.fromEntries(Object.entries(all).map(([name, list]) => {
    if (name.trim() === "" || name.includes(":") || LABELS.includes(name) || !Array.isArray(list) || list.length === 0) {
      throw new Error("config: profile " + JSON.stringify(name) + " is no name (none of a model, no \":\") with a list of models");
    }
    return [name, items(list).map((f) => config_fall(name, String(f).trim(), offer))];
  }));
}

function config_fall(name: string, f: string, offer: Offer): Fall {
  const parts = f.split(":");
  const [vendor, label, effort, speed] = parts as [Vendor, string, string?, string?];
  const model = offer.vendors.includes(vendor) && offer.models.includes(label) ? Pick.model(vendor, label) : undefined;
  const bad = parts.length > 4 || (speed !== undefined && !model?.speeds.includes(speed));
  if (model === undefined || bad) {
    config_replaced("profiles", label, "profile " + JSON.stringify(name));
    throw new Error("config: profile " + JSON.stringify(name) + " has no vendor:model[:effort[:speed]] offered here: " + f);
  }
  if (effort !== undefined && !Pick.offers(model, effort)) {
    throw new Error("config: profile " + JSON.stringify(name) + ": " + Pick.no_effort(model, effort));
  }
  return { vendor, model, effort, speed };
}

// a model Ki replaced, named where an environment variable or config.json
// sets key: refused, with the model to name there instead
function config_replaced(key: string, label: string, what = key): void {
  const now = Pick.replaced(label);
  if (now !== undefined) {
    const env = "KI_" + key.toUpperCase();
    const where = process.env[env] === undefined ? path.basename(FILE_PATH) + "'s " + what : what === key ? env : env + "'s " + what;
    throw new Error("config: " + where + " names " + label + ", which " + now + " replaced: name " + now + " there instead");
  }
}

function config_vendors(text: string): Vendor[] {
  const list = text.split(",").map((v) => v.trim()) as Vendor[];
  const bad = list.find((v) => !VENDORS.includes(v));
  if (bad !== undefined) {
    throw new Error("config: vendors can't offer " + bad);
  }
  return list;
}

export function config_mcp_prefix(device: string): string {
  return device.replace(/[^A-Za-z0-9-]/g, "-");
}

function config_mcp_some(raw: unknown): boolean {
  if (typeof raw === "string") {
    try {
      return raw.trim() !== "" && config_mcp_some(JSON.parse(raw));
    } catch {
      return true;
    }
  }
  const all = get(raw, "mcpServers") ?? raw;
  return typeof all === "object" && all !== null && Object.keys(all).length > 0;
}

export function config_mcp(raw: unknown, device: string, notes: string[] = []): McpServer[] {
  const all = get(raw, "mcpServers") ?? raw;
  if (!rec(all)) {
    throw new Error("config: mcp must be an object of servers by name");
  }
  return Object.entries(all).flatMap(([name, server]) => {
    try {
      return [config_server(name, server, device)];
    } catch (err) {
      notes.push(err_why(err).replace(/^config: /, "") + ", so it is left out");
      return [];
    }
  });
}

function config_server(name: string, s: unknown, device: string): McpServer {
  const bad = (why: string) => new Error("config: mcp server " + JSON.stringify(name) + " " + why);
  const strs = (list: unknown, what: string): string[] => {
    if (list !== undefined && (!Array.isArray(list) || list.some((x) => typeof x !== "string"))) {
      throw bad("needs " + what + " as a list of strings");
    }
    return items(list).map(String);
  };
  const map = (obj: unknown, what: string): Record<string, string> => {
    if (obj !== undefined && (typeof obj !== "object" || obj === null || Array.isArray(obj) || Object.values(obj).some((x) => typeof x !== "string"))) {
      throw bad("needs " + what + " as an object of strings");
    }
    return Object.fromEntries(Object.entries(rec(obj) ? obj : {}).map(([k, v]) => [k, String(v)]));
  };
  if (!/^[A-Za-z0-9-]+(_[A-Za-z0-9-]+)*$/.test(name)) {
    throw bad("needs a name of letters, digits, - and single _s inside (its tools are named <server>__<tool>)");
  }
  if (!rec(s)) {
    throw bad("must be an object");
  }
  const type = s.type ?? (s.url === undefined ? "stdio" : "http");
  const timeout = s.timeout ?? 600;
  if (typeof timeout !== "number" || !(timeout > 0)) {
    throw bad("needs timeout as seconds, more than 0");
  }
  if (s.device !== undefined) {
    throw bad("has \"device\", which a device's own config.json doesn't take (its servers run on it)");
  }
  const server = { name: config_mcp_prefix(device) + "_" + name, device, command: "", args: [], env: {}, cwd: "", url: "", headers: {}, timeout };
  if (type === "stdio") {
    if (typeof s.command !== "string" || s.command === "" || (s.cwd !== undefined && typeof s.cwd !== "string")) {
      throw bad("needs a command (and cwd, if any, as a string)");
    }
    return { ...server, command: s.command, args: strs(s.args, "args"), env: map(s.env, "env"), cwd: typeof s.cwd === "string" ? s.cwd : "" };
  }
  if (type === "http") {
    if (typeof s.url !== "string" || s.url === "") {
      throw bad("needs a url");
    }
    return { ...server, url: s.url, headers: map(s.headers, "headers") };
  }
  throw bad("has type " + JSON.stringify(type) + "; ki runs stdio and http (streamable HTTP) servers");
}

function config_key(name: string): string {
  const key = (process.env[name] ?? "").trim();
  delete process.env[name];
  return key;
}

function config_keys(kept: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.keys(VARS).map((name) => [name, ENV_KEYS[name] || kept[name] || ""]));
}

export function config_reload(): void {
  const file = config_file();
  const made = config_make(file);
  const keys = config_keys(keys_read());
  OFFER.vendors = made.offer.vendors;
  OFFER.models = made.offer.models;
  OFFER.profiles = made.offer.profiles;
  PICK = made.pick;
  COMPACTOR = made.compactor;
  COMPACTOR_CONTEXT = made.context;
  AFTER = made.after;
  HOPS = made.hops;
  THINKING = made.thinking;
  MCP_OFF = made.off;
  ASK = made.ask;
  Object.assign(KEYS, keys);
  RELOADED.forEach((f) => f());
}

export type Snapshot = { file: string | null; keys: string | null; version: string };

export function config_snapshot(): Snapshot {
  const file = config_text(FILE_PATH);
  const keys = config_text(KEYS_PATH);
  const hash = crypto.createHash("sha256").update((file ?? "\u0001none") + "\0" + (keys ?? "\u0001none"));
  return { file, keys, version: hash.digest("hex").slice(0, 32) };
}

function keys_read(): Record<string, string> {
  return keys_of(config_text(KEYS_PATH));
}

export function keys_of(text: string | null): Record<string, string> {
  if (text === null) {
    return {};
  }
  const json = config_json(KEYS_PATH, text);
  const keys = rec(json) ? json : {};
  return Object.fromEntries(Object.entries(keys).flatMap(([name, key]) => (typeof key === "string" && key !== "" ? [[name, key]] : [])));
}

export function keys_text(keys: Record<string, string>): string | null {
  const kept = Object.fromEntries(Object.entries(keys).filter(([, key]) => key !== ""));
  return Object.keys(kept).length === 0 ? null : JSON.stringify(kept, null, 2) + "\n";
}
