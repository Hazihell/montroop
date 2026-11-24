import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Face, type Mood } from "./Avatar.tsx";

// small faces in a row, overlapping, each acting out its own mood: what
// works for someone, at a glance. Seed: what its face is drawn from, the
// same face for the same seed
export type Mini = { key: string; seed: string; mood: Mood };

type Kept = Mini & { gone: boolean };

// how long a face takes to leave; app.css moves it as long
const OUT = 200;
const STILL = matchMedia("(prefers-reduced-motion: reduce)");

// the faces to draw: the items, and those just gone, where they were, till
// they have left (at once, for less motion); one back before it has left
// stays
function kept_next(kept: Kept[], items: Mini[]): Kept[] {
  const next: Kept[] = items.map((m) => ({ ...m, gone: false }));
  kept.forEach((k, at) => {
    if (!STILL.matches && !items.some((m) => m.key === k.key)) {
      next.splice(Math.min(at, next.length), 0, { ...k, gone: true });
    }
  });
  return next;
}

function same(a: Kept[], b: Kept[]): boolean {
  return a.length === b.length && a.every((k, i) => k.key === b[i].key && k.mood === b[i].mood && k.gone === b[i].gone);
}

// most: faces drawn before the rest are counted ("+2"); label: all of them
// in words, for a screen reader
export function Minis({ items, label, most = 3, size = 24 }: { items: Mini[]; label: string; most?: number; size?: number }): ReactNode {
  const [kept, setKept] = useState<Kept[]>(() => kept_next([], items));
  const next = kept_next(kept, items);
  if (!same(kept, next)) {
    setKept(next);
  }
  const leaving = kept.some((k) => k.gone);
  useEffect(() => {
    if (!leaving) {
      return undefined;
    }
    const timer = setTimeout(() => setKept((all) => all.filter((k) => !k.gone)), OUT);
    return () => clearTimeout(timer);
  }, [leaving, kept]);
  const shown = kept.slice(0, most);
  const more = items.length - shown.filter((k) => !k.gone).length;
  if (kept.length === 0) {
    return null;
  }
  return (
    <span className="minis" role="img" aria-label={label} style={{ "--mini": size + "px" } as CSSProperties}>
      {shown.map((k) => (
        <span key={k.key} className={"mini" + (k.gone ? " gone" : "")}>
          <Face picture="" id={k.seed} mood={k.mood} size={size} />
        </span>
      ))}
      {more > 0 ? <span className="mini more">+{more}</span> : null}
    </span>
  );
}
