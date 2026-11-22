import * as fs from "node:fs";
import babel from "@rolldown/plugin-babel";
import tailwind from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type ProxyOptions } from "vite";

// the page talks to a Ki server: KI_SERVER names the one a dev or preview
// run passes its calls to
const to = process.env.KI_SERVER;
const paths = ["/api", "/auth", "/media", "/image", "/heads"];
const proxy: Record<string, ProxyOptions> = to === undefined ? {} : { ...Object.fromEntries(paths.map((path) => [path, { target: to }])), "/ws": { target: to, ws: true } };

const DIST = "ui/dist";

// the build's files as Server.ts imports them, each a file Bun compiles
// into the program: dist/files.ts, a map from the path a browser asks to
// the file
function files(): Plugin {
  return {
    name: "ki-files",
    apply: "build",
    closeBundle() {
      const names = fs.readdirSync(DIST, { recursive: true, encoding: "utf8" }).filter((name) => name !== "files.ts" && fs.statSync(DIST + "/" + name).isFile()).map((name) => name.replaceAll("\\", "/")).sort();
      const imports = names.map((name, k) => `import f${k} from "./${name}" with { type: "file" };`);
      const map = names.map((name, k) => `  ${JSON.stringify("/" + name)}: f${k},`);
      fs.writeFileSync(DIST + "/files.ts", ["// @ts-nocheck", ...imports, "", "export default {", ...map, "};", ""].join("\n"));
    },
  };
}

// a Phosphor icon brings its six weights, each its own drawing: the app
// draws these three, and the others stay out of the build
const DRAWN = ["regular", "bold", "fill"];
const WEIGHT = /  \[\n    "([a-z]+)",\n    .*\n  \],?\n/g;

function weights(): Plugin {
  return {
    name: "ki-weights",
    transform(code, id) {
      return id.includes("@phosphor-icons/react/dist/defs/") ? code.replace(WEIGHT, (entry, weight: string) => (DRAWN.includes(weight) ? entry : "")) : null;
    },
  };
}

export default defineConfig({
  root    : "ui",
  plugins : [react(), babel({ presets: [reactCompilerPreset()] }), tailwind(), weights(), files()],
  server  : { proxy },
  preview : { proxy },
});
