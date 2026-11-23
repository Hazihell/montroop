import { CaretLeftIcon } from "@phosphor-icons/react";
import { useCanGoBack, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, type ReactNode } from "react";

// an iPhone's home-screen app has no back gesture of its own: a swipe from
// the left edge stands in for it
const IOS_APP = (navigator as Navigator & { standalone?: boolean }).standalone === true;
const EDGE = 28;
const SLOP = 10;
const FAR = 0.35;
const FLING = 0.6;
const OUT = 200;

// the phone's own back gesture, or the edge swipe, moved the page already
let moved = false;
window.addEventListener("popstate", (ev) => {
  moved ||= ev.hasUAVisualTransition;
});

const STILL = matchMedia("(prefers-reduced-motion: reduce)");

// a browser that can't type a view transition gets none: it would run one
// at every load, the first paint and a gesture's own among them
export const TURNS = CSS.supports("selector(:active-view-transition-type(a))");

// the view transition from one page to the next, typed by where the next
// page lies for app.css
export function turn({ fromLocation, toLocation, pathChanged }: { fromLocation?: { pathname: string }; toLocation: { pathname: string }; pathChanged: boolean }): string[] | false {
  const gesture = moved;
  moved = false;
  if (fromLocation === undefined || !pathChanged || gesture) {
    return false;
  }
  const depth = (path: string) => path.split("/").filter((part) => part !== "").length;
  const x = Math.sign(depth(toLocation.pathname) - depth(fromLocation.pathname));
  return [x === 0 || STILL.matches ? "fade" : x > 0 ? "deeper" : "higher"];
}

// back where the owner came from, else to a fallback, without growing the
// history: the phone's own back then leaves the same way
export function useBack(to: string): () => void {
  const router = useRouter();
  const can = useCanGoBack();
  const navigate = useNavigate();
  return useCallback(() => (can ? router.history.back() : void navigate({ to, replace: true })), [can, router, navigate, to]);
}

// what opens over a chat as a step in its history, so the phone's back
// closes it
export type Steps = { about?: 1; knobs?: 1 };

export function steps_of(s: Record<string, unknown>): Steps {
  const on = (step: keyof Steps) => s[step] === 1 || s[step] === "1";
  return { ...(on("about") ? { about: 1 } : {}), ...(on("knobs") ? { knobs: 1 } : {}) };
}

export function useStep(agent: string, step: keyof Steps): [boolean, () => void, () => void] {
  const open = useSearch({ strict: false, select: (s: Steps) => s[step] === 1 });
  const navigate = useNavigate();
  const router = useRouter();
  const show_it = useCallback(() => void navigate({ to: "/a/$agent", params: { agent }, search: step === "about" ? { about: 1 } : { knobs: 1 } }), [navigate, agent, step]);
  const hide = useCallback(() => {
    if ((router.history.location.state as { __TSR_index?: number }).__TSR_index !== 0) {
      router.history.back();
    } else {
      void navigate({ to: "/a/$agent", params: { agent }, search: {}, replace: true });
    }
  }, [router, navigate, agent]);
  return [open, show_it, hide];
}

export function Back({ to, label, className = "" }: { to: string; label: string; className?: string }): ReactNode {
  const back = useBack(to);
  return <button type="button" className={"round gl " + className} aria-label={label} onClick={back}><CaretLeftIcon size={22} weight="bold" /></button>;
}

// the page follows a finger dragged from the left edge, and leaves past a
// third of the width or at a fling
export function useEdgeBack(el: HTMLElement | null, back: () => void): void {
  useEffect(() => {
    if (!IOS_APP || el === null) {
      return undefined;
    }
    const at = { x: -1, y: 0, t: 0, dx: 0, on: false };
    const start = (ev: TouchEvent) => {
      const t = ev.touches[0];
      at.x = ev.touches.length === 1 && t !== undefined && t.clientX <= EDGE ? t.clientX : -1;
      at.y = t?.clientY ?? 0;
      at.t = ev.timeStamp;
      at.dx = 0;
      at.on = false;
    };
    const move = (ev: TouchEvent) => {
      const t = ev.touches[0];
      if (at.x < 0 || t === undefined) {
        return;
      }
      at.dx = t.clientX - at.x;
      const dy = t.clientY - at.y;
      if (!at.on && Math.abs(dy) > SLOP && Math.abs(dy) > Math.abs(at.dx)) {
        at.x = -1;
        return;
      }
      if (!at.on && at.dx > SLOP) {
        at.on = true;
        el.classList.add("dragged");
      }
      if (at.on) {
        ev.preventDefault();
        el.style.transform = "translateX(" + Math.max(0, at.dx) + "px)";
      }
    };
    const end = (ev: TouchEvent) => {
      if (!at.on) {
        at.x = -1;
        return;
      }
      const away = at.dx > el.clientWidth * FAR || at.dx / Math.max(1, ev.timeStamp - at.t) > FLING;
      el.classList.remove("dragged");
      el.style.transform = away ? "translateX(100%)" : "";
      if (away) {
        moved = true;
        setTimeout(back, OUT);
      }
      at.x = -1;
      at.on = false;
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [el, back]);
}
