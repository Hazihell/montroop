import { create } from "zustand";
import { get, text_of } from "../../Json.ts";
import type { Row as SubRow } from "../../Sub.ts";
import type { Timer } from "../../Timer.ts";
import * as View from "../../View.ts";
import type { Mood } from "./Avatar.tsx";
import { push_clear, push_keep } from "./Push.ts";

// what the screen draws: taken from the view at most once a frame, so a
// reply streaming in costs one render a frame however many pieces come;
// rows are the chat's, tail what streams in and waits after them
type Ki = {
  signed    : boolean | null;
  agent     : string;
  loaded    : boolean;
  offline   : boolean;
  team      : View.Mate[];
  rows      : View.Row[];
  tail      : View.Row[];
  stoppable : boolean;
  mood      : Mood;
  asks      : number;
  timers    : Timer[];
  jobs      : View.BgJob[];
  talk      : View.Talk | null;
  meter     : View.Talk | null;
  knobs     : View.Knob[];
  plugs     : View.Plug[];
  page      : string | null;
  sub       : SubRow | null;
  hearing   : boolean;
  importing : View.Progress | null;
  note      : string;
  // the note stays, with a button that loads the page again
  stale     : boolean;
  intro     : boolean;
  welcome   : boolean;
};

const AGENT = /^\/a\/([a-z0-9]{1,16})/;
const LAST  = "ki.agent";
// this browser's own: that it is signed in, the team, and each chat's last
// screens, drawn before the link is up
const SIGNED = "ki.signed";
const TEAM   = "ki.team";
const COPY   = "ki.copy.";
const COPY_MOST  = 2 ** 19;
const COPY_PARTS = 120;
const COPY_AFTER = 2000;
// the build a reload was made for, and how many
const BUILD = "ki.build";
const RELOADS = 2;
const INTRO = "ki.intro";
const WELCOMED = "ki.welcomed";
const OLDER = "This page is older than the server: reload it.";
const DESK = matchMedia("(hover: hover)");

const PAGE = document.documentElement.dataset;

const v = View.view_new(AGENT.exec(location.pathname)?.[1] ?? localStorage.getItem(LAST) ?? PAGE.first ?? "");

// the chat on screen, counted read by the server while the window has focus
const SEEN = { agent: null as string | null, at: 0, on: false, ws: null as WebSocket | null };

export const useKi = create<Ki>(() => ({ signed: null, agent: v.agent, loaded: false, offline: false, team: [], rows: [], tail: [], stoppable: false, mood: "idle", asks: 0, timers: [], jobs: [], talk: null, meter: null, knobs: [], plugs: [], page: null, sub: null, hearing: false, importing: null, note: "", stale: false, intro: localStorage.getItem(INTRO) === null && !new URLSearchParams(location.search).has("skip"), welcome: false }));

let due = false;
// a piece of a reply streaming in changes only the tail: the chat's rows
// are made again when anything else comes
let rows_due = true;

// what the agent of the chat held does now, as its avatar shows it
function mood(): Mood {
  if (View.view_offline(v) || v.limit !== null) {
    return "sleeping";
  }
  if (v.asks.length > 0 && v.page === null) {
    return "asking";
  }
  const page = v.page;
  const last = (page?.live ?? v.live).at(-1);
  if (last === undefined) {
    return (page === null ? v.busy : View.view_sub(v) !== undefined) ? "thinking" : "idle";
  }
  return last.kind === "mind" ? "thinking" : last.kind === "reply" ? "writing" : "working";
}

// an agent's mood in a list: the held chat's is known closely, another's
// from what the team list says of it
export function mood_of(m: View.Mate, s: { agent: string; loaded: boolean; mood: Mood }): Mood {
  if (m.id === s.agent && s.loaded) {
    return s.mood === "idle" && m.unread > 0 ? "done" : s.mood;
  }
  return (m.asks ?? 0) > 0 ? "asking" : m.busy ? "working" : m.unread > 0 ? "done" : "idle";
}

export const MOODS: Record<Mood, string> = {
  idle      : "",
  thinking  : "Thinking",
  working   : "Working",
  writing   : "Writing",
  asking    : "Needs you",
  listening : "Listening",
  done      : "New for you",
  error     : "Stuck",
  sleeping  : "Asleep",
};

function draw(rows = true): void {
  rows_due ||= rows;
  if (due) {
    return;
  }
  due = true;
  requestAnimationFrame(() => {
    due = false;
    const note = v.notes.shift();
    const body = rows_due ? View.view_body(v) : useKi.getState().rows;
    rows_due = false;
    useKi.setState({
      agent     : v.agent,
      loaded    : v.held === v.agent,
      offline   : View.view_offline(v),
      team      : v.team,
      rows      : body,
      tail      : View.view_tail(v),
      stoppable : View.view_stoppable(v),
      mood      : mood(),
      asks      : v.asks.length,
      timers    : v.timers,
      jobs      : v.bg,
      talk      : v.talk,
      meter     : v.page === null ? v.talk : View.view_sub(v)?.meter ?? null,
      knobs     : View.view_pick(v),
      plugs     : v.mcp,
      page      : v.page?.name ?? null,
      sub       : View.view_sub(v) ?? null,
      hearing   : v.out.some((p) => p.msg.$ === "voice"),
      importing : v.importing,
      ...(note === undefined ? {} : { note }),
    });
  });
}

function seen(): void {
  const on = SEEN.agent === v.agent && document.visibilityState === "visible" && document.hasFocus();
  const ws = v.ws;
  if (ws === null || !v.up || ws.readyState !== WebSocket.OPEN || (ws === SEEN.ws && on === SEEN.on && (!on || Date.now() - SEEN.at < View.USE_PING))) {
    return;
  }
  ws.send(on ? View.ACTIVE : View.IDLE);
  [SEEN.ws, SEEN.on, SEEN.at] = [ws, on, Date.now()];
}

function hear(msg: View.Server): void {
  // the server took no part in the link: a page older than it loads again
  // once nothing is lost by it, and says so meanwhile
  if (msg.$ === "error" && v.refused !== null) {
    const old = v.refused.old;
    if (old && msg.build !== undefined) {
      renew_due(msg.build);
    }
    if (!RENEW.due || !renew_free()) {
      useKi.setState({ note: old ? OLDER : msg.text, stale: old });
    }
    draw();
    return;
  }
  if (msg.$ === "view" && v.refused !== null) {
    useKi.setState({ note: "", stale: false });
  }
  if (msg.$ === "error") {
    v.notes.push(msg.text);
  }
  for (const out of View.view_hear(v, msg)) {
    View.link_send(v, out);
  }
  // a subagent the server has none of keeps no copy here, nor an agent gone
  if (msg.$ === "agent" && !msg.found) {
    localStorage.removeItem(COPY + v.on + "/s/" + msg.name);
  }
  if (msg.$ === "team") {
    copy_keys().filter((k) => !v.team.some((m) => k.slice(COPY.length).split("/")[0] === m.id)).forEach((k) => localStorage.removeItem(k));
  }
  if (msg.$ === "state") {
    if (v.held === v.agent) {
      localStorage.setItem(LAST, v.agent);
    }
    renew_due(msg.build);
    welcome();
  }
  seen();
  draw(msg.$ !== "delta");
  clearTimeout(COPIES.soon);
  COPIES.soon = setTimeout(copy_keep, COPY_AFTER);
}

// a link that dropped is offline only after its grace; a sign-in that ended
// goes back to the sign-in form, with nothing of the session left in this
// browser
function lost(up: boolean): void {
  draw();
  setTimeout(() => draw(), View.GRACE + 100);
  if (!up) {
    void fetch("/api/me").then((res) => {
      if (res.status === 401) {
        copies_drop();
        useKi.setState({ signed: false });
      }
    }, () => {});
  }
}

// whether the server knows this browser, asked till it answers: "Can't
// reach Ki" once it has failed for the grace offline has
async function me(): Promise<boolean> {
  const from = Date.now();
  for (let told = false; ;) {
    const res = await fetch("/api/me").catch(() => null);
    if (res?.status === 200 || res?.status === 401) {
      if (told) {
        useKi.setState({ note: "" });
      }
      return res.status === 200;
    }
    if (!told && Date.now() - from >= View.GRACE) {
      told = true;
      useKi.setState({ note: "Can't reach Ki. Reconnecting…" });
    }
    await new Promise((ok) => setTimeout(ok, View.RETRY));
  }
}

// a copy that doesn't parse is none
function parsed(text: string | null): unknown {
  try {
    return JSON.parse(text ?? "null");
  } catch {
    return null;
  }
}

function copy_key(): string {
  return COPY + v.agent + (v.page === null ? "" : "/s/" + v.page.name);
}

function copy_keys(): string[] {
  return Object.keys(localStorage).filter((k) => k.startsWith(COPY));
}

// the chat drawn before its link is up: the page's first messages, else
// this browser's copy, with the team it kept
function copy_draw(): void {
  const opening = parsed(document.getElementById("opening")?.textContent ?? null);
  const team = parsed(localStorage.getItem(TEAM));
  View.view_adopt(v, Array.isArray(opening) ? (opening as View.Server[]) : []);
  if (v.team.length === 0 && get(team, "wire") === View.WIRE && Array.isArray(get(team, "team"))) {
    v.team = get(team, "team") as View.Mate[];
  }
  copy_take();
}

// the wanted chat's or subagent page's copy, while the view holds none of it
function copy_take(): void {
  const copy = parsed(localStorage.getItem(copy_key()));
  const msgs = get(copy, "msgs");
  if (get(copy, "wire") !== View.WIRE || !Array.isArray(msgs)) {
    return;
  }
  if (v.page === null) {
    View.view_adopt(v, msgs as View.Server[]);
  } else {
    View.view_page_adopt(v, msgs as View.Server[]);
  }
}

// what this page last kept under each key, but for when
const COPIES = { kept: new Map<string, string>(), soon: undefined as ReturnType<typeof setTimeout> | undefined };

// the team, and the chat held or the subagent page open: its last
// COPY_PARTS (a run of tool calls is many parts and one row), fewer while
// they are too big, by as many as the copy is over
function copy_keep(): void {
  if (localStorage.getItem(SIGNED) === null) {
    return;
  }
  if (v.team.length > 0) {
    const team = JSON.stringify({ wire: View.WIRE, team: v.team });
    copy_put(TEAM, team, () => team);
  }
  const page = v.page;
  const ids = page === null ? (v.held === v.agent ? v.parts.map(([id]) => id) : []) : (page.log ?? []).flatMap((e) => (e.id === undefined ? [] : [e.id]));
  const key = copy_key();
  for (let k = Math.max(0, ids.length - COPY_PARTS); k < ids.length;) {
    const from = ids[k];
    if (from === undefined) {
      break;
    }
    const msgs = page === null ? View.view_copy(v, from) : View.view_page_copy(page, from);
    const said = JSON.stringify(msgs);
    if (said.length <= COPY_MOST) {
      copy_put(key, said, () => JSON.stringify({ wire: View.WIRE, at: Date.now(), msgs }));
      return;
    }
    k += Math.max(1, Math.ceil((ids.length - k) * (1 - COPY_MOST / said.length)));
  }
  localStorage.removeItem(key);
}

// a copy that changed, or isn't there; full storage makes room: the other
// chats' copies go, the oldest first
function copy_put(key: string, said: string, text: () => string): void {
  if (COPIES.kept.get(key) === said && localStorage.getItem(key) !== null) {
    return;
  }
  let olds: string[] | null = null;
  for (;;) {
    try {
      localStorage.setItem(key, text());
      COPIES.kept.set(key, said);
      return;
    } catch {
      olds ??= copy_keys().filter((k) => k !== key).map((k) => ({ k, at: Number(get(parsed(localStorage.getItem(k)), "at") ?? 0) })).sort((a, b) => a.at - b.at).map(({ k }) => k);
      const old = olds.shift();
      if (old === undefined) {
        return;
      }
      localStorage.removeItem(old);
    }
  }
}

// signed out: nothing of the session stays in this browser
function copies_drop(): void {
  [SIGNED, TEAM, ...copy_keys()].forEach((k) => localStorage.removeItem(k));
}

// a page older than the server's build loads again, by itself, when that
// loses nothing: HOLDS names what would be lost
const RENEW = { due: "", going: false };
const HOLDS = new Set<string>();

// what must not be cut short by a reload (an upload, a recording, a place
// kept far up a chat, a save on its way), held and let go by who has it
export function holds(what: string, on: boolean): void {
  if (on) {
    HOLDS.add(what);
  } else if (HOLDS.delete(what)) {
    void renew();
  }
}

// a build is tried RELOADS times in a tab: one that still isn't the
// server's after them is a page some cache keeps, and says so instead
function renew_due(build: string | undefined): void {
  const [was, n] = (sessionStorage.getItem(BUILD) ?? "").split(" ");
  const fresh = build === undefined || PAGE.build === undefined || build === PAGE.build;
  RENEW.due = fresh || (was === build && Number(n) >= RELOADS) ? "" : build;
  void renew();
}

function renew_free(): boolean {
  const el = document.activeElement;
  const typing = document.visibilityState === "visible" && el !== null && el.matches("input, textarea, select");
  return HOLDS.size === 0 && v.out.length === 0 && !typing && document.querySelector("dialog[open]") === null;
}

async function renew(): Promise<void> {
  if (RENEW.due === "" || RENEW.going || !renew_free()) {
    return;
  }
  RENEW.going = true;
  const [was, n] = (sessionStorage.getItem(BUILD) ?? "").split(" ");
  const tries = was === RENEW.due ? Number(n) : 0;
  const store = isSecureContext && "caches" in window ? window.caches : null;
  const keys = (await store?.keys().catch(() => [])) ?? [];
  await Promise.all(store === null ? [] : keys.filter((k) => k.startsWith("ki-shell")).map((k) => store.delete(k)));
  if (tries > 0) {
    await fetch("/", { cache: "reload" }).catch(() => null);
  }
  RENEW.going = false;
  if (RENEW.due === "" || !renew_free()) {
    return;
  }
  copy_keep();
  sessionStorage.setItem(BUILD, RENEW.due + " " + (tries + 1));
  location.reload();
}

// the importer, offered once on a computer to a chat that has only its
// opening message, after the intro
function welcome(): void {
  if (localStorage.getItem(WELCOMED) === null && !useKi.getState().intro && DESK.matches && v.pick !== null && v.held === v.agent && v.page === null && v.parts.length === View.OPENING && v.importing === null) {
    localStorage.setItem(WELCOMED, "1");
    useKi.setState({ welcome: true });
  }
}

export function welcomed(): void {
  useKi.setState({ welcome: false });
}

// the intro played, or was skipped: once per browser
export function intro_end(): void {
  localStorage.setItem(INTRO, "1");
  useKi.setState({ intro: false });
  welcome();
}

// go: the screen a notification's tap asks for
export async function boot(go: (url: string) => void): Promise<void> {
  // a page of the server's has its build; one of a dev run keeps no worker
  const sw = PAGE.build === undefined ? undefined : (navigator.serviceWorker as ServiceWorkerContainer | undefined);
  sw?.register("/sw.js").catch(() => {});
  sw?.addEventListener("message", (ev: MessageEvent) => {
    const url: unknown = get(ev.data, "go");
    if (typeof url === "string" && url.startsWith("/")) {
      go(url);
    }
  });
  sw?.startMessages();
  // signed in as the page or this browser knows, else as /api/me says
  if (PAGE.signed === "out" || (PAGE.signed === undefined && localStorage.getItem(SIGNED) === null && !(await me()))) {
    copies_drop();
    useKi.setState({ signed: false });
    return;
  }
  localStorage.setItem(SIGNED, "1");
  copy_draw();
  useKi.setState({ signed: true });
  draw();
  void push_keep();
  push_clear();
  [v.down, v.woke] = [Date.now(), Date.now()];
  View.link_open(v, {
    open : (query) => new WebSocket(location.origin.replace(/^http/, "ws") + "/ws" + query),
    post : (path, body) => fetch(path, { method: "POST", body: body as BodyInit }),
    hear : hear,
    lost : lost,
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      v.wake();
      void push_keep();
      push_clear();
    } else {
      copy_keep();
      void renew();
    }
    seen();
  });
  window.addEventListener("focus", () => {
    seen();
    push_clear();
  });
  window.addEventListener("blur", seen);
  window.addEventListener("pageshow", () => v.wake());
  window.addEventListener("online", () => v.wake());
  (navigator as Navigator & { connection?: EventTarget }).connection?.addEventListener("change", () => v.wake());
  // a phone freezes a page in the background, its links dead: the server
  // hears it leave now, and it comes back at once
  document.addEventListener("freeze", () => v.ws?.close());
  document.addEventListener("resume", () => v.wake());
  window.addEventListener("pagehide", copy_keep);
  // a field left is no longer typed in: a reload that waited for it goes
  document.addEventListener("focusout", () => setTimeout(() => void renew()));
  setInterval(seen, View.USE_PING);
}

// the chat the screen shows now, null for none (the agent list), or the
// page of one of its subagents, which doesn't count its spawner's chat read;
// read false holds an agent for one of its pages (what runs, its memory)
// without its chat on screen
export function show(agent: string | null, sub: string | null = null, read = true): void {
  SEEN.agent = sub === null && read ? agent : null;
  for (const out of agent === null ? [] : View.view_switch(v, agent)) {
    View.link_send(v, out);
  }
  if (agent !== null && (v.page?.name ?? null) !== sub) {
    for (const out of View.view_act(v, { $: "Goto", name: sub })) {
      View.link_send(v, out);
    }
  }
  if (agent !== null) {
    copy_take();
  }
  seen();
  draw();
}

// failed: a message the server refused, for the box to take back
export function act(a: View.Act, failed?: () => void): void {
  const said = a.$ === "Send" ? a.text.trim() : "";
  const back = (answer: View.Answer) => {
    if (answer.error !== undefined) {
      useKi.setState({ note: answer.error });
      failed?.();
    }
  };
  for (const out of View.view_act(v, a)) {
    View.link_send(v, out, a.$ === "Send" ? back : undefined, said);
  }
  draw();
}

// a subagent's page near its top asks for its earlier entries
export function earlier(): void {
  for (const out of View.view_earlier(v)) {
    View.link_send(v, out);
  }
  draw();
}

// what was said in a recording, as the server heard it
export function voice(audio: Blob): Promise<View.Answer> {
  return new Promise((done) => {
    View.link_send(v, { $: "voice", type: audio.type, body: () => audio }, done);
    draw();
  });
}

// past chats, read in this browser, into an agent's memory
export function import_send(agent: string, body: () => Promise<Blob>): Promise<View.Answer> {
  return new Promise((done) => {
    View.link_send(v, { $: "import", body, agent }, done);
    draw();
  });
}

// an import paused goes on, one going pauses
export function import_flow(): void {
  View.link_send(v, { $: "go", on: Boolean(v.importing?.why) }, (out) => out.error !== undefined && useKi.setState({ note: out.error }));
}

// signed out: nothing of the session stays in this browser
export function signed_out(): void {
  Object.keys(localStorage).filter((k) => k.startsWith("ki.") && k !== "ki.look" && k !== "ki.notify" && k !== INTRO).forEach((k) => localStorage.removeItem(k));
  location.assign("/");
}

export function note(text: string): void {
  useKi.setState({ note: text });
}

export async function answer(id: string, ok: boolean, note: string): Promise<boolean> {
  const out = await View.post("/api/approve", { id, ok, note });
  if (out.ok !== true) {
    useKi.setState({ note: text_of(out.error, "Could not send the answer.") });
  }
  return out.ok === true;
}

export function noted(): void {
  useKi.setState({ note: "", stale: false });
}
