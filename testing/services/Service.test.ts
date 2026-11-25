import "../home.ts";
import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { active, halt, transient } from "../../Service.ts";
import { procs, tag, until } from "../rig.ts";

// the suite has no systemd: units run detached

function folder(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "unit-"));
}

// a script in dir that runs for long, named so its process can be found
function long(dir: string, name: string): string {
  const file = path.join(dir, name + ".sh");
  fs.writeFileSync(file, "sleep 300\n");
  return file;
}

// a script in dir running these lines
function script(dir: string, ...lines: string[]): string[] {
  const file = path.join(dir, "main.sh");
  fs.writeFileSync(file, lines.join("\n") + "\n");
  return ["sh", file];
}

// whether a process whose command line has text runs
function runs(text: string): boolean {
  return procs().some((p) => p.cmd.includes(text));
}

test("a detached unit runs with the variables it's given and its starter's home, none of the rest", async () => {
  const dir = folder();
  process.env.KNY_UNIT_TEST_SECRET = "leaked";
  const why = transient({ name: "u-" + tag(), dir }, "a test unit", ["sh", "-c", "echo \"$GIVEN|$HOME|$KNY_UNIT_TEST_SECRET\" > " + path.join(dir, "env")], { GIVEN: "yes" });

  expect(why).toBeNull();
  expect(await until("its output", () => fs.existsSync(path.join(dir, "env")) && fs.readFileSync(path.join(dir, "env"), "utf8"))).toBe("yes|" + os.homedir() + "|\n");
});

test("a detached unit is active till it's halted, and halting it ends what it started too", async () => {
  const dir = folder();
  const t = tag();
  const unit = { name: "u-" + t, dir };
  expect(transient(unit, "a test unit", script(dir, "sh " + long(dir, "a-" + t) + " &", "sh " + long(dir, "b-" + t)), {})).toBeNull();
  await until("both its processes", () => runs("a-" + t) && runs("b-" + t));
  expect(active(unit)).toBe(true);

  halt(unit);
  await until("it ended", () => !active(unit));
  await until("what it started ended", () => !runs("a-" + t) && !runs("b-" + t));
});

test("a detached unit whose main process ended is inactive, and what it left running is ended once it's found so", async () => {
  const dir = folder();
  const t = tag();
  const unit = { name: "u-" + t, dir };
  expect(transient(unit, "a test unit", script(dir, "sh " + long(dir, "c-" + t) + " &", "touch " + path.join(dir, "up")), {})).toBeNull();
  await until("what it left running", () => runs("c-" + t) && fs.existsSync(path.join(dir, "up")));

  await until("it inactive", () => !active(unit));
  await until("what it left ended", () => !runs("c-" + t));
});

test("a unit that can't start says why", () => {
  expect(transient({ name: "u-" + tag(), dir: folder() }, "a test unit", ["/nonexistent/program"], {})).toStartWith("its process didn't start: ");
});
