import * as fs from "node:fs";
import * as zlib from "node:zlib";
import * as config from "./Config.ts";
import type { Room } from "./Memory.ts";
import { Owner } from "./Owner.ts";
import { Team } from "./Team.ts";
import { MEDIA } from "./View.ts";
import files from "./ui/dist/files.ts";

export const FULL = "Montroop's disk is full; try again soon.";
const SPARE      = 2 ** 30;

const PAGE_CSP   = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; font-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-same-origin allow-popups";
const PAGE_BASE  = `<!doctype html><meta charset="utf-8"><base target="_blank"><style>:root { color-scheme: light dark; } body { margin: 10px 12px; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif; color: #111111; background: #ffffff; } a { color: inherit; } @media (prefers-color-scheme: dark) { body { color: #e3e3e6; background: #171719; } }</style>\n`;

// the app's files as vite built them (bun run ui), each path a browser
// asks with its file: imported as files, paths
const UI         = Object.fromEntries(Object.entries(files).map(([name, file]) => [name, file_path(file)]));
const PAGE       = file_path(UI["/index.html"]);
const SW         = file_path(UI["/sw.js"]);

const WEB: Record<string, string> = { ...UI, "/": PAGE };

// the app's own places, each the page; an agent's are AGENT_PAGE's
for (const place of ["/settings", "/tree", "/new", "/running", "/memory", "/team"]) {
  WEB[place] = PAGE;
}

// an agent's pages: /a/<id>, its /edit, /look, /running, /memory, /tree,
// /s/<Name> (a subagent's chat) and /w/<session id>
const AGENT_PAGE = /^\/a\/[a-z0-9]{1,16}(\/edit|\/look|\/running|\/memory|\/tree|\/s\/[A-Za-z]{2,40}|\/w\/[0-9a-f]{8})?$/;

// vite names these by what is in them, so one never changes
const NAMED_BY_HASH = "/assets/";
// asked again each time, and answered "the same" while the build is
const ASKED_AGAIN = [PAGE, SW, file_path(UI["/manifest.webmanifest"])];
// what a page needs to open with no network: the service worker keeps them
const SHELL      = ["/", ...Object.keys(UI).filter((name) => name.startsWith(NAMED_BY_HASH) && !name.endsWith(".br")), "/mark.svg", "/manifest.webmanifest", "/icon-192.png"];
export const BUILD = Bun.hash(Buffer.concat(Object.keys(UI).sort().map((name) => fs.readFileSync(file_path(UI[name]))))).toString(36);
const INDEX      = fs.readFileSync(PAGE, "utf8").replace("<html ", `<html data-build="${BUILD}" `);
const WORKER     = fs.readFileSync(SW, "utf8").replace("{build}", BUILD).replace("{shell}", SHELL.join(" "));
const STAMPED_WITH_BUILD = new Map([[SW, WORKER]]);
// the scripts and styles, as a browser that takes gzip gets them; one that
// takes brotli gets the build's NAME.br
const ZIPPED     = new Map(Object.keys(UI).filter((name) => name.startsWith(NAMED_BY_HASH) && /\.(js|css)$/.test(name)).map((name) => [name, Bun.gzipSync(fs.readFileSync(file_path(UI[name])))]));
// a page made at each ask, with its chat's first messages, brotli'd fast
const PAGE_BROTLI = { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } };

let held = 0;

// whether a browser takes a coding: named in its accept-encoding, and not
// with q=0
function takes(req: Request, coding: string): boolean {
  return (req.headers.get("accept-encoding") ?? "").split(",").some((part) => {
    const [name, ...params] = part.split(";").map((word) => word.trim());
    return name === coding && !params.some((param) => /^q=0(\.0*)?$/.test(param));
  });
}

function stream_after(head: Uint8Array, tail: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = tail.getReader();
  let first = true;
  return new ReadableStream({
    async pull(out) {
      if (first) {
        first = false;
        return out.enqueue(head);
      }
      const got = await reader.read();
      return got.done ? out.close() : out.enqueue(got.value);
    },
    cancel() {
      return reader.cancel();
    },
  });
}

function file_path(x: unknown): string {
  if (typeof x !== "string") {
    throw new Error("an imported file is no path: " + String(x));
  }
  return x;
}

export function file(pathname: string, req: Request, opening: (agent: string | null) => string): Response {
  const file = WEB[AGENT_PAGE.test(pathname) ? "/" : pathname];
  if (file === undefined) {
    return new Response("not found", { status: 404 });
  }
  if (pathname.startsWith(NAMED_BY_HASH)) {
    const headers = { "cache-control": "public, max-age=31536000, immutable", vary: "accept-encoding" };
    const brotli = WEB[pathname + ".br"];
    if (brotli !== undefined && takes(req, "br")) {
      return new Response(Bun.file(brotli), { headers: { ...headers, "content-encoding": "br", "content-type": Bun.file(file).type } });
    }
    const zipped = ZIPPED.get(pathname);
    if (zipped !== undefined && takes(req, "gzip")) {
      return new Response(zipped, { headers: { ...headers, "content-encoding": "gzip", "content-type": Bun.file(file).type } });
    }
    return new Response(Bun.file(file), { headers });
  }
  if (!ASKED_AGAIN.includes(file)) {
    return new Response(Bun.file(file));
  }
  // the page also names the first agent in the list, so a page cached for another goes
  const first = file === PAGE ? Team.first().id : "";
  if (file === PAGE && req.headers.get("sec-fetch-mode") === "navigate") {
    return navigated(req, first, opening);
  }
  const headers = new Headers({ "cache-control": "no-cache", etag: `"${BUILD}${first === "" ? "" : "-" + first}"` });
  if (req.headers.get("if-none-match") === headers.get("etag")) {
    return new Response(null, { status: 304, headers });
  }
  const made = file === PAGE ? INDEX.replace("<html ", `<html data-first="${first}" `) : STAMPED_WITH_BUILD.get(file) ?? null;
  if (made === null) {
    return new Response(Bun.file(file), { headers });
  }
  headers.set("content-type", file === PAGE ? "text/html;charset=utf-8" : "text/javascript;charset=utf-8");
  return new Response(made, { headers });
}

// a page the browser opens itself, not one the service worker keeps,
// says whether it is signed in, and brings its chat's first messages
// (#185)
function navigated(req: Request, first: string, opening: (agent: string | null) => string): Response {
  const url = new URL(req.url);
  const signed = Owner.is(req);
  const id = /^\/a\/([a-z0-9]{1,16})/.exec(url.pathname)?.[1] ?? (url.pathname === "/tree" ? url.searchParams.get("a") : null);
  const page = INDEX.replace("<html ", `<html data-first="${first}" data-signed="${signed ? "in" : "out"}" `);
  const made = signed ? page.replace("</body>", () => `<script type="application/json" id="opening">${opening(id)}</script>\n</body>`) : page;
  const headers = { "content-type": "text/html;charset=utf-8", "cache-control": "no-store", vary: "accept-encoding" };
  if (takes(req, "br")) {
    return new Response(zlib.brotliCompressSync(made, PAGE_BROTLI), { headers: { ...headers, "content-encoding": "br" } });
  }
  if (takes(req, "gzip")) {
    return new Response(Bun.gzipSync(made), { headers: { ...headers, "content-encoding": "gzip" } });
  }
  return new Response(made, { headers });
}

export function full(): boolean {
  const disk = fs.statfsSync(config.DIR);
  return disk.bavail * disk.bsize < SPARE;
}

export function room(file: string, size: number | null): Room | string {
  const free = () => {
    const disk = fs.statfsSync(config.DIR);
    return disk.bavail * disk.bsize - SPARE - held;
  };
  const cap = file + " is over the media store's " + Math.round(config.MEDIA_MAX / 2 ** 20) + " MB (config media_mb).";
  if (size !== null && !(size >= 0)) {
    return "An upload says no size it can have.";
  }
  if (size !== null && size > config.MEDIA_MAX) {
    return cap;
  }
  if (size !== null && size > free()) {
    return FULL;
  }
  let [mine, got] = [size ?? 0, 0];
  held += mine;
  return {
    take(n) {
      if (got + n > (size ?? config.MEDIA_MAX)) {
        return size === null ? cap : file + " is longer than its upload said.";
      }
      if (size === null && n > free()) {
        return FULL;
      }
      held += size === null ? n : 0;
      mine += size === null ? n : 0;
      got += n;
      return null;
    },
    wrote(n) {
      held -= n;
      mine -= n;
    },
    end() {
      held -= mine;
      mine = 0;
    },
  };
}

export function media(file: string | null, req: Request): Response {
  if (file === null) {
    return new Response("not found", { status: 404 });
  }
  const type = MEDIA.get(file.split(".").pop() ?? "");
  const size = fs.statSync(file).size;
  const headers: Record<string, string> = { "content-type": type ?? "application/octet-stream", "cache-control": "private, max-age=31536000, immutable", "accept-ranges": "bytes", "x-content-type-options": "nosniff" };
  if (type === undefined) {
    headers["content-disposition"] = "attachment";
    headers["content-security-policy"] = "default-src 'none'; sandbox";
  }
  if (type === "image/svg+xml") {
    headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  }
  if (type === "text/html") {
    headers["content-security-policy"] = PAGE_CSP;
    return new Response(stream_after(new TextEncoder().encode(PAGE_BASE), Bun.file(file).stream()), { headers });
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range === null || range[1] + range[2] === "") {
    return new Response(Bun.file(file), { headers });
  }
  const [a, b] = range[1] === "" ? [Math.max(0, size - Number(range[2])), size - 1] : [Number(range[1]), Math.min(size - 1, range[2] === "" ? Infinity : Number(range[2]))];
  if (a > b) {
    return new Response(null, { status: 416, headers: { ...headers, "content-range": "bytes */" + size } });
  }
  return new Response(Bun.file(file).slice(a, b + 1), { status: 206, headers: { ...headers, "content-range": "bytes " + a + "-" + b + "/" + size } });
}
