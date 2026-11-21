import { CaretLeftIcon, CaretRightIcon, DownloadSimpleIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type PointerEvent, type ReactNode, type WheelEvent } from "react";
import { create } from "zustand";

type Pic = { src: string; name: string };

// the picture open, among the chat's pictures on screen
const useViewer = create<{ pics: Pic[]; at: number }>(() => ({ pics: [], at: -1 }));

const MOST = 8;
const TWICE = 300;
const SWIPE = 60;

// a picture of the chat opens over it, with the others on screen to step to
export function viewer_open(img: HTMLImageElement): void {
  const all = [...document.querySelectorAll<HTMLImageElement>("img.media")];
  const pics = (all.includes(img) ? all : [img]).map((el) => ({ src: el.currentSrc || el.src, name: el.alt.trim() || (el.src.split("/").pop() ?? "") }));
  useViewer.setState({ pics, at: Math.max(0, all.indexOf(img)) });
}

type Spot = { z: number; x: number; y: number };

const REST: Spot = { z: 1, x: 0, y: 0 };

// one picture on the stage: pinched, wheeled or double tapped to zoom,
// dragged while zoomed, swiped to the next or down to close
function Stage({ pic, step, shut }: { pic: Pic; step: (by: number) => void; shut: () => void }): ReactNode {
  const stage = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState(REST);
  const [failed, setFailed] = useState(false);
  const [held, setHeld] = useState(false);
  const touch = useRef({ ids: new Map<number, { x: number; y: number }>(), gap: 0, from: REST, start: { x: 0, y: 0 }, last: 0, moved: false });

  const reach = (z: number): [number, number] => [(stage.current?.clientWidth ?? 0) / 2 * (z - 1), (stage.current?.clientHeight ?? 0) / 2 * (z - 1)];
  const kept = (z: number, x: number, y: number): Spot => {
    const [w, h] = reach(z);
    return z === 1 ? REST : { z, x: Math.min(w, Math.max(-w, x)), y: Math.min(h, Math.max(-h, y)) };
  };
  const zoom = (to: number, cx: number, cy: number, from: Spot) => {
    const z = Math.min(MOST, Math.max(1, to));
    const [w, h] = [(stage.current?.clientWidth ?? 0) / 2, (stage.current?.clientHeight ?? 0) / 2];
    const k = z / from.z;
    setSpot(kept(z, cx - w - (cx - w - from.x) * k, cy - h - (cy - h - from.y) * k));
  };

  const down = (ev: PointerEvent) => {
    const t = touch.current;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    t.ids.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    t.from = spot;
    t.moved = false;
    setHeld(true);
    const [a, b] = [...t.ids.values()];
    t.start = b === undefined ? { x: ev.clientX, y: ev.clientY } : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    t.gap = b === undefined ? 0 : Math.hypot(a.x - b.x, a.y - b.y);
  };

  const move = (ev: PointerEvent) => {
    const t = touch.current;
    if (!t.ids.has(ev.pointerId)) {
      return;
    }
    t.ids.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const [a, b] = [...t.ids.values()];
    if (b !== undefined && t.gap > 0) {
      t.moved = true;
      zoom(t.from.z * (Math.hypot(a.x - b.x, a.y - b.y) / t.gap), t.start.x, t.start.y, t.from);
      return;
    }
    const [dx, dy] = [a.x - t.start.x, a.y - t.start.y];
    t.moved ||= Math.hypot(dx, dy) > 6;
    if (t.from.z > 1 && t.moved) {
      setSpot(kept(t.from.z, t.from.x + dx, t.from.y + dy));
    }
  };

  const up = (ev: PointerEvent) => {
    const t = touch.current;
    const pinched = t.gap > 0;
    t.ids.delete(ev.pointerId);
    setHeld(t.ids.size > 0);
    if (t.ids.size > 0 || pinched) {
      t.gap = 0;
      t.from = spot;
      const [a] = [...t.ids.values()];
      t.start = a ?? t.start;
      t.moved = true;
      return;
    }
    const [dx, dy] = [ev.clientX - t.start.x, ev.clientY - t.start.y];
    if (t.from.z === 1 && Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy) * 1.5) {
      step(dx < 0 ? 1 : -1);
    } else if (t.from.z === 1 && dy > SWIPE * 1.5 && dy > Math.abs(dx) * 1.5) {
      shut();
    } else if (!t.moved && ev.timeStamp - t.last < TWICE) {
      zoom(spot.z > 1 ? 1 : 2.5, ev.clientX, ev.clientY, spot);
      t.last = 0;
    } else if (!t.moved) {
      t.last = ev.timeStamp;
    }
  };

  return (
    <div ref={stage} className="stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={(ev: WheelEvent) => zoom(spot.z * Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.002)), ev.clientX, ev.clientY, spot)}>
      {failed
        ? <p>Could not load this picture.</p>
        : <img src={pic.src} alt={pic.name} draggable={false} onError={() => setFailed(true)} style={{ transform: `translate(${spot.x}px, ${spot.y}px) scale(${spot.z})`, transition: held ? "none" : undefined }} />}
      {spot.z === 1 ? null : <span>{Math.round(spot.z * 100)}%</span>}
    </div>
  );
}

export function Viewer(): ReactNode {
  const pics = useViewer((s) => s.pics);
  const at = useViewer((s) => s.at);
  const pic = pics[at];
  const box = useRef<HTMLDialogElement>(null);
  const step = (by: number) => {
    if (at + by >= 0 && at + by < pics.length) {
      useViewer.setState({ at: at + by });
    }
  };
  useEffect(() => {
    const el = box.current;
    if (pic !== undefined && el !== null && !el.open) {
      el.showModal();
    }
  }, [pic]);
  if (pic === undefined) {
    return null;
  }
  return (
    <dialog ref={box} className="viewer" aria-label="Picture" onClose={() => useViewer.setState({ pics: [], at: -1 })} onKeyDown={(ev) => (ev.key === "ArrowLeft" ? step(-1) : ev.key === "ArrowRight" ? step(1) : undefined)}>
      <header>
        <p>{pic.name}</p>
        <a className="round small" href={pic.src} download={pic.name} aria-label="Download"><DownloadSimpleIcon size={20} weight="bold" /></a>
        <button type="button" className="round small" aria-label="Close" autoFocus onClick={() => box.current?.close()}><XIcon size={20} weight="bold" /></button>
      </header>
      <Stage key={pic.src} pic={pic} step={step} shut={() => box.current?.close()} />
      {at > 0 ? <button type="button" className="round gl prev" aria-label="Previous picture" onClick={() => step(-1)}><CaretLeftIcon size={20} weight="bold" /></button> : null}
      {at < pics.length - 1 ? <button type="button" className="round gl next" aria-label="Next picture" onClick={() => step(1)}><CaretRightIcon size={20} weight="bold" /></button> : null}
    </dialog>
  );
}
