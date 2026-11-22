import { ArrowDownIcon, ArrowUpIcon, XIcon } from "@phosphor-icons/react";
import { Fragment, useEffect, type ReactNode } from "react";
import { create } from "zustand";
import type { Vendor } from "../../AskAI.ts";
import { err_why } from "../../Err.ts";
import { text_of } from "../../Json.ts";
import { LABELS, Pick, VENDORS } from "../../Pick.ts";
import { Rules, SCRATCH, type Rule } from "../../Rules.ts";
import type { Key, Page, Row } from "../../Settings.ts";
import * as View from "../../View.ts";
import { holds, note } from "./Ki.ts";

// the server's settings as it last gave them, and over them what was
// changed here and isn't saved yet; bad: what it refused, by setting
type Draft = {
  page  : Page | null | undefined;
  set   : Record<string, string>;
  lists : Record<string, string[]>;
  keys  : Record<string, string>;
  unset : string[];
  profs : Array<[string, string[]]> | null;
  rules : Rule[] | null;
  bad   : Record<string, string>;
};

const CLEAN = { set: {}, lists: {}, keys: {}, unset: [], profs: null, rules: null, bad: {} };

const useSet = create<Draft>(() => ({ page: undefined, ...CLEAN }));

const SETTING: Record<string, [string, string]> = {
  pick              : ["Default model", "For chats that haven't picked one."],
  compactor         : ["Compactor model", "Writes the memory's summaries."],
  thinking          : ["Show thinking", "The model's thinking, in the chat."],
  hops              : ["Hop limit", "Agent-to-agent messages in a row; 0: off."],
  compactor_context : ["Compactor context", "KB of chat each summary sees (1–128)."],
};

const KEYS: Record<string, [string, string]> = {
  anthropic : ["Anthropic key", "For claude-api."],
  openai    : ["OpenAI key", "For openai-api and dictation."],
};

const VENDOR_KEY: Record<string, string> = { "claude-api": "anthropic", "openai-api": "openai" };

const GROUPS: Array<[string, string[]]> = [
  ["Chat", ["thinking"]],
  ["Agents", ["hops"]],
  ["Models", ["vendors", "pick", "compactor", "compactor_context"]],
];

const SAVED = ["thinking", "hops", "vendors", "models", "pick", "compactor", "compactor_context"];

function list(text: string): string[] {
  return text.split(",").map((x) => x.trim()).filter((x) => x !== "");
}

// null when the same set: the order kept is the saved one's
function list_changed(was: string[], now: string[]): string[] | null {
  const same = was.length === now.length && was.every((x) => now.includes(x)) && now.every((x) => was.includes(x));
  return same ? null : [...was.filter((x) => now.includes(x)), ...now.filter((x) => !was.includes(x))];
}

function row_of(s: Draft, key: string): Row | undefined {
  return s.page?.settings.find((r) => r.key === key);
}

function value_of(s: Draft, key: string): string {
  return s.unset.includes(key) ? row_of(s, key)?.def ?? "" : s.set[key] ?? row_of(s, key)?.value ?? "";
}

function listed(s: Draft, key: string): string[] {
  return s.unset.includes(key) ? list(row_of(s, key)?.def ?? "") : s.lists[key] ?? list(row_of(s, key)?.value ?? "");
}

function profs_of(s: Draft): Array<[string, string[]]> {
  return s.profs ?? Object.entries(s.page?.profiles ?? {}).map(([name, models]): [string, string[]] => [name, [...models]]);
}

function rules_of(s: Draft): Rule[] {
  return s.rules ?? (s.page?.ask ?? []).map((r) => ({ ...r }));
}

// a model pick made whole again after one of its parts changed
function pick_mend(parts: string[], models: string[], profiles: string[]): string {
  const [vendor = "", model = "", effort = "", speed = ""] = parts;
  if (profiles.includes(vendor)) {
    return vendor;
  }
  if (!(VENDORS as string[]).includes(vendor)) {
    return vendor === "" ? "" : parts.join(":");
  }
  const m = Pick.model(vendor as Vendor, model) ?? Pick.models([vendor as Vendor], models)[0]?.[1];
  if (m === undefined) {
    return parts.join(":");
  }
  return [vendor, m.label, Pick.offers(m, effort) ? effort : m.effort, m.speeds.includes(speed) ? speed : m.speeds[0]].join(":");
}

let CHAIN = Promise.resolve();

// one save at a time, each of what is changed by then
function soon(): void {
  holds("settings", true);
  const last: Promise<void> = CHAIN.then(save).catch((err: unknown) => note(err_why(err))).then(() => holds("settings", CHAIN !== last));
  CHAIN = last;
}

function change(to: Partial<Draft>, key: string | null, now = false): void {
  const s = useSet.getState();
  const bad = { ...s.bad };
  if (key !== null) {
    delete bad[key];
  }
  useSet.setState({ ...to, bad, unset: s.unset.filter((k) => k !== key) });
  if (now) {
    soon();
  }
}

async function save(): Promise<void> {
  const s = useSet.getState();
  const page = s.page;
  if (page == null) {
    return;
  }
  const set: Record<string, string | null> = {};
  const keys: Record<string, string | null> = {};
  for (const r of page.settings.filter((x) => SAVED.includes(x.key) && x.web && x.from !== "env" && !(x.key in s.bad))) {
    const lists = r.key === "vendors" || r.key === "models";
    const now = lists ? (s.lists[r.key] === undefined ? r.value : list_changed(list(r.value), s.lists[r.key])?.join(",") ?? r.value) : s.set[r.key]?.trim() ?? r.value;
    if (s.unset.includes(r.key)) {
      set[r.key] = null;
    } else if (now !== r.value) {
      set[r.key] = now;
    }
  }
  for (const k of page.keys.filter((x) => !("key." + x.name in s.bad))) {
    const typed = s.keys[k.name]?.trim() ?? "";
    if (s.unset.includes("key." + k.name)) {
      keys[k.name] = null;
    } else if (typed !== "") {
      keys[k.name] = typed;
    }
  }
  const bad = { ...s.bad };
  // a profile still being made (no name or no model yet) waits
  let profiles: Record<string, string[]> | undefined;
  if (page.profiles != null && s.profs !== null) {
    const now = s.profs.map(([name, models]): [string, string[]] => [name.trim(), models]);
    const all = now.map(([name]) => name);
    const making = all.includes("") || now.some(([, models]) => models.length === 0);
    const twice = all.some((name, k) => name !== "" && all.indexOf(name) !== k);
    twice ? (bad.profiles = "Two profiles have the same name.") : delete bad.profiles;
    profiles = making || twice || JSON.stringify(Object.fromEntries(now)) === JSON.stringify(page.profiles) ? undefined : Object.fromEntries(now);
  }
  // a rule still being made (no name or no tools yet) waits too
  let ask: Rule[] | null | undefined;
  if (s.rules !== null) {
    const drafting = s.rules.some((r) => r.what.trim() === "" || r.tools.trim() === "");
    const read = drafting ? null : Rules.read(s.rules);
    typeof read === "string" ? (bad.ask = read + ".") : delete bad.ask;
    ask = read === null || typeof read === "string" || JSON.stringify(read) === JSON.stringify(page.ask) ? undefined : JSON.stringify(read) === JSON.stringify(page.built) ? null : read;
  }
  useSet.setState({ bad });
  const many = Object.keys(set).length + Object.keys(keys).length + (profiles === undefined ? 0 : 1) + (ask === undefined ? 0 : 1);
  if (many === 0) {
    return;
  }
  const out = await View.post("/api/settings", { version: page.version, set, keys, ...(profiles === undefined ? {} : { profiles }), ...(ask === undefined ? {} : { ask }) });
  const t = useSet.getState();
  if (out.ok !== true) {
    const key = out.key === undefined ? null : text_of(out.key, "null");
    if (key === null) {
      note(text_of(out.error, "Could not save."));
      return;
    }
    // the others go on without it
    useSet.setState({ bad: { ...t.bad, [key]: text_of(out.error, "Could not save.") } });
    if (many > 1) {
      soon();
    }
    return;
  }
  // what changed since this save was sent stays as it was left
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  useSet.setState({
    page  : out as unknown as Page,
    set   : Object.fromEntries(Object.entries(t.set).filter(([k, x]) => x !== s.set[k])),
    lists : Object.fromEntries(Object.entries(t.lists).filter(([k, x]) => !same(x, s.lists[k]))),
    keys  : Object.fromEntries(Object.entries(t.keys).filter(([k, x]) => x !== s.keys[k])),
    unset : t.unset.filter((k) => !s.unset.includes(k)),
    profs : profiles !== undefined && same(t.profs, s.profs) ? null : t.profs,
    rules : ask !== undefined && same(t.rules, s.rules) ? null : t.rules,
  });
}

function Err({ at }: { at: string }): ReactNode {
  const why = useSet((s) => s.bad[at]);
  return why === undefined ? null : <p className="text-[0.875rem] text-bad" role="alert">{why}</p>;
}

// back to the default, for a setting that isn't on it
function Reset({ keys, text = "Reset" }: { keys: string[]; text?: string }): ReactNode {
  return <button type="button" className="justify-self-start text-[0.875rem] font-semibold text-act-ink underline" onClick={() => { useSet.setState((s) => ({ unset: [...new Set([...s.unset, ...keys])], set: Object.fromEntries(Object.entries(s.set).filter(([k]) => !keys.includes(k))), lists: Object.fromEntries(Object.entries(s.lists).filter(([k]) => !keys.includes(k))) })); soon(); }}>{text}</button>;
}

// one column per family of models, its vendors in the head and its models
// under it; a model none of whose vendors is on is dimmed
function Models(): ReactNode {
  const s = useSet();
  const [vendors, models] = [listed(s, "vendors"), listed(s, "models")];
  const fams: Array<{ vendors: Vendor[]; labels: string[] }> = [];
  for (const v of VENDORS) {
    const labels = Pick.models([v], LABELS).map(([, m]) => m.label);
    const fam = fams.find((f) => f.labels.some((l) => labels.includes(l)));
    if (fam === undefined) {
      fams.push({ vendors: [v], labels });
    } else {
      fam.vendors.push(v);
      fam.labels.push(...labels.filter((l) => !fam.labels.includes(l)));
    }
  }
  const flip = (key: string, all: string[], x: string, on: boolean) => change({ lists: { ...s.lists, [key]: on ? [...all, x] : all.filter((y) => y !== x) } }, key, true);
  const box = (key: string, all: string[], x: string, dim: boolean) => (
    <label key={x} className={"opt" + (dim ? " off" : "")}><input type="checkbox" checked={all.includes(x)} onChange={(ev) => flip(key, all, x, ev.target.checked)} /> {x}</label>
  );
  const keyless = vendors.filter((v) => {
    const key = s.page?.keys.find((k) => k.name === VENDOR_KEY[v]);
    return key !== undefined && (key.from === "default" || s.unset.includes("key." + key.name)) && (s.keys[key.name] ?? "").trim() === "";
  });
  const odd = models.filter((x) => !LABELS.includes(x));
  const rows = Math.max(...fams.map((f) => f.labels.length));
  return (
    <div className="set">
      <div className="models" style={{ gridTemplateColumns: `repeat(${fams.length}, 1fr)` }}>
        {fams.map((f) => <div key={f.vendors.join()} className="head">{f.vendors.map((v) => box("vendors", vendors, v, false))}</div>)}
        {Array.from({ length: rows }, (_, k) => fams.map((f, j) => (f.labels[k] === undefined ? <span key={j + "/" + k} /> : box("models", models, f.labels[k], !Pick.models(VENDORS, [f.labels[k]]).some(([v]) => vendors.includes(v))))))}
        {odd.map((x) => box("models", models, x, false))}
      </div>
      {keyless.length === 0 ? null : <p className="text-[0.875rem] text-bad">{keyless.join(" and ") + (keyless.length === 1 ? " has" : " have") + " no key set: its calls will fail till one is."}</p>}
      {row_of(s, "vendors")?.from === "file" || row_of(s, "models")?.from === "file" ? <Reset keys={["vendors", "models"]} /> : null}
      <Err at="vendors" /><Err at="models" />
    </div>
  );
}

// a model as its vendor (or a profile), model, effort and speed
function Picked({ at }: { at: string }): ReactNode {
  const s = useSet();
  const r = row_of(s, at);
  const value = value_of(s, at);
  const [vendors, models] = [listed(s, "vendors"), listed(s, "models")];
  const profiles = profs_of(s).map(([name]) => name.trim()).filter((name) => name !== "");
  const [vendor = "", model = "", effort = "", speed = ""] = value === "" ? [] : value.split(":");
  const known = (VENDORS as string[]).includes(vendor);
  const m = known ? Pick.model(vendor as Vendor, model) : undefined;
  const parts: Array<[string, string[], string]> = [["Vendor", [...VENDORS.filter((v) => vendors.includes(v)), ...profiles], vendor]];
  if (vendor !== "" && !profiles.includes(vendor)) {
    parts.push(["Model", known ? Pick.models([vendor as Vendor], models).map(([, x]) => x.label) : [], model]);
    (m?.efforts ?? []).length > 0 && parts.push(["Effort", m?.efforts ?? [], effort]);
    parts.push(["Speed", m?.speeds ?? [], speed]);
  }
  const pick = (k: number, to: string) => {
    const next = [vendor, model, effort, speed];
    next[["Vendor", "Model", "Effort", "Speed"].indexOf(parts[k][0])] = to;
    change({ set: { ...s.set, [at]: pick_mend(next, models, profiles) } }, at, true);
  };
  return (
    <div className="set">
      <span>{SETTING[at][0]}<small>{SETTING[at][1]}</small></span>
      <div className="four">
        {parts.map(([name, all, on], k) => (
          <select key={name} className="field" aria-label={name} value={on} onChange={(ev) => pick(k, ev.target.value)}>
            {all.includes(on) ? null : <option value={on}>{on === "" ? "None" : on + " (not offered)"}</option>}
            {all.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        ))}
      </div>
      {r?.from === "file" ? <Reset keys={[at]} /> : null}
      <Err at={at} />
    </div>
  );
}

function Plain({ at }: { at: string }): ReactNode {
  const s = useSet();
  const r = row_of(s, at);
  const [name, about] = SETTING[at] ?? [at, ""];
  if (at === "thinking") {
    return (
      <label className="set">
        <span>{name}<small>{about}</small></span>
        <input type="checkbox" role="switch" className="switch" checked={value_of(s, at) === "on"} onChange={(ev) => change({ set: { ...s.set, [at]: ev.target.checked ? "on" : "off" } }, at, true)} />
        <Err at={at} />
      </label>
    );
  }
  return (
    <label className="set">
      <span>{name}<small>{about}</small></span>
      <input className="field" type="number" inputMode="numeric" min={at === "hops" ? 0 : 1} max={at === "hops" ? 100 : 128} step={1} value={value_of(s, at)} placeholder={r?.def} onChange={(ev) => change({ set: { ...s.set, [at]: ev.target.value } }, at)} onBlur={soon} />
      {r?.from === "file" ? <Reset keys={[at]} /> : null}
      <Err at={at} />
    </label>
  );
}

// a profile: a name for a list of models, the next tried when one is out
function Profiles(): ReactNode {
  const s = useSet();
  const profs = profs_of(s);
  const offered = Pick.models(VENDORS.filter((v) => listed(s, "vendors").includes(v)), listed(s, "models")).map(([v, m]) => v + ":" + m.label);
  const put = (next: Array<[string, string[]]>, now = true) => change({ profs: next }, "profiles", now);
  const edit = (i: number, to: (models: string[]) => string[]) => put(profs.map(([name, models], k): [string, string[]] => [name, k === i ? to([...models]) : models]));
  const renamed = (i: number, to: string) => {
    const was = profs[i][0].trim();
    const set = Object.fromEntries(["pick", "compactor"].filter((k) => was !== "" && to.trim() !== "" && value_of(s, k) === was).map((k) => [k, to.trim()]));
    change({ profs: profs.map(([name, models], k): [string, string[]] => [k === i ? to : name, models]), set: { ...s.set, ...set } }, "profiles");
  };
  return (
    <div className="set">
      <span><small>Falls back to the next model when one is out.</small></span>
      {profs.map(([name, models], i) => {
        const left = offered.filter((m) => !models.some((x) => x.split(":").slice(0, 2).join(":") === m));
        return (
          <div key={i} className="prof">
            <div className="flex gap-2">
              <input className="field" value={name} aria-label="Name" placeholder="The profile's name" maxLength={60} spellCheck={false} autoCapitalize="off" onChange={(ev) => renamed(i, ev.target.value)} onBlur={soon} />
              <button type="button" className="pillbtn px-4 text-[0.875rem] text-bad" onClick={() => put(profs.filter((_, k) => k !== i))}>Delete</button>
            </div>
            <ol>
              {models.map((m, j) => {
                const [vendor = "", label = m, ...rest] = m.split(":");
                return (
                  <li key={m}>
                    <span>{label} <small>{[...rest, vendor].join(" · ")}</small></span>
                    <button type="button" aria-label={"Move " + label + " up"} disabled={j === 0} onClick={() => edit(i, (l) => { [l[j - 1], l[j]] = [l[j], l[j - 1]]; return l; })}><ArrowUpIcon size={16} weight="bold" /></button>
                    <button type="button" aria-label={"Move " + label + " down"} disabled={j === models.length - 1} onClick={() => edit(i, (l) => { [l[j + 1], l[j]] = [l[j], l[j + 1]]; return l; })}><ArrowDownIcon size={16} weight="bold" /></button>
                    <button type="button" aria-label={"Remove " + label} onClick={() => edit(i, (l) => l.filter((_, k) => k !== j))}><XIcon size={16} weight="bold" /></button>
                  </li>
                );
              })}
            </ol>
            {left.length === 0 ? null : (
              <select className="field" aria-label="Add model" value="" onChange={(ev) => ev.target.value !== "" && edit(i, (l) => [...l, ev.target.value])}>
                <option value="">Add model</option>
                {[...new Set(left.map((m) => m.split(":")[0]))].map((v) => <optgroup key={v} label={v}>{left.filter((m) => m.startsWith(v + ":")).map((m) => <option key={m} value={m}>{m.split(":")[1]}</option>)}</optgroup>)}
              </select>
            )}
          </div>
        );
      })}
      <button type="button" className="pillbtn justify-self-start px-4 text-[0.875rem]" onClick={() => put([...profs, ["", []]], false)}>Add profile</button>
      <Err at="profiles" />
    </div>
  );
}

// the calls the agents wait for a yes before
function Ask(): ReactNode {
  const s = useSet();
  const rules = rules_of(s);
  const put = (next: Rule[], now: boolean) => change({ rules: next }, "ask", now);
  const field = (i: number, key: keyof Rule, label: string, hint: string) => (
    <input className={"field" + (key === "what" ? "" : " font-mono text-[0.8125rem]")} value={rules[i][key]} aria-label={label} placeholder={hint} maxLength={2000} spellCheck={false} autoCapitalize="off" onChange={(ev) => put(rules.map((r, k) => (k === i ? { ...r, [key]: ev.target.value } : r)), false)} onBlur={soon} />
  );
  return (
    <div className="set">
      <span><small>Your agents wait for your yes before a tool call that matches a rule: a card in the chat, and a notification on devices with notifications on. A rule names tools (<code>*</code> for any characters, <code>!</code> to leave one out; device MCP tools are named <code>device_server__tool</code>) and, if any, a regular expression its arguments must match, in which <code>{SCRATCH}</code> is the device's scratch folder.</small></span>
      {rules.map((_, i) => (
        <div key={i} className="prof">
          <div className="flex gap-2">
            {field(i, "what", "What it is", "What it is, as the card says it")}
            <button type="button" className="pillbtn px-4 text-[0.875rem] text-bad" onClick={() => put(rules.filter((_x, k) => k !== i), true)}>Delete</button>
          </div>
          {field(i, "tools", "Tools", "Tools: shell, *__*send*, !*draft*")}
          {field(i, "args", "Arguments", "Arguments match (empty: any)")}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="pillbtn px-4 text-[0.875rem]" onClick={() => put([...rules, { what: "", tools: "", args: "" }], false)}>Add rule</button>
        {JSON.stringify(rules) === JSON.stringify(s.page?.built) ? null : <button type="button" className="pillbtn px-4 text-[0.875rem]" onClick={() => put((s.page?.built ?? []).map((r) => ({ ...r })), true)}>Restore the defaults</button>}
      </div>
      <Err at="ask" />
    </div>
  );
}

function Secret({ k }: { k: Key }): ReactNode {
  const s = useSet();
  const [name, about] = KEYS[k.name] ?? [k.name, ""];
  return (
    <label className="set">
      <span>{name}<small>{about}</small></span>
      <input className="field" type="password" autoComplete="new-password" placeholder="Paste a new key to set it" spellCheck={false} autoCapitalize="off" value={s.keys[k.name] ?? ""} onChange={(ev) => change({ keys: { ...s.keys, [k.name]: ev.target.value } }, "key." + k.name)} onBlur={soon} />
      <small>{k.from === "file" ? <>Set{k.tail === "" ? "" : <>, ending in <code>{k.tail}</code></>} </> : "Not set"}{k.from === "file" && !s.unset.includes("key." + k.name) ? <Reset keys={["key." + k.name]} text="Remove" /> : null}</small>
      <Err at={"key." + k.name} />
    </label>
  );
}

// the server's settings, each saved as it's changed
export function Owned(): ReactNode {
  const page = useSet((s) => s.page);
  const load = () => void fetch("/api/settings").then((res) => (res.ok ? (res.json() as Promise<Page>) : null), () => null).then((got) => useSet.setState({ page: got, ...CLEAN }));
  useEffect(load, []);
  if (page === undefined) {
    return null;
  }
  if (page === null) {
    return <p className="lede">Could not read the server's settings. <button type="button" className="font-semibold text-act-ink underline" onClick={load}>Try again</button></p>;
  }
  const shown = new Set(page.settings.filter((r) => r.web && r.from !== "env").map((r) => r.key));
  const keys = page.keys.filter((k) => k.from !== "env");
  return (
    <form autoComplete="off" onSubmit={(ev) => { ev.preventDefault(); soon(); }}>
      {page.error === null ? null : <p className="lede text-bad">{page.error}</p>}
      {page.none === null ? null : <p className="lede text-bad">{page.none}.</p>}
      {GROUPS.map(([title, all]) => (all.some((k) => shown.has(k)) ? (
        <Fragment key={title}>
          <h2 className="label">{title}</h2>
          {all.filter((k) => shown.has(k)).map((k) => (k === "vendors" ? <Models key={k} /> : k === "pick" || k === "compactor" ? <Picked key={k} at={k} /> : <Plain key={k} at={k} />))}
        </Fragment>
      ) : null))}
      {page.profiles === null ? null : <><h2 className="label">Profiles</h2><Profiles /></>}
      <h2 className="label">Ask first</h2>
      <Ask />
      {keys.length === 0 ? null : <><h2 className="label">Keys</h2>{keys.map((k) => <Secret key={k.name} k={k} />)}</>}
      <p className="lede pt-6 text-[0.875rem]">Ki version {page.ki}</p>
    </form>
  );
}
