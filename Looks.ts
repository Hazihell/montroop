// A drawn look: an agent's picture as "av:shape.eyes.glasses.extra.body.detail",
// four parts the app draws (ui/src/Avatar.tsx) and two colors as six hex
// digits, the app's own offered first. The order is the app's, which an
// agent's first look is picked by.

export const LOOKS = {
  shape   : ["scallop", "circle", "squircle", "pill", "triangle", "bear", "flower", "clover", "heart", "ghost"],
  eyes    : ["goo", "dot", "bean", "tall", "spark", "ring", "lid", "wide"],
  glasses : ["none", "round", "square", "shades", "monocle", "visor"],
  extra   : ["none", "pom", "antenna", "phones", "bow", "cap", "beret", "crown", "sprout", "halo"],
} as const;

export type Part = keyof typeof LOOKS;

export const BODIES  = ["ff5fa2", "c95cf0", "a25bff", "3f6bff", "2bb3ff", "19c2a0", "7ed957", "ffc531", "ff7d3b", "ecebf5"];
export const DETAILS = ["ff5fa2", "c95cf0", "a25bff", "3f6bff", "2bb3ff", "35d6c2", "7ed957", "ffc93c", "ff5a5f", "f4efe4"];

const DRAWN = /^av:([a-z]+)\.([a-z]+)\.([a-z]+)\.([a-z]+)\.[0-9a-f]{6}\.[0-9a-f]{6}$/;

// why a drawn look the app can't draw, or null (not a drawn look: null too)
export function look_wrong(picture: string): string | null {
  const m = DRAWN.exec(picture);
  if (m === null) {
    return null;
  }
  const parts = Object.keys(LOOKS) as Part[];
  const k = parts.findIndex((part, i) => !(LOOKS[part] as readonly string[]).includes(m[i + 1]));
  return k === -1 ? null : "No " + parts[k] + " " + m[k + 1] + " in a drawn look; one of: " + LOOKS[parts[k]].join(", ") + ".";
}

// the parts and colors, as a line for an agent
export function looks_said(): string {
  const parts = (Object.keys(LOOKS) as Part[]).map((part) => part + ": " + LOOKS[part].join(", "));
  return "a drawn look av:shape.eyes.glasses.extra.body.detail, " + parts.join("; ") + "; body and detail: six hex digits, such as body " + BODIES.join(", ") + "; detail " + DETAILS.join(", ");
}
