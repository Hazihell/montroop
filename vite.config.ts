import babel from "@rolldown/plugin-babel";
import tailwind from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

// the page talks to a Ki server: KI_SERVER names the one a dev or preview
// run passes its calls to
const to = process.env.KI_SERVER;
const paths = ["/api", "/auth", "/media", "/image", "/heads", "/mark.svg"];
const proxy: Record<string, ProxyOptions> = to === undefined ? {} : { ...Object.fromEntries(paths.map((path) => [path, { target: to }])), "/ws": { target: to, ws: true } };

export default defineConfig({
  root    : "ui",
  plugins : [react(), babel({ presets: [reactCompilerPreset()] }), tailwind()],
  server  : { proxy },
  preview : { proxy },
});
