import * as config from "./Config.ts";
import { Owner } from "./Owner.ts";
import { get as field, rec } from "./Json.ts";
import { look_wrong } from "./Looks.ts";
import * as Prompts from "./Prompts.ts";

// prompt null: the default, which follows renames until it's edited;
// claude: its Claude account ("": personal, config.PERSONAL)
export type Agent = { id: string; name: string; about: string; picture: string; prompt: string | null; archived: number; made: number; unread: number; claude: string };

type Fields = { name: string; about: string; picture: string; prompt: string | null; claude: string };

// a prompt an agent had, kept when it was changed (who: the agent that
// changed it, by name; null: the owner); a default one reads with its name now
export type Version = { id: number; at: number; who: string | null; prompt: string };

const SCHEMA = "create table if not exists agents (id text primary key, name text not null, about text not null, picture text not null, prompt text, archived integer not null default 0, made integer not null, unread integer not null default 0, claude text not null default '')";

const PROMPTS = "create table if not exists prompts (id integer primary key, agent text not null, at integer not null, who text, prompt text)";

const KEPT = 50;

const NAME  = 24;
const ABOUT = 120;
const OWN   = 64 * 1024;

const HEADS = 24;

const LOGO = "logo";

const FIRST_ABOUT = "The user's assistant and first point of contact.";

export namespace Team {

  // a new install's one agent, made now (null: there are agents already)
  export function open(): string | null {
    const db = Owner.open();
    db.run(SCHEMA);
    db.run(PROMPTS);
    if (!(db.query("select name from pragma_table_info('agents')").all() as Array<{ name: string }>).some((c) => c.name === "claude")) {
      db.run("alter table agents add column claude text not null default ''");
    }
    if (db.query("select 1 from agents").get() !== null) {
      return null;
    }
    const id = new_id();
    db.query("insert into agents (id, name, about, picture, prompt, made) values (?, ?, ?, ?, null, 0)").run(id, "Montroop", FIRST_ABOUT, LOGO);
    return id;
  }

  export function all(): Agent[] {
    return Owner.open().query("select * from agents order by made, id").all() as Agent[];
  }

  export function active(): Agent[] {
    return Team.all().filter((a) => a.archived === 0);
  }

  // the oldest active agent, whose chat takes what belongs to no agent
  export function first(): Agent {
    return Team.active()[0] ?? Team.all()[0];
  }

  export function get(id: string): Agent | null {
    return (Owner.open().query("select * from agents where id = ?").get(id) as Agent | null) ?? null;
  }

  export function by_name(name: string): Agent | null {
    return Team.all().find((a) => a.name.toLowerCase() === name.trim().toLowerCase()) ?? null;
  }

  export function prompt(a: Agent): string {
    return a.prompt ?? Team.default_prompt(a.name);
  }

  export function default_prompt(name: string): string {
    return Prompts.prompt("agent", { Name: name });
  }

  // the fields a form sent, checked: a text saying what's wrong, or the
  // fields to keep (a prompt that is the default is kept as none; no
  // Claude account sent: the one it has)
  export function fields(x: unknown, id: string | null): Fields | string {
    const text = (k: string) => (typeof field(x, k) === "string" ? String(field(x, k)) : "");
    const name = text("name").trim();
    const about = text("about").trim();
    const picture = text("picture").trim() || head_random();
    const own = text("prompt").trim();
    const was = id === null ? "" : Team.get(id)?.claude ?? "";
    const sent = typeof field(x, "claude") === "string" ? text("claude").trim() : null;
    const claude = sent === null ? was : sent === config.PERSONAL ? "" : sent;
    const taken = Team.by_name(name);
    if (name === "" || name.length > NAME) {
      return "A name is 1 to " + NAME + " characters.";
    }
    if (name.includes("@")) {
      return "A name has no @.";
    }
    if (taken !== null && taken.id !== id) {
      return taken.name + " is taken" + (taken.archived === 0 ? "." : ", by an archived agent.");
    }
    if (about === "" || about.length > ABOUT || /[\r\n]/.test(about)) {
      return "A description is one line of 1 to " + ABOUT + " characters.";
    }
    if (!picture_ok(picture)) {
      return "No picture " + picture + ".";
    }
    // a look saved before is kept, though the app no longer draws one of its parts
    const wrong = id !== null && Team.get(id)?.picture === picture ? null : look_wrong(picture);
    if (wrong !== null) {
      return wrong;
    }
    if (own === "") {
      return "A system prompt is needed.";
    }
    if (own.length > OWN) {
      return "A system prompt holds at most " + OWN / 1024 + " KB.";
    }
    if (claude !== was && claude !== "" && !config.claude_accounts().includes(claude)) {
      return "No Claude account " + claude + " is signed in: run `troop serve claude login --account " + claude + "` on the server.";
    }
    return { name, about, picture, prompt: own === Team.default_prompt(name) ? null : own, claude };
  }

  // an edit of a: what x doesn't send stays as it is (a default prompt
  // follows a new name)
  export function edit(a: Agent, x: unknown): Fields | string {
    if (!rec(x)) {
      return "An edit is a JSON object.";
    }
    const name = field(x, "name");
    const prompt = a.prompt ?? Team.default_prompt(typeof name === "string" ? name.trim() : a.name);
    return Team.fields({ name: a.name, about: a.about, picture: a.picture, prompt, ...x }, a.id);
  }

  // a drawn avatar: its shape, eyes, glasses and extra, then its two colors
  const DRAWN = /^av:[a-z]{1,12}(?:\.[a-z]{1,12}){3}(?:\.[0-9a-f]{6}){2}$/;

  function picture_ok(picture: string): boolean {
    const head = /^head-(\d\d)$/.exec(picture);
    return (head !== null && Number(head[1]) >= 1 && Number(head[1]) <= HEADS) || /^\/media\/(?:[a-z0-9]{1,16}\/)?[0-9a-f]{16}\.(png|jpeg|webp)$/.test(picture) || picture === LOGO || DRAWN.test(picture);
  }

  function head_random(): string {
    return "head-" + String(1 + Math.floor(Math.random() * HEADS)).padStart(2, "0");
  }

  function new_id(): string {
    let id = "";
    do {
      id = "a" + Math.random().toString(36).slice(2, 9);
    } while (Team.get(id) !== null);
    return id;
  }

  export function add(f: Fields): Agent {
    const id = new_id();
    Owner.open().query("insert into agents (id, name, about, picture, prompt, made, claude) values (?, ?, ?, ?, ?, ?, ?)").run(id, f.name, f.about, f.picture, f.prompt, Date.now(), f.claude);
    return Team.get(id) as Agent;
  }

  export function set(id: string, f: Fields, who: Version["who"]): Agent | null {
    const db = Owner.open();
    const was = Team.get(id);
    db.transaction(() => {
      if (was !== null && was.prompt !== f.prompt) {
        db.query("insert into prompts (agent, at, who, prompt) values (?, ?, ?, ?)").run(id, Date.now(), who, was.prompt);
        db.query("delete from prompts where agent = ? and id not in (select id from prompts where agent = ? order by id desc limit ?)").run(id, id, KEPT);
      }
      db.query("update agents set name = ?, about = ?, picture = ?, prompt = ?, claude = ? where id = ?").run(f.name, f.about, f.picture, f.prompt, f.claude, id);
    })();
    return Team.get(id);
  }

  export function versions(a: Agent): Version[] {
    const kept = Owner.open().query("select id, at, who, prompt from prompts where agent = ? order by id desc").all(a.id) as Array<Omit<Version, "prompt"> & { prompt: string | null }>;
    return kept.map((v) => ({ ...v, prompt: v.prompt ?? Team.default_prompt(a.name) }));
  }

  export function archive(id: string, on: boolean): void {
    Owner.open().query("update agents set archived = ? where id = ?").run(on ? Date.now() : 0, id);
  }

  export function drop(id: string): void {
    Owner.open().query("delete from agents where id = ?").run(id);
    Owner.open().query("delete from prompts where agent = ?").run(id);
  }

  export function unread(id: string, n: number | null): void {
    const sql = n === null ? "update agents set unread = unread + 1 where id = ?" : "update agents set unread = ? where id = ?";
    Owner.open().query(sql).run(...(n === null ? [id] : [n, id]));
  }

}
