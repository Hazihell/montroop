import { create } from "zustand";
import { text_of } from "../../Json.ts";
import * as View from "../../View.ts";

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
  note      : string;
};

const AGENT = /^\/a\/([a-z0-9]{1,16})/;
const LAST  = "ki.agent";

const v = View.view_new(AGENT.exec(location.pathname)?.[1] ?? localStorage.getItem(LAST) ?? "");

// the chat on screen, counted read by the server while the window has focus
const SEEN = { agent: null as string | null, at: 0, on: false, ws: null as WebSocket | null };

export const useKi = create<Ki>(() => ({ signed: null, agent: v.agent, loaded: false, offline: false, team: [], rows: [], stoppable: false, note: "" }));

let due = false;

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

// the chat the screen shows now, null for none (the agent list)
export function show(agent: string | null): void {
  SEEN.agent = agent;
  for (const out of agent === null ? [] : View.view_switch(v, agent)) {
    View.link_send(v, out);
  }
  seen();
  draw();
}

export function act(a: View.Act): void {
  const said = a.$ === "Send" ? a.text.trim() : "";
  for (const out of View.view_act(v, a)) {
    View.link_send(v, out, a.$ === "Send" ? (answer) => answer.error !== undefined && useKi.setState({ note: answer.error }) : undefined, said);
  }
  draw();
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
