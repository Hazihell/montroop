import { create } from "zustand";

// how the owner set the look on this device: the one color of the palette,
// and light or dark

export type Theme = "system" | "dark" | "light";

type Prefs = { accent: string; theme: Theme };

export const ACCENTS = ["6e56f8", "2f6fed", "13a3b8", "1fa971", "d9a116", "d9683f", "e0457b", "8b8b96"];

const KEY = "ki.look";
// app.css's --ground
const GROUND = { light: "#f4f3ef", dark: "#08080a" };
const HEX = /^[0-9a-f]{6}$/;

function read(): Prefs {
  const [accent, theme] = (localStorage.getItem(KEY) ?? "").split(" ");
  return { accent: accent !== undefined && HEX.test(accent) ? accent : (ACCENTS[0]), theme: theme === "dark" || theme === "light" ? theme : "system" };
}

// the ink that reads on the accent: dark on a light one
function ink_on(hex: string): string {
  const [r, g, b] = [0, 2, 4].map((k) => {
    const c = parseInt(hex.slice(k, k + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.36 ? "#0c0c12" : "#fff";
}

function apply(p: Prefs): void {
  const root = document.documentElement;
  root.style.setProperty("--act", "#" + p.accent);
  root.style.setProperty("--on-act", ink_on(p.accent));
  if (p.theme === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = p.theme;
  }
  // the browser's own bars take the ground's color: the system's, or the
  // one chosen here
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const dark = p.theme === "system" ? meta.media.includes("dark") : p.theme === "dark";
    meta.content = dark ? GROUND.dark : GROUND.light;
  }
}

export const usePrefs = create<Prefs>(read);

export function prefs_set(next: Partial<Prefs>): void {
  const p = { ...usePrefs.getState(), ...next };
  if (!HEX.test(p.accent)) {
    return;
  }
  localStorage.setItem(KEY, p.accent + " " + p.theme);
  usePrefs.setState(p);
  apply(p);
}

apply(usePrefs.getState());
