import { create } from "zustand";
import { text_of } from "../../Json.ts";
import type { Row as SubRow } from "../../Sub.ts";
import type { Timer } from "../../Timer.ts";
import * as View from "../../View.ts";
import type { Mood } from "./Avatar.tsx";

// what the screen draws: taken from the view at most once a frame, so a
// reply streaming in costs one render a frame however many pieces come
type Ki = {
  signed    : boolean | null;
  agent     : string;
  loaded    : boolean;
  offline   : boolean;
  team      : View.Mate[];
  rows      : View.Row[];
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
};

const AGENT = /^\/a\/([a-z0-9]{1,16})/;
const LAST  = "ki.agent";

const v = View.view_new(AGENT.exec(location.pathname)?.[1] ?? localStorage.getItem(LAST) ?? "");

// the chat on screen, counted read by the server while the window has focus
const SEEN = { agent: null as string | null, at: 0, on: false, ws: null as WebSocket | null };

export const useKi = create<Ki>(() => ({ signed: null, agent: v.agent, loaded: false, offline: false, team: [], rows: [], stoppable: false, mood: "idle", asks: 0, timers: [], jobs: [], talk: null, meter: null, knobs: [], plugs: [], page: null, sub: null, hearing: false, importing: null, note: "" }));

let due = false;

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

function draw(): void {
  if (due) {
    return;
  }
  due = true;
  requestAnimationFrame(() => {
    due = false;
    const note = v.notes.shift();
    useKi.setState({
      agent     : v.agent,
      loaded    : v.held === v.agent,
      offline   : View.view_offline(v),
      team      : v.team,
      rows      : [...View.view_body(v), ...View.view_tail(v)],
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
  if (msg.$ === "error") {
    v.notes.push(msg.text);
  }
  for (const out of View.view_hear(v, msg)) {
    View.link_send(v, out);
  }
  if (msg.$ === "state" && v.held === v.agent) {
    localStorage.setItem(LAST, v.agent);
  }
  seen();
  draw();
}

// a link that dropped is offline only after its grace; one refused for no
// sign-in goes back to the sign-in form
function lost(up: boolean): void {
  draw();
  setTimeout(draw, View.GRACE + 100);
  if (!up) {
    void fetch("/api/me").then((res) => res.status === 401 && useKi.setState({ signed: false }), () => {});
  }
}

export async function boot(): Promise<void> {
  const res = await fetch("/api/me").catch(() => null);
  if (res?.status === 401) {
    useKi.setState({ signed: false });
    return;
  }
  useKi.setState({ signed: true });
  [v.down, v.woke] = [Date.now(), Date.now()];
  View.link_open(v, {
    open : (query) => new WebSocket(location.origin.replace(/^http/, "ws") + "/ws" + query),
    post : (path, body) => fetch(path, { method: "POST", body: body as BodyInit }),
    hear : hear,
    lost : lost,
  });
  document.addEventListener("visibilitychange", () => {
    document.visibilityState === "visible" && v.wake();
    seen();
  });
  window.addEventListener("focus", seen);
  window.addEventListener("blur", seen);
  setInterval(seen, View.USE_PING);
}

// the chat the screen shows now, null for none (the agent list), or the
// page of one of its subagents, which doesn't count its spawner's chat read
export function show(agent: string | null, sub: string | null = null): void {
  SEEN.agent = sub === null ? agent : null;
  for (const out of agent === null ? [] : View.view_switch(v, agent)) {
    View.link_send(v, out);
  }
  if (agent !== null && (v.page?.name ?? null) !== sub) {
    for (const out of View.view_act(v, { $: "Goto", name: sub })) {
      View.link_send(v, out);
    }
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
  useKi.setState({ note: "" });
}
