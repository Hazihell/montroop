// Browser
// =======
// A work session's own headless browser: `browser` in its folder's bin,
// agent-browser under a session of its own, on a blank profile in the
// session's folder, saving what a relative path names (screenshots,
// recordings) in its media folder. The commands and flags that would
// connect it to another browser, run others it can't check (a batch), or
// pick another profile, are refused, and agent-browser's own settings and
// variables are left out.

import * as fs from "node:fs";
import * as path from "node:path";
import * as config from "./Config.ts";

export const BIN = "bin";
export const MEDIA = "media";

const PROFILE = "browser";
const SETTINGS = "browser.json";
const NAMESPACE = "kunumy";
const IDLE = "30m";
const CLOSE_MS = 10e3;

// commands that would run others it can't check, or connect to a browser
const COMMANDS = ["connect", "batch", "mcp"];

const KEPT = ["HOME", "PATH", "LANG", "TMPDIR", "XDG_RUNTIME_DIR"];

const REFUSED = ["--cdp", "--auto-connect", "--profile", "--session", "--session-name", "--namespace", "--config", "--provider", "-p", "--executable-path", "--headed", "--state", "--restore", "--extension", "--args"];

const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";

export namespace Browser {

  function bin(): string | null {
    return config.AGENT_BROWSER || Bun.which("agent-browser");
  }

  export function script(dir: string): string {
    return path.join(dir, BIN, "browser");
  }

  // the session's browser command made; false: agent-browser isn't here
  export function make(dir: string, id: string): boolean {
    const exe = bin();
    if (exe === null || !fs.existsSync(exe)) {
      return false;
    }
    const media = path.join(dir, MEDIA);
    fs.mkdirSync(path.join(dir, BIN), { recursive: true });
    fs.mkdirSync(media, { recursive: true });
    fs.writeFileSync(path.join(dir, SETTINGS), "{}\n");
    const env = KEPT.flatMap((k) => (process.env[k] ? [k + "=" + quote(process.env[k])] : []));
    const flags = ["--session", id, "--namespace", NAMESPACE, "--profile", path.join(dir, PROFILE), "--config", path.join(dir, SETTINGS), "--no-auto-connect", "--idle-timeout", IDLE];
    const text = [
      "#!/bin/sh",
      "for a in \"$@\"; do",
      "  case \"$a\" in",
      "    " + [...COMMANDS, ...REFUSED.flatMap((f) => [f, f + "=*"])].join("|") + ") echo \"browser: '$a' isn't taken here: this is your own browser, it connects to no other and takes one command at a time\" >&2; exit 2;;",
      "  esac",
      "done",
      "cd " + quote(media) + " || exit 1",
      "exec env -i " + env.join(" ") + " " + quote(exe) + " " + flags.map(quote).join(" ") + " \"$@\"",
      "",
    ].join("\n");
    fs.writeFileSync(Browser.script(dir), text, { mode: 0o700 });
    return true;
  }

  // its browser closed, if it has one open
  export async function close(dir: string): Promise<void> {
    if (fs.existsSync(Browser.script(dir))) {
      await Bun.spawn([Browser.script(dir), "close"], { stdin: "ignore", stdout: "ignore", stderr: "ignore", timeout: CLOSE_MS }).exited;
    }
  }

  // closed, and its profile removed
  export async function forget(dir: string): Promise<void> {
    await Browser.close(dir);
    fs.rmSync(path.join(dir, PROFILE), { recursive: true, force: true });
  }

}
