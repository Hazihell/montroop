// Holders
// =======
// The server's side of holders (Hold): each runs as a transient unit of
// its own (Service), so a server restart or deploy leaves it running. The
// server links to it over its socket, takes in what it tells (Wire) and
// acks it, tries again while it runs, and once it's gone takes in what its
// log holds past the last ack. What a holder runs for (a work session), and
// the calls of Montroop's tools it sends, are its owner's business, told
// through the hooks given at boot.

import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import * as config from "./Config.ts";
import { err_why } from "./Err.ts";
import { Hold, START, type Start } from "./Hold.ts";
import { get, rec, str } from "./Json.ts";
import { active, command, halt, transient } from "./Service.ts";
import { VERSION, Wire, type Ev, type Scratch, type Told, type ToHold } from "./Wire.ts";

// a holder as its owner keeps it: the id it goes by, its folder (with its
// log), and the unit and socket of its latest launch ("": none yet)
export type Holder = { id: string; dir: string; unit: string; sock: string };

// held: the holder of id while it's to be linked to (its run live), with
// the last of its events taken in; null: none. told: an event, taken in
// once, returning what's left to do once it's acked. welcome: a link's
// first message, with the ids of the calls the holder has parked and of
// the questions waiting. gone: the holder ended, its log taken in. call:
// one of Montroop's tools to run for it; took: it has the result of a call.
// scratch: the devices' scratch folders, which its rules read
type On = {
  held    : (id: string) => { holder: Holder; ack: number } | null;
  told    : (id: string, t: Told) => () => void;
  welcome : (id: string, asks: string[], questions: string[]) => void;
  gone    : (id: string, holder: Holder) => void;
  call    : (id: string, call: string, tool: string, input: Record<string, unknown>) => void;
  took    : (id: string, call: string) => void;
  scratch : () => Scratch;
};

// a link to a holder: the socket (null: none now), the tries to connect
// since it last did, the next try's timer
type Link = { sock: net.Socket | null; tries: number; timer: Timer | null };

// how long, at most, between tries to reach a holder that runs
const RETRY = 5000;

// the variables a holder works with, from the server's
const ENV = ["PATH", "LANG", "SHELL", "SSH_AUTH_SOCK", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "NODE_EXTRA_CA_CERTS"];

const LINKS = new Map<string, Link>();

const ON: On = { held: () => null, told: () => () => {}, welcome: () => {}, gone: () => {}, call: () => {}, took: () => {}, scratch: () => ({}) };

export namespace Holders {

  // at the server's start, before any holder is adopted or launched
  export function boot(on: On): void {
    Object.assign(ON, on);
    config.RELOADED.add(rules);
  }

  // the ask rules and scratch folders as they are now, to every holder linked
  export function rules(): void {
    const scratch = ON.scratch();
    LINKS.forEach((l) => Wire.send(l.sock, { $: "rules", rules: config.ASK, scratch }));
  }

  // every holder linked told the usage limits were reset; how many
  export function poke(): number {
    const linked = [...LINKS.values()].filter((l) => l.sock !== null);
    linked.forEach((l) => Wire.send(l.sock, { $: "poke" }));
    return linked.length;
  }

  // the unit and socket of a holder's launch n
  export function named(id: string, dir: string, n: number): Holder {
    return { id, dir, unit: "troop-hold-" + id + "-" + n, sock: path.join(dir, "hold-" + n + ".sock") };
  }

  // a holder found at the server's start: linked to again if it runs,
  // else taken as gone
  export function adopt(id: string): void {
    const held = ON.held(id);
    if (held !== null && alive(held.holder)) {
      link(id);
    } else {
      gone(id);
    }
  }

  // its unit started on start, and linked to. null: started; else why not
  export function launch(h: Holder, about: string, start: Omit<Start, "sock">): string | null {
    const begin: Start = { ...start, sock: h.sock };
    fs.writeFileSync(path.join(h.dir, START), JSON.stringify(begin, null, 1) + "\n", { mode: 0o600 });
    const env = { ...Object.fromEntries(ENV.flatMap((k) => (process.env[k] ? [[k, process.env[k]]] : []))), TROOP_DIR: config.DIR };
    const why = transient({ name: h.unit, dir: h.dir }, about, [...command(), "hold", h.dir], env);
    if (why === null) {
      unlink(h.id);
      link(h.id);
    }
    return why;
  }

  export function alive(h: Holder): boolean {
    return h.unit !== "" && active({ name: h.unit, dir: h.dir });
  }

  // a message for it, if linked (if not, the next link's welcome has its
  // owner send what it still needs)
  export function send(id: string, msg: ToHold): void {
    Wire.send(LINKS.get(id)?.sock, msg);
  }

  // unlinked, and its unit and everything it started ended
  export function stop(h: Holder): void {
    unlink(h.id);
    if (h.unit !== "") {
      halt({ name: h.unit, dir: h.dir });
    }
  }

  // no longer kept in mind
  export function forget(h: Holder): void {
    unlink(h.id);
    LINKS.delete(h.id);
    Hold.forget(h.dir);
  }

  function link_of(id: string): Link {
    const l = LINKS.get(id) ?? { sock: null, tries: 0, timer: null };
    LINKS.set(id, l);
    return l;
  }

  function link(id: string): void {
    const held = ON.held(id);
    const l = link_of(id);
    if (held === null || l.sock !== null) {
      return;
    }
    const sock = net.createConnection(held.holder.sock);
    l.sock = sock;
    sock.setEncoding("utf8");
    sock.on("connect", () => {
      l.tries = 0;
      Wire.send(sock, { $: "hello", v: VERSION, ack: ON.held(id)?.ack ?? 0, rules: config.ASK, scratch: ON.scratch() });
    });
    sock.on("data", Wire.lines((msg) => {
      try {
        got(id, sock, msg);
      } catch (err) {
        console.error("troop: holder " + id + ": " + err_why(err));
      }
    }));
    sock.on("error", () => {});
    sock.on("close", () => {
      if (l.sock === sock) {
        l.sock = null;
        lost(id);
      }
    });
  }

  function unlink(id: string): void {
    const l = LINKS.get(id);
    if (l === undefined) {
      return;
    }
    clearTimeout(l.timer ?? undefined);
    const sock = l.sock;
    l.sock = null;
    sock?.destroy();
  }

  // the link fell or never came: tried again while the holder runs, else
  // it's gone
  function lost(id: string): void {
    const l = LINKS.get(id);
    if (l === undefined || ON.held(id) === null) {
      return;
    }
    l.tries += 1;
    clearTimeout(l.timer ?? undefined);
    l.timer = setTimeout(() => {
      l.timer = null;
      if (l.sock === null) {
        adopt(id);
      }
    }, Math.min(RETRY, 100 * l.tries));
  }

  // what its log holds past the last ack taken in, then its owner told
  function gone(id: string): void {
    const held = ON.held(id);
    if (held === null) {
      return;
    }
    if (held.holder.sock !== "") {
      fs.rmSync(held.holder.sock, { force: true });
    }
    Hold.told(held.holder.dir).filter((t) => t.seq > held.ack).forEach((t) => ON.told(id, t)());
    ON.gone(id, held.holder);
  }

  function got(id: string, sock: net.Socket, msg: Record<string, unknown>): void {
    if (msg.$ === "welcome") {
      const ids = (x: unknown) => (Array.isArray(x) ? x : []).map((a) => str(get(a, "id")) ?? "");
      ON.welcome(id, ids(msg.asks), ids(msg.questions));
    } else if (msg.$ === "ev" && typeof msg.seq === "number" && rec(msg.ev)) {
      const then = ON.told(id, { seq: msg.seq, at: Number(msg.at) || Date.now(), ev: msg.ev as Ev });
      Wire.send(sock, { $: "ack", seq: msg.seq });
      then();
    } else if (msg.$ === "call" && typeof msg.id === "string" && typeof msg.tool === "string") {
      ON.call(id, msg.id, msg.tool, rec(msg.input) ? msg.input : {});
    } else if (msg.$ === "took" && typeof msg.id === "string") {
      ON.took(id, msg.id);
    }
  }

}
