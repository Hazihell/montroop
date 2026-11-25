import { DIR } from "../home.ts";
import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

// agent-browser stood in for by a script that says how it was run
const bin = path.join(path.dirname(DIR), "bin");
fs.mkdirSync(bin, { recursive: true });
fs.writeFileSync(path.join(bin, "agent-browser"), "#!/bin/sh\necho \"cwd=$PWD\"\nfor a in \"$@\"; do echo \"arg=$a\"; done\nenv | grep '^AGENT_BROWSER' || true\n", { mode: 0o755 });
fs.writeFileSync(path.join(DIR, "config.json"), JSON.stringify({ agent_browser: path.join(bin, "agent-browser") }));
const { Browser } = await import("../../Browser.ts");

const dir = path.join(DIR, "sessions", "5e551011");
Browser.make(dir, "5e551011");

function browser(...args: string[]): { code: number; out: string[]; err: string } {
  const r = Bun.spawnSync([Browser.script(dir), ...args], { env: { ...process.env, AGENT_BROWSER_CDP: "9222", AGENT_BROWSER_AUTO_CONNECT: "1" } });
  return { code: r.exitCode, out: r.stdout.toString().split("\n").filter((l) => l !== ""), err: r.stderr.toString() };
}

test("the session's browser refuses whatever would attach it to another browser, session or profile", () => {
  const refused = [
    ["--cdp", "9222", "open", "x"], ["open", "x", "--cdp=9222"], ["connect", "9222"], ["--json", "connect", "9222"], ["--auto-connect", "open", "x"],
    ["--profile", "Default", "open", "x"], ["--session", "other", "open", "x"], ["--namespace", "other", "open", "x"], ["-p", "browserbase", "open", "x"],
    ["--executable-path", "/usr/bin/brave-browser", "open", "x"], ["batch", "connect 9222"], ["--json", "batch"], ["mcp"], ["--headed", "open", "x"],
  ];
  for (const args of refused) {
    const r = browser(...args);
    expect([args, r.code, r.out]).toEqual([args, 2, []]);
  }
  expect(browser("--cdp", "9222", "get", "url").err).toBe("browser: '--cdp' isn't taken here: this is your own browser, it connects to no other and takes one command at a time\n");
});

test("it runs agent-browser on the session's own session, profile and settings, from its media folder, without the variables that would point it elsewhere", () => {
  const out = browser("open", "http://127.0.0.1:8000/").out;
  expect(out.filter((l) => l.startsWith("AGENT_BROWSER"))).toEqual([]);
  const [cwd, ...args] = out.map((l) => l.replace(/^\w+=/, ""));
  expect(cwd).toBe(path.join(dir, "media"));
  const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : "missing " + name);
  expect([flag("--session"), flag("--namespace"), flag("--profile"), flag("--config"), flag("--idle-timeout")]).toEqual(["5e551011", "montroop", path.join(dir, "browser"), path.join(dir, "browser.json"), "30m"]);
  expect(args).toContain("--no-auto-connect");
  expect(args.slice(-2)).toEqual(["open", "http://127.0.0.1:8000/"]);
});

test("a text argument with words like refused flags in it goes through", () => {
  expect(browser("eval", "please connect now -p fast --profile x").out.at(-1)).toBe("arg=please connect now -p fast --profile x");
});
