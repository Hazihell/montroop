// The installers run this every time, with the new troop as bun (BUN_BE_BUN=1):
// it brings the data in DIR to this version's layout, and then writes
// DIR/layout, without which a troop finding agents there won't start. A step done is
// skipped. `check DIR` changes nothing: it exits 3 if a step is due, which
// the installers run only with no Montroop server on the data, else 0.
import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
const checking = args[0] === "check";
const dir = checking ? args[1] : args[0];
const LAYOUT = 47;
const say = (s) => console.log("  " + s);
const there = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch (e) { if (e.code === "ENOENT") return null; throw e; } };
const layout = Number((read(path.join(dir, "layout")) ?? "0").trim()) || 0;
const agents = path.join(dir, "agents");
const db_file = path.join(dir, "montroop.db");
const due = layout < LAYOUT && there(agents) && there(db_file);
if (checking) process.exit(due ? 3 : 0);
if (!due) {
  if (!there(path.join(dir, "layout")) && there(agents) && !there(db_file)) say(dir + " has agents but no montroop.db: left as it is.");
  process.exit(0);
}

fs.writeFileSync(path.join(dir, "layout.new"), LAYOUT + "\n");
fs.renameSync(path.join(dir, "layout.new"), path.join(dir, "layout"));
