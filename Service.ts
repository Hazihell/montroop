import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { err_code, err_why } from "./Err.ts";

export type Part = "serve" | "device";

const WIN  = process.platform === "win32";
const MAC  = process.platform === "darwin";
const HOME = os.homedir();

const MARK = "troop-made";

const DATA  = (process.env.TROOP_DIR ?? "~/.montroop").replace(/^~(?=[\\/]|$)/, HOME);
const LOGS  = DATA + "/logs";
const UNITS = (process.env.XDG_CONFIG_HOME || HOME + "/.config") + "/systemd/user";
const PLIST = HOME + "/Library/LaunchAgents";

const CAP   = 2 ** 20;
const LINE  = 16384;

const LINES = 200;

const RESTARTS = WIN ? 3 : 0;
const AFTER    = 60000;
const RAN      = 600000;

const BYE      = 5000;

const UP       = 20000;

let SERVED: Part | null = null;

const DIRS = ["TROOP_DIR", "XDG_CONFIG_HOME"];

const ABOUT: Record<Part, string> = { serve: "Montroop server (troop serve)", device: "Montroop device (troop device)" };

const ASK_ADMIN: Record<Part, string> = {
  device: "troop device will run as administrator: everything it runs, and every app it controls, gets admin rights. Run it as administrator? [y/N]",
  serve: "troop serve will run as administrator: everything it runs gets admin rights. Run it as administrator? [y/N]",
};

const ADMIN_TASK = /<RunLevel>\s*HighestAvailable\s*<\/RunLevel>/;

function name(part: Part): string {
  return "troop-" + part;
}

export function command(): string[] {
  const bun = /^bun(\.native)?(\.exe)?$/i.test(path.basename(process.execPath));
  return bun ? [process.execPath, path.resolve(process.argv[1])] : [process.execPath];
}

export function admin(part: Part): boolean {
  if (!WIN || !elevated()) {
    return false;
  }
  if (!process.stdin.isTTY) {
    console.log("troop " + part + " -d runs elevated, but has no terminal to ask in whether to run it as administrator (sudo's input off?), so it runs without admin rights. `sudo config --enable normal`, then `sudo troop " + part + " -d`, asks.");
    return false;
  }
  return /^y$/i.test(prompt(ASK_ADMIN[part])?.trim() ?? "");
}

function elevated(): boolean {
  return run(["whoami", "/groups", "/fo", "csv", "/nh"]).out.includes("S-1-16-12288");
}

export async function start(part: Part, args: string[], admin = false): Promise<void> {
  const dirs = Object.fromEntries(DIRS.flatMap((k) => {
    const v = process.env[k];
    return v ? [[k, path.resolve(k === "TROOP_DIR" ? DATA : v)]] : [];
  }));
  if (part === "device") {
    alone();
  }
  if (WIN) {
    return win_start(part, [...Object.entries(dirs).map(([k, v]) => "--env=" + k + "=" + v), ...args], admin);
  }
  const env = { ...(process.env.PATH ? { PATH: process.env.PATH } : {}), ...dirs };
  return MAC ? mac_start(part, args, env) : linux_start(part, args, env);
}

export async function stop(part: Part): Promise<void> {
  if (WIN) {
    return win_stop(part);
  }
  return MAC ? mac_stop(part) : linux_stop(part);
}

export async function logs(part: Part, follow: boolean): Promise<void> {
  if (WIN || MAC) {
    return file_logs(part, follow);
  }
  const cmd = ["journalctl", "--user", "-u", name(part) + ".service", "-n", String(LINES), "--no-pager", ...(follow ? ["-f"] : [])];
  if (Bun.which("journalctl") === null) {
    fail("journalctl isn't here: troop " + part + " -d runs it under systemd, whose journal holds its output.");
  }
  process.exitCode = await Bun.spawn(cmd, { stdio: ["inherit", "inherit", "inherit"] }).exited;
}

export function running(part: Part): string | null {
  if (WIN || MAC) {
    const first = pids(part).slice(0, 1);
    const up = ours(part, first).length > 0 || (WIN && alive(first[0]) && win_out_of_sight(part));
    return up ? (WIN ? "the Scheduled Task " : "the LaunchAgent ") + name(part) : null;
  }
  const file = unit(part);
  if (!read(file)?.includes(MARK) || Bun.which("systemctl") === null) {
    return null;
  }
  const state = run(["systemctl", "--user", "is-active", name(part)]).out;
  return ["active", "activating", "reloading"].includes(state) ? "the systemd user service " + name(part) : null;
}

export function served(part: Part): void {
  SERVED = part;
}

export function ready(part: Part): void {
  if (SERVED !== part) {
    return;
  }
  SERVED = null;
  try {
    fs.mkdirSync(LOGS, { recursive: true, mode: 0o700 });
    fs.writeFileSync(LOGS + "/" + part + ".up", process.pid + " " + Date.now() + "\n");
  } catch {}
}

export function foreground(part: Part): void {
  const where = running(part);
  if (where !== null) {
    console.error("troop " + part + " already runs in the background (" + where + "): `troop " + part + " logs -f` follows it, `troop " + part + " stop` stops it.");
    process.exit(1);
  }
  console.log("Running in the foreground. `troop " + part + " -d` runs it as a background service.");
}

export const STOP_SIGNALS = ["SIGHUP", "SIGTERM", "SIGINT"] as const;

export function watch(parent: number, part?: Part, me = parent): void {
  const stop_file = part === undefined || !WIN ? null : LOGS + "/" + part + ".stop";
  const stop_asked = () => stop_file !== null && read(stop_file)?.trim() === String(me);
  let quit = false;
  setInterval(() => {
    if (quit || (alive(parent) && !stop_asked())) {
      return;
    }
    quit = true;
    if (part === undefined || me !== parent || process.listenerCount("SIGTERM") === 0) {
      process.exit(0);
    }
    stop_as_if_signalled();
  }, stop_file === null ? 2000 : 500).unref();
}

function stop_as_if_signalled(): void {
  process.emit("SIGTERM");
}

function unit(part: Part): string {
  return UNITS + "/" + name(part) + ".service";
}

async function linux_start(part: Part, args: string[], env: Record<string, string>): Promise<void> {
  const n = name(part);
  linux_check(part);
  const was = read(LOGS + "/" + part + ".up");
  // systemd's quoting: a value in "", \ and " escaped, a line break as
  // \n, % doubled (and in a command $ too)
  const q = (s: string) => '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/%/g, "%%") + '"';
  const text = [
    "# " + MARK + ": `troop " + part + " -d` wrote this unit, and writes it again; `troop " + part + " stop` removes it.",
    "[Unit]",
    "Description=" + ABOUT[part],
    "StartLimitIntervalSec=300",
    "StartLimitBurst=5",
    "",
    "[Service]",
    "ExecStart=" + [...command(), part, ...args].map((a) => q(a).replace(/\$/g, "$$$$")).join(" "),
    ...Object.entries({ ...env, TROOP_SERVICE: part }).map(([k, v]) => "Environment=" + q(k + "=" + v)),
    "Restart=on-failure",
    "RestartSec=10",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
  fs.mkdirSync(UNITS, { recursive: true });
  fs.writeFileSync(unit(part), text);
  systemctl("daemon-reload");
  systemctl("enable", "--quiet", n);
  run(["systemctl", "--user", "reset-failed", n]);
  systemctl("restart", "--no-block", n);
  const state = () => run(["systemctl", "--user", "is-active", n]).out;
  say(part, await up(part, was, () => state() === "failed", () => state() === "active"), "the systemd user service " + n + ", started at login");
  const user = os.userInfo().username;
  if (Bun.which("loginctl") !== null && run(["loginctl", "show-user", user, "--property=Linger", "--value"]).out === "no") {
    console.log("Lingering is off, so it runs only while you're logged in: `loginctl enable-linger` starts it at boot and keeps it up after you log out.");
  }
}

function linux_stop(part: Part): void {
  const n = name(part);
  linux_check(part);
  if (!fs.existsSync(unit(part))) {
    console.log("troop " + part + " isn't set up as a background service here: nothing to stop.");
    return;
  }
  systemctl("disable", "--quiet", n);
  fs.rmSync(unit(part));
  systemctl("daemon-reload");
  systemctl("stop", n);
  console.log("troop " + part + " stopped: its background service " + n + " is removed.");
}

function linux_check(part: Part): void {
  const n = name(part);
  if (Bun.which("systemctl") === null || run(["systemctl", "--user", "show", "--property=Version", "--value"]).code !== 0) {
    fail("troop " + part + " -d runs it under systemd's user manager (systemctl --user), which isn't reachable here. Run `troop " + part + "` in the foreground, or under a service manager of your own.");
  }
  const file = unit(part);
  const mine = read(file);
  const from = run(["systemctl", "--user", "show", "--property=FragmentPath", "--value", n + ".service"]).out;
  const theirs = mine !== null && !mine.includes(MARK) ? file : from !== "" && !same(from, file) ? from : null;
  if (theirs !== null) {
    fail(n + " isn't Montroop's: " + theirs + " is a unit troop didn't make, so troop leaves it as it is. To use troop " + part + " -d, remove it (systemctl --user disable --now " + n + ", then the file); or keep using it.");
  }
}

function systemctl(...args: string[]): void {
  const out = run(["systemctl", "--user", ...args]);
  if (out.code !== 0) {
    fail("systemctl --user " + args.join(" ") + " failed: " + (out.err || "exit " + out.code));
  }
}

function plist(part: Part): string {
  return PLIST + "/" + name(part) + ".plist";
}

async function mac_start(part: Part, args: string[], env: Record<string, string>): Promise<void> {
  const n = name(part);
  const job = "gui/" + uid() + "/" + n;
  const file = plist(part);
  const was = read(file);
  const loaded = run(["launchctl", "print", job]).code === 0;
  if ((was !== null && !was.includes(MARK)) || (was === null && loaded)) {
    fail(n + " isn't Montroop's: " + (was === null ? "a launchd job by that name" : file) + " isn't one troop made, so troop leaves it as it is. To use troop " + part + " -d, remove it (launchctl bootout " + job + ", then its plist); or keep using it.");
  }
  const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const strings = (list: string[]) => list.map((a) => "<string>" + x(a) + "</string>").join("");
  const text = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- ${MARK}: \`troop ${part} -d\` wrote this, and writes it again; \`troop ${part} stop\` removes it. -->
<plist version="1.0">
<dict>
  <key>Label</key><string>${n}</string>
  <key>ProgramArguments</key><array>${strings([...command(), part, "--service", ...args])}</array>
  <key>EnvironmentVariables</key><dict>${Object.entries(env).map(([k, v]) => "<key>" + x(k) + "</key><string>" + x(v) + "</string>").join("")}</dict>
  <key>WorkingDirectory</key><string>${x(HOME)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
</dict>
</plist>
`;
  const step = clock(part, "-d");
  fs.mkdirSync(PLIST, { recursive: true });
  fs.writeFileSync(file, text);
  const pid = read(LOGS + "/" + part + ".pid");
  const ready = read(LOGS + "/" + part + ".up");
  step("LaunchAgent written");
  run(["launchctl", "enable", job]);
  if (loaded && was === text) {
    run(["launchctl", "kickstart", "-k", job]);
  } else {
    const again = (loaded ? "launchctl bootout '" + job + "' 2>/dev/null; " : "") + "launchctl bootstrap gui/" + uid() + " '" + file.replace(/'/g, "'\\''") + "'";
    await Bun.spawn(["/bin/sh", "-c", again], { detached: true, stdio: ["ignore", "inherit", "inherit"] }).exited;
  }
  step("LaunchAgent started");
  const now = await up(part, ready, () => supervised(part, pid) === false, () => supervised(part, pid) === true);
  step(now === "up" ? "up" : "not up");
  say(part, now, "the LaunchAgent " + n + ", started at login");
}

function mac_stop(part: Part): void {
  const n = name(part);
  const file = plist(part);
  const was = read(file);
  if (was === null) {
    console.log("troop " + part + " isn't set up as a background service here: nothing to stop.");
    return;
  }
  if (!was.includes(MARK)) {
    fail(n + " isn't Montroop's: " + file + " isn't one troop made, so troop leaves it as it is.");
  }
  const step = clock(part, "stop");
  fs.rmSync(file);
  fs.rmSync(LOGS + "/" + part + ".up", { force: true });
  run(["launchctl", "bootout", "gui/" + uid() + "/" + n]);
  step("LaunchAgent removed");
  console.log("troop " + part + " stopped: its background service " + n + " is removed.");
}

async function win_start(part: Part, args: string[], admin: boolean): Promise<void> {
  const n = name(part);
  const step = clock(part, "-d");
  const pid = read(LOGS + "/" + part + ".pid");
  const was = read(LOGS + "/" + part + ".up");
  const had = win_task(n);
  step("task looked up");
  if (had !== null && !had.includes(MARK)) {
    fail(n + " isn't Montroop's: that Scheduled Task isn't one troop made, so troop leaves it as it is. To use troop " + part + " -d, remove it (schtasks /delete /tn " + n + "); or keep using it.");
  }
  win_admin_check(part, had, "-d");
  const line = ["--headless", ...command(), part, "--service", ...args].map(winq).join(" ");
  const about = MARK + ": `troop " + part + " -d` made this task, and makes it again; `troop " + part + " stop` removes it.";
  const file = path.join(os.tmpdir(), n + "-" + process.pid + ".xml");
  // UTF-16, as schtasks reads a task's XML
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(TASK(about, user(), line, HOME, admin), "utf16le")]));
  try {
    schtasks("/create", "/tn", "\\" + n, "/xml", file, "/f");
  } finally {
    fs.rmSync(file, { force: true });
  }
  step("task registered");
  schtasks("/run", "/tn", "\\" + n);
  step("task started");
  const now = await up(part, was, () => supervised(part, pid) === false, () => supervised(part, pid) === true);
  step(now === "up" ? "up" : "not up");
  say(part, now, "the Scheduled Task " + n + ", started at logon" + (admin ? ", as administrator" : ""));
}

function win_out_of_sight(part: Part): boolean {
  return ADMIN_TASK.test(win_task(name(part)) ?? "") && !elevated();
}

function win_admin_check(part: Part, had: string | null, verb: string): void {
  if (had !== null && ADMIN_TASK.test(had) && !elevated()) {
    fail("troop " + part + " runs as administrator (its task was made by `sudo troop " + part + " -d`), so only an elevated shell can change it: run `sudo troop " + part + " " + verb + "`" + (verb === "-d" ? " (answer N to run it without admin rights)" : "") + ".");
  }
}

function win_task_troop_made(part: Part, n: string, had: string | null): boolean {
  if (had === null) {
    console.log("troop " + part + " isn't set up as a background service here: nothing to stop.");
    return false;
  }
  if (!had.includes(MARK)) {
    fail(n + " isn't Montroop's: that Scheduled Task isn't one troop made, so troop leaves it as it is.");
  }
  return true;
}

function forget_run(part: Part): void {
  fs.rmSync(LOGS + "/" + part + ".pid", { force: true });
  fs.rmSync(LOGS + "/" + part + ".up", { force: true });
}

function win_end_task(n: string): void {
  // ended whatever its state (schtasks shows that in the system's
  // language); on an idle task /end only fails, which is fine
  run(["schtasks", "/end", "/tn", "\\" + n]);
}

async function win_stop(part: Part): Promise<void> {
  const n = name(part);
  const step = clock(part, "stop");
  const all = pids(part);
  const mine = ours(part, all);
  step("processes looked up");
  const had = win_task(n);
  step("task looked up");
  if (!win_task_troop_made(part, n, had)) {
    return;
  }
  win_admin_check(part, had, "stop");
  forget_run(part);
  if (mine.length === 0) {
    win_end_task(n);
    step("task ended");
  }
  schtasks("/delete", "/tn", "\\" + n, "/f");
  step("task removed");
  await win_quit(part, all[0], mine);
  step("its troop ended");
  console.log("troop " + part + " stopped: its background service " + n + " is removed.");
}

function TASK(about: string, who: string, line: string, dir: string, admin: boolean): string {
  const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>${x(about)}</Description></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${x(who)}</UserId></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>${x(who)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>${admin ? "HighestAvailable" : "LeastPrivilege"}</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>StopExisting</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT1M</Interval><Count>${RESTARTS}</Count></RestartOnFailure>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author"><Exec><Command>conhost.exe</Command><Arguments>${x(line)}</Arguments><WorkingDirectory>${x(dir)}</WorkingDirectory></Exec></Actions>
</Task>
`;
}

function user(): string {
  const name = process.env.USERNAME ?? os.userInfo().username;
  return process.env.USERDOMAIN ? process.env.USERDOMAIN + "\\" + name : name;
}

function win_task(n: string): string | null {
  const out = run(["schtasks", "/query", "/tn", "\\" + n, "/xml"]);
  return out.code === 0 ? out.out : null;
}

function schtasks(...args: string[]): void {
  const out = run(["schtasks", ...args]);
  if (out.code !== 0) {
    fail("schtasks " + args[0] + " failed: " + (out.err || out.out || "exit " + out.code));
  }
}

async function win_quit(part: Part, supervisor: number | undefined, mine: number[]): Promise<void> {
  const stop = LOGS + "/" + part + ".stop";
  if (supervisor !== undefined && mine.length > 0) {
    fs.writeFileSync(stop, String(supervisor));
    for (const until = Date.now() + BYE; mine.some(alive) && Date.now() < until; ) {
      await Bun.sleep(100);
    }
  }
  for (const pid of mine.filter(alive)) {
    run(["taskkill", "/T", "/F", "/PID", String(pid)]);
  }
  fs.rmSync(stop, { force: true });
}

export async function supervise(part: Part, args: string[]): Promise<never> {
  if (WIN) {
    // the task's conhost, which Windows ends alone
    watch(process.ppid, part, process.pid);
  }
  fs.mkdirSync(LOGS, { recursive: true, mode: 0o700 });
  fs.rmSync(LOGS + "/" + part + ".stop", { force: true });
  const file = LOGS + "/" + part + ".pid";
  await end_earlier_supervisors(part);
  const log = logger(LOGS + "/" + part + ".log");
  const run: Supervised = { child: null, stopping: false };
  for (const sig of STOP_SIGNALS) {
    process.on(sig, () => {
      run.stopping = true;
      run.child?.kill();
    });
  }
  const code = await run_restarting(part, args, file, log, run);
  if (read(file)?.startsWith(process.pid + " ")) {
    fs.rmSync(file, { force: true });
  }
  process.exit(run.stopping ? 0 : code);
}

type Supervised = { child: ReturnType<typeof Bun.spawn> | null; stopping: boolean };

async function end_earlier_supervisors(part: Part): Promise<void> {
  const before = pids(part);
  const old = ours(part, before.filter((pid) => pid !== process.pid));
  if (WIN) {
    await win_quit(part, before[0], old);
  }
  for (const pid of WIN ? [] : old) {
    for (let k = 0; k < 40 && alive(pid); k++) {
      await Bun.sleep(250);
    }
    try {
      process.kill(pid);
    } catch {}
  }
}

async function run_restarting(part: Part, args: string[], file: string, log: (line: string) => void, run: Supervised): Promise<number> {
  let [tries, code] = [0, 0];
  while (true) {
    const began = Date.now();
    const env = { ...process.env, TROOP_SERVICE: part, TROOP_SUPERVISOR: String(process.pid) };
    const child = (run.child = Bun.spawn([...command(), part, ...args], { env, stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true }));
    fs.writeFileSync(file, process.pid + " " + child.pid + "\n");
    await Promise.all([lines(child.stdout, log), lines(child.stderr, log), child.exited]);
    code = child.exitCode ?? 1;
    log("troop " + part + " ended (exit " + code + ")");
    tries = Date.now() - began > RAN ? 1 : tries + 1;
    if (code === 0 || run.stopping || tries > RESTARTS) {
      return code;
    }
    log("starting it again in a minute (" + tries + " of " + RESTARTS + ")");
    await Bun.sleep(AFTER);
  }
}

function logger(file: string): (text: string) => void {
  let size = fs.existsSync(file) ? fs.statSync(file).size : 0;
  return (text) => {
    const stamp = new Date().toISOString() + " ";
    const cut = (line: string) => (line.length > LINE ? line.slice(0, LINE) + " [cut: " + (line.length - LINE) + " more characters]" : line);
    const out = text.split("\n").map((line) => stamp + cut(line) + "\n").join("");
    if (size > 0 && size + Buffer.byteLength(out) > CAP) {
      try {
        fs.renameSync(file, file + ".1");
      } catch {
        fs.writeFileSync(file, "");
      }
      size = 0;
    }
    fs.appendFileSync(file, out);
    size += Buffer.byteLength(out);
  };
}

async function lines(stream: ReadableStream<Uint8Array>, put: (line: string) => void): Promise<void> {
  const dec = new TextDecoder();
  let rest = "";
  const reader = stream.getReader();
  for (let got = await reader.read(); !got.done; got = await reader.read()) {
    const all = (rest + dec.decode(got.value, { stream: true })).split(/\r?\n/);
    rest = all.pop() ?? "";
    all.forEach(put);
    if (rest.length > LINE) {
      put(rest);
      rest = "";
    }
  }
  if (rest !== "") {
    put(rest);
  }
}

async function file_logs(part: Part, follow: boolean): Promise<void> {
  const file = LOGS + "/" + part + ".log";
  if (!fs.existsSync(file)) {
    fail("no log at " + file + " yet: it's written by troop " + part + " -d's background service.");
  }
  let at = fs.statSync(file).size;
  const text = fs.readFileSync(file, "utf8");
  process.stdout.write(text.split("\n").slice(-LINES - 1).join("\n"));
  while (follow) {
    await Bun.sleep(500);
    const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
    at = size < at ? 0 : at;
    if (size > at) {
      const fd = fs.openSync(file, "r");
      const buf = Buffer.alloc(size - at);
      fs.readSync(fd, buf, 0, buf.length, at);
      fs.closeSync(fd);
      process.stdout.write(buf);
      at = size;
    }
  }
}

async function up(part: Part, was: string | null, failed: () => boolean, runs: () => boolean): Promise<"up" | "late" | "down"> {
  for (const until = Date.now() + UP; Date.now() < until; ) {
    const now = read(LOGS + "/" + part + ".up");
    if (now !== null && now !== was && alive(Number(now.split(" ")[0]))) {
      return "up";
    }
    if (failed()) {
      return "down";
    }
    await Bun.sleep(100);
  }
  return runs() ? "late" : "down";
}

function supervised(part: Part, was: string | null): boolean | null {
  const now = read(LOGS + "/" + part + ".pid");
  return now === null || now === was ? null : pids(part).every(alive);
}

function say(part: Part, up: "up" | "late" | "down", where: string): void {
  const logs = "`troop " + part + " logs` shows why.";
  if (up === "up") {
    console.log("troop " + part + " runs in the background, as " + where + ": `troop " + part + " logs -f` follows it, `troop " + part + " stop` removes it.");
  } else if (up === "late") {
    console.log("troop " + part + " runs as " + where + ", but " + (part === "device" ? "hasn't linked to its server" : "isn't listening yet") + " after " + UP / 1000 + " s: " + logs);
  } else {
    console.log("troop " + part + " is set up as " + where + ", but isn't running: " + logs);
  }
}

function clock(part: Part, verb: string): (what: string) => void {
  let last = performance.now();
  return (what) => {
    const now = performance.now();
    if (WIN || MAC) {
      try {
        fs.mkdirSync(LOGS, { recursive: true, mode: 0o700 });
        fs.appendFileSync(LOGS + "/" + part + ".log", new Date().toISOString() + " troop " + part + " " + verb + ": " + what + " in " + ((now - last) / 1000).toFixed(2) + " s\n");
      } catch {}
    }
    last = now;
  };
}

function pids(part: Part): number[] {
  return (read(LOGS + "/" + part + ".pid") ?? "").trim().split(/\s+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
}

export function ours(part: Part, list: number[]): number[] {
  const live = list.filter(alive);
  if (live.length === 0) {
    return [];
  }
  const got = procs(live.map((pid) => "ProcessId=" + pid).join(" OR "));
  return live.filter((pid) => got.some(([p, line]) => p === pid && runs(line, part)));
}

function alone(): void {
  const service = WIN || MAC ? pids("device") : [];
  const theirs = (pid: number) => (WIN || MAC ? service.includes(pid) : (read("/proc/" + pid + "/cgroup") ?? "").includes("/" + name("device") + ".service"));
  const found = procs("CommandLine LIKE '%device%'").filter(([pid, line]) => pid !== process.pid && runs(line, "device", '(\\s+"?https?://[^\\s"]*"?)?\\s*$') && !theirs(pid));
  if (found.length > 0) {
    console.error("troop: warning: a troop device runs here in the foreground already (pid " + found.map(([pid]) => pid).join(", ") + "). With the same sign-in (device.json) the two take turns as one device: stop it.");
  }
}

function runs(line: string, part: Part, then = "(\\s|$)"): boolean {
  const cmd = command();
  const exe = path.basename(cmd[cmd.length - 1]).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp('(^|[\\\\/\\s"])' + exe + '"?\\s+"?' + part + '"?' + then, "i").test(line);
}

function procs(wql: string): Array<[number, string]> {
  const out = WIN
    ? run([pwsh(), "-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process -Filter $env:TROOP_WQL | ForEach-Object { [string]$_.ProcessId + ' ' + $_.CommandLine }"], { TROOP_WQL: wql }).out
    : run(["ps", "-A", "-ww", "-o", "pid=,args="]).out;
  return out.split(/\r?\n/).flatMap((line): Array<[number, string]> => {
    const m = line.trim().match(/^(\d+)\s*(.*)$/);
    return m === null ? [] : [[Number(m[1]), m[2]]];
  });
}

function pwsh(): string {
  return Bun.which("pwsh") ?? "powershell.exe";
}

// an argument as Windows reads it back from a command line
// (CommandLineToArgvW): quoted if need be, a backslash run before a quote
// or the end doubled
function winq(a: string): string {
  if (a !== "" && !/[\s"]/.test(a)) {
    return a;
  }
  return '"' + a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1") + '"';
}

function alive(pid: number | undefined): boolean {
  if (pid === undefined) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err_code(err) === "EPERM";
  }
}

function same(a: string, b: string): boolean {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return a === b;
  }
}

function uid(): number {
  const id = process.getuid?.();
  if (id === undefined) {
    throw new Error("no user id here");
  }
  return id;
}

function read(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

// A transient unit: a process the server starts that outlives it, as a
// systemd user unit where the user's systemd answers, else (Linux without
// it, as in a container) as a detached process kept track of by a file of
// its pid in dir, its output in a log beside it. Which one a unit is, is
// told by that file, so units started either way are both found again.
type Unit = { name: string; dir: string };

// a detached unit's own variable: its name, which it and all it starts
// carry, as a systemd unit's processes are in its cgroup. Its name is the
// one holders already running were started with, so they're found again
const UNIT_MARK = "TROOP_HOLD";

// the variables a systemd unit has from the user's manager, which a
// detached one takes from its starter
const UNIT_OWN = ["HOME", "USER", "LOGNAME", "TMPDIR", "XDG_RUNTIME_DIR"];

// how long a unit told to stop has before it's killed
const UNIT_STOP = 10e3;

let SYSTEMD: boolean | null = null;

function systemd(): boolean {
  SYSTEMD ??= Bun.which("systemd-run") !== null && run(["systemctl", "--user", "show-environment"]).code === 0;
  return SYSTEMD;
}

function pid_file(u: Unit): string {
  return path.join(u.dir, u.name + ".pid");
}

// whether units can start here
export function transients(): boolean {
  return process.platform === "linux" || systemd();
}

// each kind of unit: start it (null: started; else why not), whether it
// runs, and stop it with everything it started, asked first and killed
// after UNIT_STOP (or, its starter gone before that, once it's found gone)
type Kind = {
  start  : (u: Unit, about: string, cmd: string[], env: Record<string, string>) => string | null;
  active : (u: Unit) => boolean;
  halt   : (u: Unit) => void;
};

const SYSTEMD_UNIT: Kind = {
  start: (u, about, cmd, env) => {
    const r = run(["systemd-run", "--user", "--collect", "--quiet", "--unit=" + u.name, "--description=" + about, "-p", "TimeoutStopSec=" + UNIT_STOP / 1000, ...Object.entries(env).map(([k, v]) => "--setenv=" + k + "=" + v), "--", ...cmd]);
    return r.code === 0 ? null : "systemd-run failed: " + output(r);
  },
  active : (u) => systemd() && ["active", "activating", "deactivating"].includes(output(run(["systemctl", "--user", "is-active", u.name]))),
  halt   : (u) => {
    if (systemd()) {
      run(["systemctl", "--user", "stop", "--no-block", u.name]);
    }
  },
};

// one found gone takes what it left running with it, as a systemd unit's
// end does
const DETACHED: Kind = {
  start: (u, _about, cmd, env) => {
    const log = fs.openSync(path.join(u.dir, u.name + ".log"), "a");
    let p: Bun.Subprocess | null = null;
    try {
      const own = Object.fromEntries(UNIT_OWN.flatMap((k) => (process.env[k] ? [[k, process.env[k]]] : [])));
      p = Bun.spawn(cmd, { env: { ...own, ...env, [UNIT_MARK]: u.name }, stdio: ["ignore", log, log], detached: true });
      p.unref();
      fs.writeFileSync(pid_file(u), String(p.pid));
      return null;
    } catch (err) {
      p?.kill("SIGKILL");
      return "its process didn't start: " + err_why(err);
    } finally {
      fs.closeSync(log);
    }
  },
  active: (u) => {
    if (marked(Number(read(pid_file(u))) || 0, u.name)) {
      return true;
    }
    sweep(u.name, "SIGKILL");
    fs.rmSync(pid_file(u), { force: true });
    return false;
  },
  halt: (u) => {
    sweep(u.name, "SIGTERM");
    setTimeout(() => sweep(u.name, "SIGKILL"), UNIT_STOP).unref();
  },
};

// a unit that kept no pid file ran under systemd
function kind(u: Unit): Kind {
  return fs.existsSync(pid_file(u)) ? DETACHED : SYSTEMD_UNIT;
}

export function transient(u: Unit, about: string, cmd: string[], env: Record<string, string>): string | null {
  return (systemd() ? SYSTEMD_UNIT : DETACHED).start(u, about, cmd, env);
}

export function active(u: Unit): boolean {
  return kind(u).active(u);
}

export function halt(u: Unit): void {
  kind(u).halt(u);
}

// for a unit's main process at its end: what it leaves running ends with
// it (systemd does that itself)
export function reap(): void {
  const name = process.env[UNIT_MARK];
  if (name !== undefined) {
    sweep(name, "SIGKILL");
  }
}

// a process that runs, not a zombie, of the detached unit name (so not one
// that took the id of one since)
function marked(pid: number, name: string): boolean {
  try {
    const stat = fs.readFileSync("/proc/" + pid + "/stat", "utf8");
    return !stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z") && fs.readFileSync("/proc/" + pid + "/environ", "utf8").split("\0").includes(UNIT_MARK + "=" + name);
  } catch {
    return false;
  }
}

// every process of the unit's but this one, signalled
function sweep(name: string, signal: "SIGTERM" | "SIGKILL"): void {
  for (const pid of fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d)).map(Number)) {
    if (pid !== process.pid && marked(pid, name)) {
      try {
        process.kill(pid, signal);
      } catch {}
    }
  }
}

export function run(cmd: string[], env: Record<string, string> = {}): { code: number; out: string; err: string } {
  const p = Bun.spawnSync(cmd, { env: { ...process.env, ...env }, stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true });
  return { code: p.exitCode ?? 1, out: p.stdout.toString().trim(), err: p.stderr.toString().trim() };
}

// what a run printed, both streams
export function output(r: { out: string; err: string }): string {
  return (r.out + "\n" + r.err).trim();
}

function fail(why: string): never {
  console.error("troop: " + why);
  process.exit(1);
}
