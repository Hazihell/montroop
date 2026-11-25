import { useId, type CSSProperties, type ReactNode } from "react";
import { BODIES, DETAILS, DRAWN, LOOKS } from "../../Looks.ts";

// An agent's avatar: a character drawn as one SVG from four picks and two
// colors. avatar.css moves it from the mood class on its root, so the
// drawing is the same for every mood.

type Shape = { d: string; ey: number; ex: number; top: number; bot: number; hw: number };

export type Look = { shape: string; eyes: string; glasses: string; extra: string; c: string; c2: string };

export type Mood = "idle" | "thinking" | "working" | "writing" | "asking" | "listening" | "done" | "error" | "sleeping";

const INK = "#0c0c12";
const { cos, sin, abs, PI, hypot } = Math;

function f(x: number): number {
  return Math.round(x * 10) / 10;
}

function polar(r: (t: number) => number, cy = 68, steps = 144): string {
  let d = "";
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * PI * 2;
    d += (i ? "L" : "M") + f(60 + r(t) * cos(t)) + " " + f(cy + r(t) * sin(t));
  }
  return d + "Z";
}

function oval(a: number, b: number, n: number): (t: number) => number {
  return (t) => 1 / ((abs(cos(t)) / a) ** n + (abs(sin(t)) / b) ** n) ** (1 / n);
}

function rounded(points: Array<[number, number]>, rad: number): string {
  let d = "";
  const k = points.length;
  points.forEach((p, i) => {
    const toward = (q: [number, number]) => {
      const l = hypot(q[0] - p[0], q[1] - p[1]);
      return f(p[0] + ((q[0] - p[0]) / l) * rad) + " " + f(p[1] + ((q[1] - p[1]) / l) * rad);
    };
    d += (i ? "L" : "M") + toward(points[(i + k - 1) % k]) + "Q" + p[0] + " " + p[1] + " " + toward(points[(i + 1) % k]);
  });
  return d + "Z";
}

function heart(): string {
  let d = "";
  for (let i = 0; i < 144; i++) {
    const t = (i / 144) * PI * 2;
    const x = 16 * sin(t) ** 3;
    const y = -(13 * cos(t) - 5 * cos(2 * t) - 2 * cos(3 * t) - cos(4 * t));
    d += (i ? "L" : "M") + f(60 + x * 2.2) + " " + f(63 + y * 2.2);
  }
  return d + "Z";
}

// d: the outline; ey, ex: the eyes' height and half spacing; top, bot:
// where a hat and a bow sit; hw: the half width at ear height
const SHAPES: Record<string, Shape> = {
  scallop  : { d: polar((t) => 33.2 + 4 * abs(sin(5 * t)) ** 0.75), ey: 65, ex: 13.5, top: 31, bot: 101, hw: 37 },
  circle   : { d: polar(() => 36, 68, 96), ey: 65, ex: 13.5, top: 32, bot: 102, hw: 36 },
  squircle : { d: polar(oval(35, 35, 4)), ey: 65, ex: 13.5, top: 33, bot: 101, hw: 35 },
  pill     : { d: polar(oval(43, 28, 4), 70), ey: 68, ex: 15.5, top: 42, bot: 96, hw: 43 },
  triangle : { d: rounded([[60, 24], [104, 100], [16, 100]], 22), ey: 76, ex: 12.5, top: 35, bot: 99, hw: 30 },
  bear     : { d: polar(oval(38, 33, 2.6), 70) + "M47 42a11 11 0 1 0-22 0a11 11 0 1 0 22 0ZM95 42a11 11 0 1 0-22 0a11 11 0 1 0 22 0Z", ey: 68, ex: 14, top: 38, bot: 101, hw: 38 },
  flower   : { d: polar((t) => 32 + 5 * cos(6 * t + PI)), ey: 66, ex: 12.5, top: 31, bot: 102, hw: 29 },
  clover   : { d: polar((t) => 31 - 6.5 * cos(4 * t)), ey: 66, ex: 12.5, top: 44, bot: 92, hw: 26 },
  heart    : { d: heart(), ey: 58, ex: 14, top: 44, bot: 96, hw: 35 },
  ghost    : { d: "M24 72A36 38 0 0 1 96 72V98q-6 7-12 0t-12 0t-12 0t-12 0t-12 0t-12 0Z", ey: 64, ex: 13.5, top: 34, bot: 97, hw: 36 },
} satisfies Record<(typeof LOOKS.shape)[number], Shape>;

function glint(x: number, y: number, r: number): string {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff"/>`;
}

// each eye is drawn around 0,0; the part that looks around carries av-p
const EYES: Record<string, string> = {
  goo   : `<circle r="9.5" fill="#fff"/><g class="av-p"><circle cx="1" cy="1" r="5.6" fill="${INK}"/>${glint(3, -1.2, 1.9)}</g>`,
  dot   : `<g class="av-p"><ellipse rx="3.8" ry="4.8" fill="${INK}"/>${glint(1.2, -1.7, 1.1)}</g>`,
  bean  : `<g class="av-p"><ellipse rx="3.4" ry="6.6" fill="${INK}"/>${glint(1, -2.6, 1.1)}</g>`,
  tall  : `<ellipse rx="6.6" ry="9.4" fill="#fff"/><g class="av-p"><circle cy="1.6" r="4" fill="${INK}"/>${glint(1.4, 0, 1.3)}</g>`,
  spark : `<g class="av-p"><circle r="7.6" fill="${INK}"/><path d="M-1.6-5.4l1.3 3 3 1.3-3 1.3-1.3 3-1.3-3-3-1.3 3-1.3Z" fill="#fff"/>${glint(3.2, 3.4, 1.3)}</g>`,
  ring  : `<circle r="7.6" fill="#fff"/><g class="av-p"><circle r="4.9" fill="${INK}"/>${glint(0, 0, 1.9)}</g>`,
  lid   : `<path d="M-8.6 0a8.6 8.6 0 0 0 17.2 0Z" fill="#fff"/><g class="av-p"><path d="M-4.3 0a4.3 4.3 0 0 0 8.6 0Z" fill="${INK}"/></g><path d="M-10.4 0h20.8" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/>`,
  wide  : `<g class="av-p"><circle r="2.9" fill="${INK}"/></g>`,
} satisfies Record<(typeof LOOKS.eyes)[number], string>;

const LINE = `fill="none" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"`;

function eyes(kind: string, s: Shape): string {
  const ex = kind === "wide" ? s.ex + 4 : s.ex;
  const one = (x: number, side: number) =>
    `<g transform="translate(${f(x)} ${s.ey})"><g class="av-eye"><g class="av-open">${EYES[kind] ?? ""}</g></g>` +
    `<path class="av-shut" d="M-6.5 0q6.5 5.5 13 0" ${LINE}/><path class="av-joy" d="M-6.5 2.5q6.5-8 13 0" ${LINE}/>` +
    `<path class="av-brow" d="M${-7 * side} -12l${11 * side} -3.6" ${LINE}/></g>`;
  return `<g class="av-eyes">${one(60 - ex, 1)}${one(60 + ex, -1)}</g>`;
}

const GLASSES: Record<string, (s: Shape) => string> = {
  none    : () => "",
  round   : (s) => {
    const [r, l, R, y] = [12, 60 - s.ex, 60 + s.ex, s.ey];
    return `<g fill="#ffffff14" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"><circle cx="${l}" cy="${y}" r="${r}"/><circle cx="${R}" cy="${y}" r="${r}"/><path d="M${l + r} ${y}h${f(R - l - 2 * r)}M${l - r} ${y}h-4M${R + r} ${y}h4"/></g>`;
  },
  square  : (s) => {
    const [l, R, y] = [60 - s.ex, 60 + s.ex, s.ey];
    return `<g fill="#ffffff14" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"><rect x="${l - 11}" y="${y - 9}" width="22" height="18" rx="5.5"/><rect x="${R - 11}" y="${y - 9}" width="22" height="18" rx="5.5"/><path d="M${l + 11} ${y - 2}h${f(R - l - 22)}M${l - 11} ${y - 2}h-4M${R + 11} ${y - 2}h4"/></g>`;
  },
  shades  : (s) => {
    const [l, R, y] = [60 - s.ex, 60 + s.ex, s.ey];
    return `<g fill="${INK}"><rect x="${l - 12}" y="${y - 7}" width="24" height="15.5" rx="6.5"/><rect x="${R - 12}" y="${y - 7}" width="24" height="15.5" rx="6.5"/><rect x="${l - 15}" y="${y - 7}" width="${f(R - l + 30)}" height="4" rx="2"/></g><path d="M${l - 6} ${y - 1.5}l5-3M${R - 6} ${y - 1.5}l5-3" stroke="#fff" stroke-opacity=".55" stroke-width="1.8" stroke-linecap="round"/>`;
  },
  monocle : (s) => {
    const [R, y] = [60 + s.ex, s.ey];
    return `<g fill="#ffffff1c" stroke="#f3c74f" stroke-linecap="round"><circle cx="${R}" cy="${y}" r="12" stroke-width="2.6"/><path d="M${R + 8} ${y + 9}q9 13 3 27" fill="none" stroke-width="1.5"/></g>`;
  },
  visor   : (s) => {
    const [l, y] = [60 - s.ex - 13, s.ey - 9.5];
    return `<rect x="${f(l)}" y="${y}" width="${f(2 * s.ex + 26)}" height="19" rx="9.5" fill="color-mix(in oklab,var(--c2) 42%,transparent)" stroke="#ffffffb0" stroke-width="1.6"/><path d="M${f(l + 8)} ${y + 5}h9" stroke="#fff" stroke-opacity=".7" stroke-width="1.8" stroke-linecap="round"/>`;
  },
} satisfies Record<(typeof LOOKS.glasses)[number], (s: Shape) => string>;

// av-sway swings from the top of the head, behind the body's own motion
const EXTRAS: Record<string, (s: Shape) => string> = {
  none    : () => "",
  pom     : (s) => `<g class="av-sway"><circle cx="60" cy="${s.top - 6}" r="10" fill="var(--c2)"/><ellipse cx="56.5" cy="${s.top - 9.5}" rx="3.6" ry="2.4" fill="#fff" opacity=".4"/></g>`,
  antenna : (s) => `<g class="av-sway"><path d="M60 ${s.top + 3}v-16" stroke="var(--av-line)" stroke-width="2.6" stroke-linecap="round"/><circle class="av-halo" cx="60" cy="${s.top - 16}" r="9" fill="var(--c2)" opacity=".28"/><circle class="av-tip" cx="60" cy="${s.top - 16}" r="5" fill="var(--c2)"/></g>`,
  phones  : (s) => {
    const [l, R] = [60 - s.hw - 2, 60 + s.hw + 2];
    return `<path d="M${l} 66A${s.hw + 2} ${71 - s.top} 0 0 1 ${R} 66" fill="none" stroke="var(--av-line)" stroke-width="4" stroke-linecap="round"/><rect x="${l - 7}" y="56" width="12" height="24" rx="6" fill="var(--c2)"/><rect x="${R - 5}" y="56" width="12" height="24" rx="6" fill="var(--c2)"/>`;
  },
  bow     : (s) => {
    const y = s.bot - 9;
    return `<path d="M60 ${y}l-13-7.5v15ZM60 ${y}l13-7.5v15Z" fill="var(--c2)" stroke="var(--c2)" stroke-width="3" stroke-linejoin="round"/><circle cx="60" cy="${y}" r="3.6" fill="color-mix(in oklab,var(--c2) 70%,#000)"/>`;
  },
  cap     : (s) => `<path d="M42 ${s.top + 7}a18 17 0 0 1 36 0Z" fill="var(--c2)"/><rect x="39" y="${s.top + 4}" width="42" height="7" rx="3.5" fill="color-mix(in oklab,var(--c2) 60%,#fff)"/><circle cx="60" cy="${s.top - 10}" r="3.6" fill="color-mix(in oklab,var(--c2) 60%,#fff)"/>`,
  beret   : (s) => `<g transform="rotate(-12 60 ${s.top})"><ellipse cx="57" cy="${s.top + 1}" rx="21" ry="9.5" fill="var(--c2)"/><path d="M58 ${s.top - 8}v-5" stroke="var(--c2)" stroke-width="3" stroke-linecap="round"/></g>`,
  crown   : (s) => `<path d="M46 ${s.top + 6}l-3-17 9 8 8-12 8 12 9-8-3 17Z" fill="#ffc93c" stroke="#ffc93c" stroke-width="2.4" stroke-linejoin="round"/>`,
  sprout  : (s) => `<g class="av-sway"><path d="M60 ${s.top + 3}v-10" stroke="#49c774" stroke-width="2.8" stroke-linecap="round"/><path d="M60 ${s.top - 6}q-13-10-17 2q11 6 17-2ZM60 ${s.top - 6}q13-10 17 2q-11 6-17-2Z" fill="#49c774"/></g>`,
  halo    : (s) => `<ellipse cx="60" cy="${s.top - 9}" rx="17" ry="5" fill="none" stroke="#ffe08a" stroke-width="3.4"/>`,
} satisfies Record<(typeof LOOKS.extra)[number], (s: Shape) => string>;

function star(x: number, y: number, k: number): string {
  return `<g transform="translate(${x} ${y}) scale(${k})"><path d="M0-7l1.8 5.2 5.2 1.8-5.2 1.8L0 7l-1.8-5.2L-7 0l5.2-1.8Z" fill="var(--av-fx)"/></g>`;
}

const FX_BACK =
  `<g class="fx-work"><circle cx="60" cy="66" r="52" fill="none" stroke="var(--av-act)" stroke-opacity=".16" stroke-width="3.4"/><circle class="av-orbit" cx="60" cy="66" r="52" fill="none" stroke="var(--av-act)" stroke-width="3.4" stroke-linecap="round" stroke-dasharray="74 253"/></g>` +
  `<g class="fx-ask" fill="none" stroke="var(--av-act)" stroke-width="3"><circle cx="60" cy="68" r="40"/><circle cx="60" cy="68" r="40"/></g>`;

const FX =
  `<g class="fx-think" fill="var(--av-fx)"><circle cx="89" cy="31" r="3.2"/><circle cx="98" cy="22" r="4.4"/><circle cx="109" cy="11" r="5.6"/></g>` +
  `<g class="fx-write"><rect x="80" y="8" width="34" height="19" rx="9.5" fill="var(--av-fx)" fill-opacity=".16" stroke="var(--av-fx)" stroke-opacity=".35" stroke-width="1"/><g fill="var(--av-fx)"><circle cx="89" cy="17.5" r="2.5"/><circle cx="97" cy="17.5" r="2.5"/><circle cx="105" cy="17.5" r="2.5"/></g></g>` +
  `<g class="fx-sleep" fill="none" stroke="var(--av-fx)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M88 20h8l-8 9h8"/><path d="M88 20h8l-8 9h8"/><path d="M88 20h8l-8 9h8"/></g>` +
  `<g class="fx-done">${star(20, 34, 1)}${star(101, 26, 1.25)}${star(106, 62, 0.8)}</g>` +
  `<g class="fx-error"><path d="M94 40q5 7 5 10a5 5 0 0 1-10 0q0-3 5-10Z" fill="#7cc4ff"/></g>` +
  `<g class="fx-listen" fill="none" stroke="var(--av-act)" stroke-width="3" stroke-linecap="round"><path d="M14 54q-7 12 0 24"/><path d="M5 47q-11 19 0 38"/><path d="M106 54q7 12 0 24"/><path d="M115 47q11 19 0 38"/></g>`;

// the look an agent has before its owner draws one: picked by its id, so it
// is the same on every screen
function look_first(id: string): Look {
  let h = 2166136261;
  for (const ch of id) {
    h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  }
  const pick = (list: readonly string[]) => {
    h = Math.imul(h ^ (h >>> 13), 2654435761) >>> 0;
    return list[h % list.length];
  };
  return { shape: pick(LOOKS.shape), eyes: pick(LOOKS.eyes), glasses: pick(["none", "none", ...LOOKS.glasses]), extra: pick(LOOKS.extra), c: pick(BODIES.slice(0, 9)), c2: pick(DETAILS) };
}

// an agent's picture as a look: a drawn one's own, else its first look
export function look_of(picture: string, id: string): Look {
  const m = DRAWN.exec(picture);
  if (m === null || !(m[1] in SHAPES) || !(m[2] in EYES) || !(m[3] in GLASSES) || !(m[4] in EXTRAS)) {
    return look_first(id);
  }
  return { shape: m[1], eyes: m[2], glasses: m[3], extra: m[4], c: m[5], c2: m[6] };
}

export function look_text(l: Look): string {
  return "av:" + [l.shape, l.eyes, l.glasses, l.extra, l.c, l.c2].join(".");
}

function drawn(l: Look, id: string): string {
  const s = SHAPES[l.shape];
  const extra = (EXTRAS[l.extra])(s);
  const front = l.extra === "phones" || l.extra === "bow";
  return (
    `<svg viewBox="0 0 120 120" aria-hidden="true">` +
    `<defs><radialGradient id="${id}" cx=".32" cy=".24" r=".95"><stop offset="0" class="av-g0"/><stop offset=".44" class="av-g1"/><stop offset="1" class="av-g2"/></radialGradient></defs>` +
    `<g class="av-fx">${FX_BACK}</g><g class="av-all"><g class="av-body">${front ? "" : extra}` +
    `<path d="${s.d}" fill="url(#${id})" stroke="url(#${id})" stroke-width="4" stroke-linejoin="round"/>` +
    `<ellipse cx="45" cy="${s.ey - 17}" rx="11" ry="6" transform="rotate(-28 45 ${s.ey - 17})" fill="#fff" opacity=".2"/>` +
    `${eyes(l.eyes, s)}${(GLASSES[l.glasses])(s)}${front ? extra : ""}</g></g>` +
    `<g class="av-fx">${FX}</g></svg>`
  );
}

type Vars = CSSProperties & { "--c": string; "--c2": string; "--top": string };

export function Avatar({ look, mood = "idle", size, lit = false }: { look: Look; mood?: Mood; size: number; lit?: boolean }): ReactNode {
  const id = "av" + useId().replace(/\W/g, "");
  const style: Vars = { width: size, height: size, "--c": "#" + look.c, "--c2": "#" + look.c2, "--top": (SHAPES[look.shape]).top + "px" };
  return <span className={"av s-" + mood + (lit ? " lit" : "")} style={style} dangerouslySetInnerHTML={{ __html: drawn(look, id) }} />;
}

// a shape alone, as a choice in the editor
export function Outline({ shape, size }: { shape: string; size: number }): ReactNode {
  return <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden="true"><path d={(SHAPES[shape]).d} fill="currentColor" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" /></svg>;
}

// the loop of public/mark.svg, on its 64 grid
const LOOP = "M32 32c-4.73-7.27-9.47-10.5-14.2-10.5a10.5 10.5 0 0 0 0 21c4.73 0 9.47-3.23 14.2-10.5s9.47-10.5 14.2-10.5a10.5 10.5 0 0 1 0 21c-4.73 0-9.47-3.23-14.2-10.5z";

// the picture "logo": Montroop's mark as a launcher shows the app's icon
function Logo({ size }: { size: number }): ReactNode {
  return (
    <svg className="face" style={{ background: "none" }} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="28" fill="#6e56f8" />
      <path d={LOOP} transform="translate(11.39 11.39) scale(0.644)" fill="none" stroke="#fff" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// an agent's face wherever it shows: its uploaded picture, Montroop's mark, else its avatar
export function Face({ picture, id, mood, size, lit }: { picture: string; id: string; mood?: Mood; size: number; lit?: boolean }): ReactNode {
  if (picture === "logo") {
    return <Logo size={size} />;
  }
  if (picture.startsWith("/media/")) {
    return <img className="face" style={{ width: size, height: size }} src={picture} alt="" />;
  }
  return <Avatar look={look_of(picture, id)} mood={mood} size={size} lit={lit} />;
}
