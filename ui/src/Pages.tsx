import { GearSixIcon, HandPalmIcon, PlusIcon, PushPinIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import type { Pin } from "../../Pins.ts";
import type * as View from "../../View.ts";
import { Face } from "./Avatar.tsx";
import { Back } from "./Back.tsx";
import { MOODS, mood_of, show, useKi } from "./Ki.ts";
import { Context, RunList } from "./Panel.tsx";

// an agent as a row: its avatar acts out its mood, the line under its name
// says it, then its last words
function Mate({ m, size }: { m: View.Mate; size: number }): ReactNode {
  const mood = useKi((s) => mood_of(m, s));
  const said = m.last === "" ? m.about : m.last;
  return (
    <Link to="/a/$agent" params={{ agent: m.id }} className="ag">
      <Face picture={m.picture} id={m.id} mood={mood} size={size} />
      <div>
        <b>{m.name}</b>
        <small>{MOODS[mood] === "" ? said : <><i>{MOODS[mood]}</i>{said === "" ? "" : " · " + said}</>}</small>
      </div>
      {mood === "asking"
        ? <HandPalmIcon size={24} weight="fill" className="hand" aria-label="Waits for your answer" />
        : m.unread > 0 ? <span className="badge" aria-label={m.unread + " unread"}>{m.unread}</span> : null}
    </Link>
  );
}

// the home screen: every agent with what it does now, its last words and
// what waits for the owner; on a wide screen, the list beside the open chat
export function Agents({ side = false }: { side?: boolean }): ReactNode {
  const team = useKi((s) => s.team).filter((m) => m.archived === 0);
  return (
    <section className={side ? "list" : "page"}>
      <header className="head">
        <h1>Agents</h1>
        <Link to="/new" className="round gl" aria-label="New agent"><PlusIcon size={22} weight="bold" /></Link>
        <Link to="/settings" className="round gl" aria-label="Ki's settings"><GearSixIcon size={22} /></Link>
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
    show(agent, null, false);
    return () => show(null);
  }, [agent]);
}

// what goes on for one agent without the owner: its subagents, background
// jobs and timers
export function Running({ agent }: { agent: string }): ReactNode {
  const name = useKi((s) => s.team.find((m) => m.id === agent)?.name ?? "");
  useHold(agent);
  return (
    <section className="page">
      <header className="head pl-3.5">
        <Back to={"/a/" + agent} label="Back to the chat" />
        <h1 className="truncate pl-1.5">Running</h1>
      </header>
      {name === "" ? null : <p className="lede -mt-1 pb-1">{name}'s subagents, background jobs and timers.</p>}
      <div className="scroll pb-4"><RunList agent={agent} /></div>
    </section>
  );
}

function pin_note(pin: Pin): string {
  return [pin.until === null ? "lasting" : "until " + pin.until, "used " + pin.used].join(" · ");
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

// what is kept: how full the agent's context is, and the pins every agent
// follows
export function Memory({ agent }: { agent: string }): ReactNode {
  const name = useKi((s) => s.team.find((m) => m.id === agent)?.name ?? "");
  const [pins, setPins] = useState<Pin[] | null | undefined>(undefined);
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
        <p className="lede pb-2 text-[0.875rem]">What your agents learned about you and keep outside the memory's compression, for every agent.</p>
        {pins === undefined ? null
          : pins === null ? <p className="lede">Could not read the pins. <button type="button" className="font-semibold text-act-ink underline" onClick={() => load(null)}>Try again</button></p>
          : pins.length === 0 ? <p className="lede">None yet. An agent pins what you teach it for good, and every agent follows it.</p>
          : pins.map((pin) => (
            <div key={pin.id} className="item">
              <PushPinIcon size={18} />
              <p>{pin.text}<small>{pin_note(pin)}</small></p>
              <button type="button" className="pillbtn min-h-11 px-4 text-[0.875rem]" onClick={() => confirm("Unpin this? Agents stop following it.") && load(pin.id)}>Unpin</button>
            </div>
          ))}
      </div>
    </section>
  );
}
