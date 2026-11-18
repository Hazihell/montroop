// The installers run this every time, with the new ki as bun (BUN_BE_BUN=1),
// after unii's data was moved and given ki's names (rename.js): it brings
// the data in DIR to this version's layout, and then writes DIR/layout,
// without which a ki finding agents there won't start. A step done is
// skipped. `check DIR` changes nothing: it exits 3 if a step is due, which
// the installers run only with no ki server on the data, else 0.
//
// 41: each agent keeps its own pictures and files (#169), and its uploaded
// picture becomes /media/<id>/<name>; links in memory stay as they are (ki
// finds an old /media/<name> in any agent's store). The MCP servers switched
// off in 40 (the lead's view.json "off") go to config.json's mcp_off, unless
// that has one already. 40's description of its main agent becomes the first
// agent's new one, if it was never edited.
//
// 42: each picture and file is in the store of every agent whose memory names
// it, and in no other (#174): before, all were in one agent's store (the
// lead's in 40, unii's in 40.rc), and 41 only linked the ones each agent
// names into its own. A file named by one agent is moved to it; one named by
// several is in each of theirs (hard links, else copies); one named by no
// agent stays where it is. (A link to another agent's file, /media/<id>/<name>,
// finds it in the store of the agent whose memory has the link.)
//
// 47: gpt-6.2-astra and gpt-6.2-sol replace gpt-6-astra and gpt-6.1-sol
// (#200): config.json's models, pick, compactor and profiles, each agent's
// pick, and each subagent's pick and the model its spawn named (its log's
// first line, which a subagent going on after a restart runs on) name the
// new ones.
import fs from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
const args = process.argv.slice(2);
const checking = args[0] === "check";
const dir = checking ? args[1] : args[0];
const LAYOUT = 47;
const OLD_ABOUT = "Executive assistant: automatically keeps track of the whole team.";
const NEW_ABOUT = "The user's assistant and first point of contact.";
const say = (s) => console.log("  " + s);
const there = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch (e) { if (e.code === "ENOENT") return null; throw e; } };
const layout = Number((read(path.join(dir, "layout")) ?? "0").trim()) || 0;
const agents = path.join(dir, "agents");
const db_file = path.join(dir, "ki.db");
const due = layout < LAYOUT && there(agents) && there(db_file);
if (checking) process.exit(due ? 3 : 0);
if (!due) {
  if (!there(path.join(dir, "layout")) && there(agents) && !there(db_file)) say(dir + " has agents but no ki.db: left as it is.");
  process.exit(0);
}

const db = new Database(db_file);
db.run("PRAGMA busy_timeout = 10000");
const has = db.query("select 1 from sqlite_master where type = 'table' and name = 'agents'").get() !== null;
const all = () => has ? db.query("select * from agents order by made, id").all() : [];
let rows = all();
// the folder that held them all: 40's lead, 40.rc's unii, else the oldest
const lead = rows.find((r) => r.lead === 1) ?? rows.find((r) => r.id === "unii") ?? rows[0];

const files = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(d, e.name)); } catch { return []; } };
const keep = (from, to) => {
  if (there(to) || !there(from)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try { fs.linkSync(from, to); } catch { fs.copyFileSync(from, to + ".new"); fs.renameSync(to + ".new", to); }
  return true;
};

// 41: each agent's uploaded picture, in its own store
if (layout < 41 && lead !== undefined) {
  const store = path.join(agents, lead.id, "docs");
  let pictures = 0;
  for (const a of rows) {
    const old = /^\/media\/([0-9a-f]{16}\.(png|jpeg|webp))$/.exec(a.picture);
    if (old !== null) {
      keep(path.join(store, "media", old[1]), path.join(agents, a.id, "docs", "media", old[1]));
      db.query("update agents set picture = ? where id = ?").run("/media/" + a.id + "/" + old[1], a.id);
      pictures += 1;
    }
  }
  if (pictures > 0) say("Each agent's uploaded picture is in its own store now.");
  rows = all();
}

// 41: the MCP servers switched off, for every agent
if (layout < 41 && lead !== undefined) {
  let off = [];
  try { off = JSON.parse(read(path.join(agents, lead.id, "view.json")) ?? "{}").off ?? []; } catch {}
  off = Array.isArray(off) ? off.filter((n) => typeof n === "string") : [];
  const file = path.join(dir, "config.json");
  const text = read(file);
  let conf = null;
  try { conf = text === null ? {} : JSON.parse(text); } catch {}
  if (off.length > 0 && conf !== null && typeof conf === "object" && !Array.isArray(conf) && conf.mcp_off === undefined) {
    const mode = text === null ? 0o600 : fs.statSync(file).mode & 0o777;
    fs.writeFileSync(file + ".new", JSON.stringify({ ...conf, mcp_off: off }, null, 2) + "\n", { mode });
    fs.renameSync(file + ".new", file);
    say("The MCP servers switched off (" + off.join(", ") + ") stay off, for every agent.");
  } else if (off.length > 0 && (conf === null || typeof conf !== "object" || Array.isArray(conf))) {
    say(file + " isn't plain JSON, so the MCP servers switched off before (" + off.join(", ") + ") are on again: switch them off in Settings.");
  }
}

// 41: the first agent's description
if (layout < 41 && has) db.query("update agents set about = ? where about = ?").run(NEW_ABOUT, OLD_ABOUT);

// 42: each file in the stores of the agents that name it, and only there
if (layout < 42 && rows.length > 0) {
  const NAME = /[0-9a-f]{16}\.[a-z0-9]{1,10}/g;
  const named = new Map(rows.map((a) => [a.id, new Set()]));
  const scan = (id, text) => {
    for (const name of text.match(NAME) ?? []) named.get(id).add(name);
  };
  for (const a of rows) {
    const mem = path.join(agents, a.id);
    scan(a.id, [a.picture, a.prompt ?? "", a.about].join("\n"));
    for (const p of [...files(mem), ...files(path.join(mem, "main")), ...files(path.join(mem, "tree")), ...files(path.join(mem, "docs", "agent"))]) {
      if (!p.endsWith(".index")) scan(a.id, read(p) ?? "");
    }
  }
  const FILE = /^[0-9a-f]{16}\.[a-z0-9]{1,10}$/;
  // what became of each name, and the agents a staying one is with (media/
  // first: images/ holds the models' copies of its pictures)
  const fate = new Map();
  const tell = (name, what, where = []) => { if (!fate.has(name)) fate.set(name, { what, where }); };
  for (const sub of ["media", "images"]) {
    const at = (id, name) => path.join(agents, id, "docs", sub, name);
    // a picture's file, and in images/ its smaller copy beside it
    const parts = (name) => sub === "images" ? [name, name + ".jpg"] : [name];
    const names = new Set(rows.flatMap((a) => files(path.join(agents, a.id, "docs", sub)).map((p) => path.basename(p)).filter((n) => FILE.test(n))));
    for (const name of names) {
      const holders = rows.filter((a) => there(at(a.id, name))).map((a) => a.id);
      const namers = rows.filter((a) => named.get(a.id).has(name)).map((a) => a.id);
      if (namers.length === 0) {
        tell(name, "stayed", holders);
        continue;
      }
      for (const id of namers) {
        for (const part of parts(name)) {
          const from = holders.map((h) => at(h, part)).find((p) => there(p));
          if (from !== undefined) keep(from, at(id, part));
        }
      }
      const extra = holders.filter((id) => !namers.includes(id));
      const home = namers.every((id) => there(at(id, name)));
      if (home) {
        for (const id of extra) {
          for (const part of parts(name)) fs.rmSync(at(id, part), { force: true });
        }
      }
      if (namers.length > 1) tell(name, "shared");
      else if (home && extra.length > 0) tell(name, "moved");
      else tell(name, "stayed", holders);
    }
  }
  const [moved, shared, stayed] = ["moved", "shared", "stayed"].map((what) => [...fate.values()].filter((f) => f.what === what).length);
  const where = [...new Set([...fate.values()].flatMap((f) => f.where))].map((id) => rows.find((a) => a.id === id).name);
  const stay = where.length === 1 ? " stay with " + where[0] : " stay where they were";
  if (moved + shared > 0) say("Each agent's pictures and files are in its own store now: " + moved + " moved to the one agent that names them, " + shared + " shared by the agents that name them (each has its own), " + stayed + stay + ".");
}
db.close();

// 47: the models gpt-6.2 replaced
if (layout < 47) {
  const NEW = { "gpt-6-astra": "gpt-6.2-astra", "gpt-6.1-sol": "gpt-6.2-sol" };
  const renamed = (label) => NEW[label] ?? label;
  // vendor:model[:effort[:speed]]
  const spec = (s) => typeof s === "string" ? s.split(":").map((part, k) => k === 1 ? renamed(part) : part).join(":") : s;
  const json = (p) => { const text = read(p); if (text === null) return null; try { return JSON.parse(text); } catch { return undefined; } };
  const save = (p, text) => {
    fs.writeFileSync(p + ".new", text, { mode: fs.statSync(p).mode & 0o777 });
    fs.renameSync(p + ".new", p);
  };
  const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
  const changed = [];
  const file = path.join(dir, "config.json");
  const conf = json(file);
  if (object(conf)) {
    const was = JSON.stringify(conf);
    if (typeof conf.models === "string") conf.models = [...new Set(conf.models.split(",").map((m) => renamed(m.trim())))].join(",");
    for (const key of ["pick", "compactor"]) if (typeof conf[key] === "string") conf[key] = spec(conf[key]);
    if (object(conf.profiles)) {
      for (const [name, list] of Object.entries(conf.profiles)) if (Array.isArray(list)) conf.profiles[name] = list.map(spec);
    }
    if (JSON.stringify(conf) !== was) {
      save(file, JSON.stringify(conf, null, 2) + "\n");
      changed.push("config.json");
    }
  } else if (conf === undefined && Object.keys(NEW).some((m) => (read(file) ?? "").includes(m))) {
    say(file + " isn't plain JSON, so it still names gpt-6-astra or gpt-6.1-sol, which this ki doesn't offer: change them to gpt-6.2-astra and gpt-6.2-sol.");
  }
  let picks = 0;
  const subs = new Set();
  for (const a of rows) {
    const view = path.join(agents, a.id, "view.json");
    const v = json(view);
    if (object(v) && object(v.pick) && NEW[v.pick.model] !== undefined) {
      v.pick.model = NEW[v.pick.model];
      save(view, JSON.stringify(v));
      picks += 1;
    }
    const own = path.join(agents, a.id, "docs", "agent");
    for (const p of files(own)) {
      const name = path.basename(p);
      if (name.endsWith(".pick.json")) {
        const pick = json(p);
        if (object(pick) && NEW[pick.model] !== undefined) {
          pick.model = NEW[pick.model];
          save(p, JSON.stringify(pick) + "\n");
          subs.add(p.slice(0, -".pick.json".length));
        }
      } else if (name.endsWith(".jsonl")) {
        const text = read(p);
        const end = text.indexOf("\n");
        let first = null;
        try { first = JSON.parse(end < 0 ? text : text.slice(0, end)); } catch {}
        const on = object(first) && first.kind === "note" && typeof first.text === "string" ? /^(subagent on )(\S+)/.exec(first.text) : null;
        if (on !== null && NEW[on[2]] !== undefined) {
          const note = first.text.replace(on[0], on[1] + NEW[on[2]]);
          const line = JSON.stringify({ ...first, text: note, size: first.size + Buffer.byteLength(note) - Buffer.byteLength(first.text) });
          save(p, line + (end < 0 ? "\n" : text.slice(end)));
          subs.add(p.slice(0, -".jsonl".length));
        }
      }
    }
  }
  if (picks > 0) changed.push(picks + " agent" + (picks === 1 ? "" : "s"));
  if (subs.size > 0) changed.push(subs.size + " subagent" + (subs.size === 1 ? "" : "s"));
  if (changed.length > 0) say("gpt-6-astra and gpt-6.1-sol are gpt-6.2-astra and gpt-6.2-sol now, in " + changed.join(", ") + ".");
}

fs.writeFileSync(path.join(dir, "layout.new"), LAYOUT + "\n");
fs.renameSync(path.join(dir, "layout.new"), path.join(dir, "layout"));
