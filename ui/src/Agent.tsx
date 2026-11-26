import { ShuffleIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { err_why } from "../../Err.ts";
import { get, text_of } from "../../Json.ts";
import * as View from "../../View.ts";
import { Avatar, Face, look_of, look_text } from "./Avatar.tsx";
import { Back } from "./Back.tsx";
import { act, holds, note, show, useMontroop } from "./Montroop.ts";
import { Versions } from "./Versions.tsx";

const Importer = lazy(() => import("./Importer.tsx"));

// an agent as its settings read and save it
type Agent = { id: string; name: string; about: string; picture: string; prompt: string; own: boolean; template: string; archived: number; leader: boolean; lines: number; manage: boolean; claude: string };
type All = { agents: Agent[]; template: string; accounts: string[] };
type Form = Pick<Agent, "name" | "about" | "picture" | "prompt" | "leader" | "manage" | "claude"> & { lines: string };

const NAME = 24;
const ABOUT = 120;

async function agents_read(): Promise<All | null> {
  const res = await fetch("/api/agents").catch(() => null);
  return res?.ok === true ? ((await res.json().catch(() => null)) as All | null) : null;
}

// what Leader mode adds to each request: about 400 B a line
function leader_cost(lines: number, agents: number): string {
  if (agents === 0) {
    return "Adds nothing now: there are no other mons.";
  }
  const kb = (lines * agents * 400) / 1000;
  const size = kb < 10 ? String(Math.round(kb * 10) / 10) : String(Math.round(kb));
  return "Adds about " + size + " KB to every request (" + lines + (lines === 1 ? " line" : " lines") + " × " + agents + (agents === 1 ? " mon" : " mons") + ").";
}

// a picture cropped square to 256 px, into the media store of an agent
async function picture_up(file: File, agent: string): Promise<string> {
  const img = await createImageBitmap(file);
  const side = Math.min(img.width, img.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.min(256, side);
  canvas.getContext("2d")?.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
  const res = await fetch("/api/media?name=picture.png&agent=" + encodeURIComponent(agent), { method: "POST", body: blob });
  const out = (await res.json()) as { url?: string; error?: string };
  if (out.url === undefined) {
    throw new Error(out.error ?? "HTTP " + res.status);
  }
  return out.url;
}

function Set({ name, about, children }: { name: string; about?: string; children: ReactNode }): ReactNode {
  return (
    <label className="set">
      <span>{name}{about === undefined ? null : <small>{about}</small>}</span>
      {children}
    </label>
  );
}

// the MCP servers of the devices, each on or off for every agent; the client
// holds the agent while its settings are open, to know which are on
function Plugs({ agent }: { agent: string }): ReactNode {
  const held = useMontroop((s) => s.agent === agent && s.loaded);
  const plugs = useMontroop((s) => s.plugs);
  useEffect(() => {
    show(agent, false);
    return () => show(null);
  }, [agent]);
  if (!held) {
    return null;
  }
  return (
    <>
      <h2 className="label">MCP servers</h2>
      {plugs.length === 0 ? <p className="lede">None set up. Add them as <code className="font-mono text-[0.84em]">mcp</code> in a device's own config.json: they run on that device.</p> : plugs.map((p) => (
        <label key={p.name} className="set">
          <span>{p.name}</span>
          <input type="checkbox" role="switch" className="switch" checked={p.on} onChange={() => act({ $: "Plug", name: p.name })} />
        </label>
      ))}
    </>
  );
}

// a's settings, saved as they change, or a new agent's, made with Create
function Fields({ a, all }: { a: Agent | null; all: All }): ReactNode {
  const navigate = useNavigate();
  const here = useMontroop((s) => s.agent);
  const others = useMontroop((s) => s.team.filter((m) => m.archived === 0 && m.id !== a?.id).length);
  const [seed] = useState(() => String(Math.random()));
  const [first] = useState<Form>(() => ({
    name    : a?.name ?? "",
    about   : a?.about ?? "",
    picture : a?.picture ?? look_text(look_of("", seed)),
    prompt  : a?.prompt ?? all.template.replaceAll("{Name}", ""),
    leader  : a?.leader ?? false,
    manage  : a?.manage ?? false,
    claude  : a?.claude ?? all.accounts[0] ?? "",
    lines   : String(a?.lines ?? View.LINES),
  }));
  const [form, setForm] = useState(first);
  // what the server has, as far as this page knows: an edit sends only what
  // differs, so it keeps what an agent changed meanwhile
  const kept = useRef(first);
  // the prompt follows the name until it is written by hand
  const [template, setTemplate] = useState(a === null ? all.template : a.own ? null : a.template);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(0);
  const [importing, setImporting] = useState(false);
  const saves = useRef(Promise.resolve());
  const file = useRef<HTMLInputElement>(null);
  const accounts = all.accounts.includes(form.claude) || form.claude === "" ? all.accounts : [...all.accounts, form.claude];
  // its settings changed elsewhere (by the mon itself, or another page): read
  // again, each field not being edited here taken as the server has it now
  const edited = useMontroop((s) => s.team.find((m) => m.id === a?.id)?.edited ?? 0);
  const seen = useRef(edited);
  useEffect(() => {
    if (a === null || edited === seen.current) {
      return;
    }
    seen.current = edited;
    const typed = form.prompt !== kept.current.prompt;
    void agents_read().then((got) => {
      const now = got?.agents.find((x) => x.id === a.id);
      if (now === undefined) {
        return;
      }
      const was = kept.current;
      const fresh: Form = { name: now.name, about: now.about, picture: now.picture, prompt: now.prompt, leader: now.leader, manage: now.manage, claude: now.claude, lines: String(now.lines) };
      kept.current = fresh;
      setForm((f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === was[k as keyof Form] ? fresh[k as keyof Form] : v])) as Form);
      if (fresh.prompt !== was.prompt) {
        setSaved((n) => n + 1);
        if (!typed) {
          setTemplate(now.own ? null : now.template);
        }
      }
    });
  }, [a, edited, form.prompt]);

  const send = (next: Form) => {
    holds("agent", true);
    const last = saves.current.then(async () => {
      // a prompt that follows the name is the server's to follow
      const changed = a === null ? { ...next, ...(accounts.length < 2 ? { claude: undefined } : {}) } : Object.fromEntries(Object.entries(next).filter(([k, v]) => kept.current[k as keyof Form] !== v && !(k === "prompt" && template !== null)));
      if (Object.keys(changed).length === 0) {
        return;
      }
      const out = await View.post("/api/agents" + (a === null ? "" : "/" + a.id), changed);
      setWhy(out.error === undefined ? "" : text_of(out.error));
      if (out.error !== undefined) {
        return;
      }
      kept.current = { ...kept.current, ...changed };
      if ("prompt" in changed) {
        setSaved((n) => n + 1);
      }
      if (a === null) {
        void navigate({ to: "/a/$agent", params: { agent: text_of(get(out.agent, "id")) } });
      }
    }).finally(() => holds("agent", saves.current !== last));
    saves.current = last;
    return last;
  };
  // typed fields save when left, switches and picks at once
  const set = (to: Partial<Form>, now = false) => {
    const next = { ...form, ...to };
    if (to.name !== undefined && template !== null) {
      next.prompt = template.replaceAll("{Name}", to.name.trim());
    }
    setForm(next);
    if (now && a !== null) {
      void send(next);
    }
  };
  const left = () => {
    if (a !== null) {
      void send(form);
    }
  };
  const upload = (got: File | undefined) => {
    if (got === undefined) {
      return;
    }
    setBusy(true);
    picture_up(got, a?.id ?? here).then((url) => set({ picture: url }, true), (err: unknown) => setWhy("Could not upload it: " + err_why(err))).finally(() => setBusy(false));
  };
  const archive = () => {
    if (a !== null && confirm("Archive " + a.name + "? It leaves the team. A running turn and its jobs finish; its timers pause. Settings can restore it.")) {
      void View.post("/api/agents/" + a.id + "/archive", {}).then((out) => (out.error === undefined ? void navigate({ to: "/", replace: true }) : note(text_of(out.error))));
    }
  };

  return (
    <section className="page">
      <header className="head pl-3.5">
        {a === null ? <Back to="/" label="Back to your mons" /> : <Back to={"/a/" + a.id} label="Back to the chat" />}
        <h1 className="truncate pl-1.5">{a === null ? "New mon" : form.name}</h1>
      </header>
      <div className="scroll pb-6">
        <form className="mx-auto flex max-w-xl flex-col" autoComplete="off" onSubmit={(ev) => { ev.preventDefault(); void send(form); }}>
          <div className="grid place-items-center gap-4 pt-4 pb-2">
            <Face picture={form.picture} id={a?.id ?? seed} size={132} lit />
            <div className="flex flex-wrap justify-center gap-2">
              {a === null
                ? <button type="button" className="pillbtn px-4 text-[0.9375rem]" onClick={() => set({ picture: look_text(look_of("", String(Math.random()))) })}><ShuffleIcon size={18} weight="bold" />Another look</button>
                : <Link to="/a/$agent/look" params={{ agent: a.id }} className="pillbtn px-4 text-[0.9375rem]"><Avatar look={look_of(form.picture, a.id)} size={22} />Draw its look</Link>}
              <button type="button" className="pillbtn px-4 text-[0.9375rem]" disabled={busy} onClick={() => file.current?.click()}><UploadSimpleIcon size={18} weight="bold" />{busy ? "Uploading…" : "Upload a picture"}</button>
              <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(ev) => { upload(ev.target.files?.[0]); ev.target.value = ""; }} />
            </div>
          </div>
          <Set name="Name">
            <input className="field" maxLength={NAME} spellCheck={false} value={form.name} onChange={(ev) => set({ name: ev.target.value })} onBlur={left} />
          </Set>
          <Set name="Description" about="For the team list and the other mons.">
            <input className="field" maxLength={ABOUT} value={form.about} onChange={(ev) => set({ about: ev.target.value })} onBlur={left} />
          </Set>
          <Set name="System prompt" about="Who it is and what it does.">
            <textarea className="field" rows={6} value={form.prompt} onChange={(ev) => { setTemplate(null); set({ prompt: ev.target.value }); }} onBlur={left} />
          </Set>
          {accounts.length < 2 ? null : (
            <Set name="Claude account" about="The Claude sign-in it, its submons and its memory's summaries use, with that account's usage limits and connectors.">
              <select className="field" value={form.claude} onChange={(ev) => set({ claude: ev.target.value }, true)}>
                {accounts.map((c) => <option key={c} value={c}>{c}{all.accounts.includes(c) ? "" : " (signed out)"}</option>)}
              </select>
            </Set>
          )}
          <Set name="Manage mons" about="It may create, edit, archive and restore mons, when you ask it to. None is deleted.">
            <input type="checkbox" role="switch" className="switch" checked={form.manage} onChange={(ev) => set({ manage: ev.target.checked }, true)} />
          </Set>
          <Set name="Leader mode" about="Each turn, the newest lines of every other mon's memory, to zoom into.">
            <input type="checkbox" role="switch" className="switch" checked={form.leader} onChange={(ev) => set({ leader: ev.target.checked }, true)} />
          </Set>
          {form.leader ? (
            <Set name="Lines per mon" about={Number.isInteger(Number(form.lines)) && Number(form.lines) >= 1 ? leader_cost(Number(form.lines), others) : undefined}>
              <input className="field" type="number" inputMode="numeric" min={1} max={View.LINES_MOST} step={1} value={form.lines} onChange={(ev) => set({ lines: ev.target.value })} onBlur={left} />
            </Set>
          ) : null}
          {a === null ? null : <Plugs agent={a.id} />}
          {a === null ? null : <Versions agent={a.id} saved={saved} reverted={(prompt) => { kept.current = { ...kept.current, prompt }; setTemplate(prompt === a.template.replaceAll("{Name}", form.name.trim()) ? a.template : null); setForm((f) => ({ ...f, prompt })); }} />}
          {why === "" ? null : <p className="px-5.5 pt-3 text-[0.9375rem] text-bad" role="alert">{why}</p>}
          {a === null ? <div className="px-3.5 pt-5"><button type="submit" className="pillbtn go w-full">Create</button></div> : (
            <>
              <h2 className="label">History</h2>
              <div className="item">
                <p>Import history<small>Past Claude and ChatGPT chats, into its memory.</small></p>
                <button type="button" className="pillbtn min-h-11 px-4 text-[0.875rem]" onClick={() => setImporting(true)}>Import</button>
              </div>
              <h2 className="label">Archive</h2>
              <div className="item">
                <p>Archive {a.name}<small>Settings can restore it.</small></p>
                <button type="button" className="pillbtn min-h-11 px-4 text-[0.875rem] text-bad" onClick={archive}>Archive</button>
              </div>
            </>
          )}
        </form>
      </div>
      {importing && a !== null ? <Suspense><Importer agent={a.id} shut={() => setImporting(false)} /></Suspense> : null}
    </section>
  );
}

// a new agent (agent null), or an agent's settings
export function AgentPage({ agent }: { agent: string | null }): ReactNode {
  const [all, setAll] = useState<All | null | undefined>(undefined);
  useEffect(() => {
    void agents_read().then(setAll);
  }, [agent]);
  const a = agent === null ? null : all?.agents.find((x) => x.id === agent);
  if (all == null || a === undefined) {
    return <section className="page"><p className="lede pt-8">{all === undefined ? "" : all === null ? "Could not read the mons. Try again in a moment." : "No such mon."}</p></section>;
  }
  return <Fields key={agent ?? "new"} a={a} all={all} />;
}

// the agents archived, each to restore or delete for good
export function Archived(): ReactNode {
  const gone = useMontroop((s) => s.team).filter((m) => m.archived !== 0);
  const restore = (m: View.Mate) => void View.post("/api/agents/" + m.id + "/restore", {}).then((out) => note(out.error === undefined ? m.name + " is back in the team." : text_of(out.error)));
  const drop = async (m: View.Mate) => {
    const left = (await fetch("/api/agents/" + m.id + "/left").then((r) => r.json()).catch(() => ({ left: [] }))) as { left: string[] };
    const folders = left.left.length === 0 ? "" : "\n\nThese scratch folders stay, on devices not open now: " + left.left.join(", ") + ".";
    if (!confirm("Delete " + m.name + " for good? Its memory is deleted and can't be brought back, and so are its scratch folders on the open devices." + folders)) {
      return;
    }
    const res = await fetch("/api/agents/" + m.id, { method: "DELETE" }).catch(() => null);
    const out = ((await res?.json().catch(() => null)) ?? { error: "Can't reach Montroop." }) as { error?: string };
    note(out.error ?? m.name + " is deleted.");
  };
  if (gone.length === 0) {
    return null;
  }
  return (
    <>
      <h2 className="label">Archived mons</h2>
      {gone.map((m) => (
        <div key={m.id} className="item">
          <Face picture={m.picture} id={m.id} size={36} />
          <p>{m.name}<small>{m.about}</small></p>
          <button type="button" className="pillbtn min-h-11 px-4 text-[0.875rem]" onClick={() => restore(m)}>Restore</button>
          <button type="button" className="pillbtn min-h-11 px-4 text-[0.875rem] text-bad" onClick={() => void drop(m)}>Delete</button>
        </div>
      ))}
    </>
  );
}
