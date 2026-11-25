import { get } from "../../Json.ts";
import * as View from "../../View.ts";

// this browser's notifications: off, on, blocked in its settings, or only
// once on the Home Screen (an iPhone's Safari)
export type Notify = "off" | "on" | "blocked" | "home";
type Push = { reg: ServiceWorkerRegistration; key: string };
export type Bell = { state: Notify; push: Push | null };

// "on" or "off": notifications as the user last had them on this device
const NOTIFY = "montroop.notify";
const BLOCKED = "they're blocked in this browser's settings for this site.";
const KEEP_EVERY = 60 * 60 * 1000;

let KEPT = 0;

function bytes_of(key: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}

export async function push_sub(): Promise<PushSubscription | null> {
  const reg = await (navigator.serviceWorker as ServiceWorkerContainer | undefined)?.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

// whether a subscription was made for the server's key (one made for a
// key it had before gets no push)
function keyed(sub: PushSubscription | null, key: string): boolean {
  const had = sub?.options.applicationServerKey;
  return had != null && bytes_of(key).join() === new Uint8Array(had).join();
}

// null: this browser has no notifications, or the server none to send
export async function push_state(): Promise<Bell | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return /iPhone|iPad/.test(navigator.userAgent) ? { state: "home", push: null } : null;
  }
  if (Notification.permission === "denied") {
    return { state: "blocked", push: null };
  }
  const wait = new Promise<undefined>((ok) => setTimeout(ok, 3000, undefined));
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await Promise.race([navigator.serviceWorker.ready, wait]));
  const sub = await push_sub();
  const res = await fetch("/api/webpush" + (sub === null ? "" : "?endpoint=" + encodeURIComponent(sub.endpoint))).catch(() => null);
  const out = res?.ok === true ? ((await res.json()) as { key: string | null; on: boolean }) : null;
  if (reg === undefined || out === null || out.key === null) {
    return null;
  }
  return { state: out.on && keyed(sub, out.key) ? "on" : "off", push: { reg, key: out.key } };
}

// the browser asks first, while the tap that turned them on still counts
async function turn_on(push: Push): Promise<Record<string, unknown>> {
  const asked = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (asked !== "granted") {
    return { error: asked === "denied" ? BLOCKED : "they weren't allowed when the browser asked." };
  }
  const ask = () => push.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes_of(push.key) });
  const sub = await ask().catch(async (err: unknown) => {
    const old = await push.reg.pushManager.getSubscription();
    if (old === null || get(err, "name") !== "InvalidStateError") {
      throw err;
    }
    await old.unsubscribe();
    return ask();
  });
  return View.post("/api/webpush", sub.toJSON());
}

async function turn_off(push: Push): Promise<Record<string, unknown>> {
  const sub = await push.reg.pushManager.getSubscription();
  if (sub !== null) {
    await fetch("/api/webpush", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
    await sub.unsubscribe();
  }
  return {};
}

// the user's own on or off, remembered for this device
export async function push_turn(on: boolean, push: Push): Promise<Record<string, unknown>> {
  const out = on ? await turn_on(push) : await turn_off(push);
  if (out.error === undefined) {
    localStorage.setItem(NOTIFY, on ? "on" : "off");
  }
  return out;
}

// notifications this device had on stay on: when the app opens, and when
// it comes back in view an hour or more after, a subscription the server
// or the browser lost is made again, without a word; a try that failed is
// made again when it next comes back in view. Off is only what the user
// turned off here
export async function push_keep(): Promise<void> {
  if (Date.now() - KEPT < KEEP_EVERY) {
    return;
  }
  KEPT = Date.now();
  const bell = await push_state().catch(() => null);
  const push = bell?.push ?? null;
  if (localStorage.getItem(NOTIFY) === "off" || (bell !== null && (push === null || Notification.permission !== "granted"))) {
    return;
  }
  const out = push === null ? null : bell?.state === "off" ? await turn_on(push).catch(() => null) : {};
  if (out === null || out.error !== undefined) {
    KEPT = 0;
    return;
  }
  localStorage.setItem(NOTIFY, "on");
}

// all of Montroop's notifications go once the app is in view
export function push_clear(): void {
  if (document.visibilityState === "visible" && "serviceWorker" in navigator) {
    navigator.serviceWorker.ready.then((reg) => reg.getNotifications()).then((notes) => notes.forEach((n) => n.close())).catch(() => {});
  }
}
