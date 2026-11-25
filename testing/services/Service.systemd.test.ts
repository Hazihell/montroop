import "../home.ts";
import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { active, halt, transient, usages } from "../../Service.ts";
import { until } from "../rig.ts";

// a user's systemd, faked: systemctl and systemd-run that log how they're
// called, and answer as a manager whose units are all active, each with a
// cgroup folder in CGROUP (told from /sys/fs/cgroup, where cgroups are)
const BIN = fs.mkdtempSync(path.join(os.tmpdir(), "systemd-"));
const CALLS = path.join(BIN, "calls");
const CGROUP = path.join(BIN, "cg");
const TOLD = "/../../.." + CGROUP;
for (const name of ["systemctl", "systemd-run"]) {
  fs.writeFileSync(path.join(BIN, name), "#!/bin/sh\necho \"" + name + " $*\" >> " + CALLS + "\n[ \"$2\" = is-active ] && echo active\n[ \"$2\" = show ] && echo \"" + TOLD + "/$6\"\nexit 0\n", { mode: 0o755 });
}
process.env.PATH = BIN + ":" + process.env.PATH;

function calls(): string[] {
  const all = fs.readFileSync(CALLS, "utf8").trim().split("\n");
  fs.writeFileSync(CALLS, "");
  return all;
}

test("where the user's systemd answers, a unit runs as a transient systemd user unit, found and stopped through it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unit-"));
  const unit = { name: "troop-hold-ab12cd34-1", dir };

  expect(transient(unit, "Montroop work session fix", ["/usr/bin/troop", "hold", dir], { TROOP_DIR: "/data", LANG: "C.UTF-8" })).toBeNull();
  expect(calls()).toContain(
    "systemd-run --user --collect --quiet --unit=troop-hold-ab12cd34-1 --description=Montroop work session fix -p TimeoutStopSec=10 --setenv=TROOP_DIR=/data --setenv=LANG=C.UTF-8 -- /usr/bin/troop hold " + dir,
  );
  expect(active(unit)).toBe(true);
  halt(unit);
  expect(calls()).toEqual(["systemctl --user is-active troop-hold-ab12cd34-1", "systemctl --user stop --no-block troop-hold-ab12cd34-1"]);
});

// a unit's cgroup folder with these files
function cgroup(name: string, files: Record<string, string>): string {
  const dir = path.join(CGROUP, name);
  fs.mkdirSync(dir, { recursive: true });
  Object.entries(files).forEach(([file, text]) => fs.writeFileSync(path.join(dir, file), text));
  return dir;
}

test("a systemd unit uses what its cgroup counts: all the CPU time its processes spent, and their memory but the page cache", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unit-"));
  cgroup("troop-hold-ef56ab78-2", {
    "cpu.stat": "usage_usec 2903572\nuser_usec 1885277\nsystem_usec 1018295\nnice_usec 0\n",
    "memory.stat": "anon 189616128\nfile 520192\nkernel 3887104\nkernel_stack 245760\nsock 0\nshmem 4096\nfile_mapped 0\n",
  });

  expect(usages([{ name: "troop-hold-ef56ab78-2", dir }]).get("troop-hold-ef56ab78-2")).toEqual({ memory: 189620224, cpu: new Map([["", 2903572]]) });
  expect(calls()).toContain("systemctl --user show -p ControlGroup --value troop-hold-ef56ab78-2");
});

test("a systemd unit whose cgroup keeps no memory count uses the memory of the processes in it and in those under it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unit-"));
  const up = path.join(dir, "up");
  const p = Bun.spawn([process.execPath, "-e", "const held = Buffer.alloc(100 * 2 ** 20, 1); require(\"node:fs\").writeFileSync(" + JSON.stringify(up) + ", \"\"); setInterval(() => held[0]++, 1e3);"]);
  try {
    const top = cgroup("troop-hold-0a1b2c3d-1", { "cpu.stat": "usage_usec 10\n", "cgroup.procs": "" });
    fs.mkdirSync(path.join(top, "under"));
    fs.writeFileSync(path.join(top, "under", "cgroup.procs"), p.pid + "\n");
    await until("it holds its memory", () => fs.existsSync(up));

    expect(usages([{ name: "troop-hold-0a1b2c3d-1", dir }]).get("troop-hold-0a1b2c3d-1")?.memory).toBeGreaterThanOrEqual(100 * 2 ** 20);
  } finally {
    p.kill();
  }
});
