import "../home.ts";
import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { active, halt, transient } from "../../Service.ts";

// a user's systemd, faked: systemctl and systemd-run that log how they're
// called, and answer as a manager whose units are all active
const BIN = fs.mkdtempSync(path.join(os.tmpdir(), "systemd-"));
const CALLS = path.join(BIN, "calls");
for (const name of ["systemctl", "systemd-run"]) {
  fs.writeFileSync(path.join(BIN, name), "#!/bin/sh\necho \"" + name + " $*\" >> " + CALLS + "\n[ \"$2\" = is-active ] && echo active\nexit 0\n", { mode: 0o755 });
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
