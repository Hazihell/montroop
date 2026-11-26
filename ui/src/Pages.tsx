import { GearSixIcon, HandPalmIcon, PlusIcon, PushPinIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Pin } from "../../Pins.ts";
import type * as View from "../../View.ts";
import { Face } from "./Avatar.tsx";
import { Back } from "./Back.tsx";
import { MOODS, mood_of, show, useMontroop, work_mood, works_said } from "./Montroop.ts";
import { Minis, type Mini } from "./Minis.tsx";
import { work_seed } from "./Works.tsx";
import { Context, RunList } from "./Panel.tsx";

// what is shown stays drawn, leaving, after it closes, until it says it
// is gone
export function useLeaving(on: boolean): ["on" | "leaving" | false, () => void] {
  const [kept, setKept] = useState(on);
  if (on && !kept) {
    setKept(true);
  }
  const gone = useCallback(() => setKept(false), []);
  return [on ? "on" : kept ? "leaving" : false, gone];
}

// " pop" once a count changed since it was first drawn, so its badge, keyed
// by the count, pops in at each change in sight: not as a page first draws
// it, nor as the same badge starts counting another agent's (of: whose)
export function usePop(n: number, of = ""): string {
  const [last, setLast] = useState({ n, of, changed: false });
  if (last.of !== of || last.n !== n) {
    setLast({ n, of, changed: last.of === of });
  }
  return last.changed ? " pop" : "";
}

// an agent's subagents that matter now, as small faces of their own
function minis_of(works: View.SessionRow[]): Mini[] {
  return works.flatMap((w) => {
    const mood = work_mood(w);
    return mood === null ? [] : [{ key: w.id, seed: work_seed(w), mood }];
  });
}

// an agent as a row: its avatar acts out its mood, which only a screen
// reader hears said, and the line under its name holds its last words;
// beside its name, its subagents'
function Mate({ m, size }: { m: View.Mate; size: number }): ReactNode {
  const mood = useMontroop((s) => mood_of(m, s));
  const said = m.last === "" ? m.about : m.last;
  const pop = usePop(m.unread);
  const works = m.works ?? [];
  return (
    <Link to="/a/$agent" params={{ agent: m.id }} className="ag">
      <Face picture={m.picture} id={m.id} mood={mood} size={size} />
      <div>
        <p className="named"><b>{m.name}</b><Minis items={minis_of(works)} label={works_said(works)} /></p>
        <small>{MOODS[mood] === "" ? null : <span className="sr-only">{MOODS[mood] + ". "}</span>}{said}</small>
      </div>
      {mood === "asking"
        ? <HandPalmIcon size={24} weight="fill" className="hand" aria-label="Waits for your answer" />
        : m.unread > 0 ? <span key={m.unread} className={"badge" + pop} aria-label={m.unread + " unread"}>{m.unread}</span> : null}
    </Link>
  );
}

// the home screen: every agent with what it does now, its last words and
// what waits for the owner; on a wide screen, the list beside the open chat
export function Agents({ side = false }: { side?: boolean }): ReactNode {
  const team = useMontroop((s) => s.team).filter((m) => m.archived === 0);
  return (
    <section className={side ? "list" : "page"}>
      <header className="head">
        <h1>Mons</h1>
        <Link to="/new" className="round gl" aria-label="New mon"><PlusIcon size={22} weight="bold" /></Link>
        <Link to="/settings" className="round gl" aria-label="Montroop's settings"><GearSixIcon size={22} /></Link>
      </header>
      <div className="scroll px-1.5 pb-4">
        {team.map((m) => <Mate key={m.id} m={m} size={side ? 56 : 68} />)}
      </div>
    </section>
  );
}

// hold the agent for one of its pages, without its chat counted read
function useHold(agent: string): void {
  useEffect(() => {
    show(agent, false);
    return () => show(null);
  }, [agent]);
}

// what goes on for one agent without the owner: its subagents, background
// jobs and timers
export function Running({ agent }: { agent: string }): ReactNode {
  const name = useMontroop((s) => s.team.find((m) => m.id === agent)?.name ?? "");
  useHold(agent);
  return (
    <section className="page">
      <header className="head pl-3.5">
        <Back to={"/a/" + agent} label="Back to the chat" />
        <h1 className="truncate pl-1.5">Running</h1>
      </header>
      {name === "" ? null : <p className="lede -mt-1 pb-1">{name}'s submons, background jobs and timers.</p>}
      <div className="scroll pb-4"><RunList agent={agent} /></div>
    </section>
  );
}

// a pin's line under its text: who it holds for, how long, when last used
function pin_note(pin: Pin, names: Map<string, string>): ReactNode {
  const scope = pin.mons === null ? "Shared" : pin.mons.map((id) => names.get(id) ?? id).join(", ");
  return <small>{scope} · <span className="whitespace-nowrap">{pin.until === null ? "lasting" : "until " + pin.until}</span> · <span className="whitespace-nowrap">used {pin.used}</span></small>;
}

// the memory's three views; each takes the last one's place in the history,
// so back leaves the memory at once
export function Tabs({ agent }: { agent: string }): ReactNode {
  return (
    <nav className="seg gl mx-3.5 mb-2 max-w-sm" aria-label="Memory">
      <Link to="/a/$agent/memory" params={{ agent }} replace>Pins</Link>
      <Link to="/a/$agent/tree" params={{ agent }} hash="view" replace activeOptions={{ includeHash: true }}>View</Link>
      <Link to="/a/$agent/tree" params={{ agent }} replace activeOptions={{ includeHash: true }}>Tree</Link>
    </nav>
  );
}

// what is kept: how full the agent's context is, and the pins, each
// shared or held for some agents, shown all or one scope's (filter: null
// for all, "" for the shared ones, else an agent's id)
export function Memory({ agent }: { agent: string }): ReactNode {
  const team = useMontroop((s) => s.team);
  const name = team.find((m) => m.id === agent)?.name ?? "";
  const [pins, setPins] = useState<Pin[] | null | undefined>(undefined);
  const [filter, setFilter] = useState<string | null>(null);
  const names = new Map(team.map((m) => [m.id, m.name]));
  const all = pins ?? [];
  const scopes: [string | null, string][] = [
    [null, "All"],
    ...(all.some((p) => p.mons === null) ? [["", "Shared"] as [string, string]] : []),
    ...team.filter((m) => all.some((p) => p.mons?.includes(m.id) === true)).map((m): [string, string] => [m.id, m.name]),
  ];
  const on = scopes.some(([key]) => key === filter) ? filter : null;
  const shown = all.filter((p) => on === null || (on === "" ? p.mons === null : p.mons?.includes(on) === true));
  useHold(agent);
  const load = (unpin: number | null) => {
    const init = unpin === null ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ unpin }) };
    void fetch("/api/pins", init).then((res) => (res.ok ? (res.json() as Promise<Pin[]>) : null), () => null).then(setPins);
  };
  useEffect(() => load(null), []);
  return (
    <section className="page">
      <header className="head pl-3.5">
        <Back to={"/a/" + agent} label="Back to the chat" />
        <h1 className="truncate pl-1.5">{name === "" ? "Memory" : name + "'s memory"}</h1>
      </header>
      <Tabs agent={agent} />
      <div className="scroll pb-4">
        <Context agent={agent} label />
        <h2 className="label">Pins</h2>
        <p className="lede pb-2 text-[0.875rem]">What your mons learned about you and keep outside the memory's compression, shared with every mon or held for a few.</p>
        {scopes.length < 3 ? null : (
          <div className="flex gap-1.5 overflow-x-auto px-3.5 pb-2 [scrollbar-width:none]" role="group" aria-label="Show the pins of">
            {scopes.map(([key, text]) => <button key={key ?? "all"} type="button" className={"pillbtn min-h-11 shrink-0 px-4 text-[0.875rem]" + (key === on ? " go" : "")} aria-pressed={key === on} onClick={() => setFilter(key)}>{text}</button>)}
          </div>
        )}
        {pins === undefined ? null
          : pins === null ? <p className="lede">Could not read the pins. <button type="button" className="font-semibold text-act-ink underline" onClick={() => load(null)}>Try again</button></p>
          : pins.length === 0 ? <p className="lede">None yet. A mon pins what you teach it for good, for every mon or only the ones it fits.</p>
          : shown.map((pin) => (
            <div key={pin.id} className="item">
              <PushPinIcon size={18} />
              <p>{pin.text}{pin_note(pin, names)}</p>
              <button type="button" className="pillbtn min-h-11 px-4 text-[0.875rem]" onClick={() => confirm("Unpin this? Mons stop following it.") && load(pin.id)}>Unpin</button>
            </div>
          ))}
      </div>
    </section>
  );
}
