import * as fs from "node:fs";
import * as zlib from "node:zlib";
import babel from "@rolldown/plugin-babel";
import tailwind from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type ProxyOptions } from "vite";

// the page talks to a Montroop server: TROOP_SERVER names the one a dev or preview
// run passes its calls to
const to = process.env.TROOP_SERVER;
const paths = ["/api", "/auth", "/media", "/image"];
const proxy: Record<string, ProxyOptions> = to === undefined ? {} : { ...Object.fromEntries(paths.map((path) => [path, { target: to }])), "/ws": { target: to, ws: true } };

const DIST = "ui/dist";

// the build's files as Web.ts imports them, each a file Bun compiles
// into the program: dist/files.ts, a map from the path a browser asks to
// the file. Each script and style also comes brotli'd at its best (NAME.br),
// too slow to do as the server starts
function files(): Plugin {
  return {
    name: "montroop-files",
    apply: "build",
    closeBundle() {
      for (const name of fs.readdirSync(DIST + "/assets").filter((name) => /\.(js|css)$/.test(name))) {
        const file = DIST + "/assets/" + name;
        fs.writeFileSync(file + ".br", zlib.brotliCompressSync(fs.readFileSync(file), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }));
      }
      const names = fs.readdirSync(DIST, { recursive: true, encoding: "utf8" }).filter((name) => name !== "files.ts" && fs.statSync(DIST + "/" + name).isFile()).map((name) => name.replaceAll("\\", "/")).sort();
      const imports = names.map((name, k) => `import f${k} from "./${name}" with { type: "file" };`);
      const map = names.map((name, k) => `  ${JSON.stringify("/" + name)}: f${k},`);
      fs.writeFileSync(DIST + "/files.ts", ["// @ts-nocheck", ...imports, "", "export default {", ...map, "};", ""].join("\n"));
    },
  };
}

// the first screen's text is in this font: the page asks for it with the
// style, not once the style is read
const FIRST_FONT = "HankenGrotesk";

function preload(): Plugin {
  return {
    name: "montroop-preload",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler: (_html, { bundle }) => Object.keys(bundle ?? {}).filter((name) => name.includes(FIRST_FONT) && name.endsWith(".woff2")).map((name) => ({
        tag: "link", attrs: { rel: "preload", href: "/" + name, as: "font", type: "font/woff2", crossorigin: "" }, injectTo: "head",
      })),
    },
  };
}

// a Phosphor icon brings its six weights, each its own drawing: the app
// draws these three, and the others stay out of the build
const DRAWN = ["regular", "bold", "fill"];
const WEIGHT = /  \[\n    "([a-z]+)",\n[\s\S]*?\n  \],?\n/g;

function weights(): Plugin {
  return {
    name: "montroop-weights",
    transform(code, id) {
      return id.includes("@phosphor-icons/react/dist/defs/") ? code.replace(WEIGHT, (entry, weight: string) => (DRAWN.includes(weight) ? entry : "")) : null;
    },
  };
}

export default defineConfig({
  root    : "ui",
  plugins : [react(), babel({ presets: [reactCompilerPreset()] }), tailwind(), weights(), preload(), files()],
  server  : { proxy },
  preview : { proxy },
});
