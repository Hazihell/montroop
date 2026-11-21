import { AlarmIcon, CaretLeftIcon, GitBranchIcon, HandPalmIcon, PlusIcon, PushPinIcon, SlidersHorizontalIcon, TerminalWindowIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { err_why } from "../../Err.ts";
import { text_of } from "../../Json.ts";
import type { Pin } from "../../Pins.ts";
import { timer_when } from "../../Timer.ts";
import * as View from "../../View.ts";
import { Archived } from "./Agent.tsx";
import { Face } from "./Avatar.tsx";
import { act, MOODS, mood_of, note, signed_out, useKi } from "./Ki.ts";
import { Owned } from "./Owned.tsx";
import { ACCENTS, prefs_set, usePrefs, type Theme } from "./Prefs.ts";
import { push_state, push_sub, push_turn, type Bell, type Notify } from "./Push.ts";

type Swatch = CSSProperties & { "--s": string };

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

export function Team(): ReactNode {
  const team = useKi((s) => s.team);
  return (
    <section className="page">
      <header className="head">
        <h1>Team</h1>
        <span className="flex gap-2">
          <Link to="/new" className="round gl" aria-label="New agent"><PlusIcon size={22} weight="bold" /></Link>
          <Link to="/settings" className="round gl" aria-label="Settings"><SlidersHorizontalIcon size={22} weight="bold" /></Link>
        </span>
      </header>
      <div className="scroll px-1.5 pb-4">
        {team.filter((m) => m.archived === 0).map((m) => <Mate key={m.id} m={m} size={68} />)}
      </div>
    </section>
  );
}

// what goes on without the owner: the agents at work with their subagents,
// then the jobs and timers of the chat last open
export function Running(): ReactNode {
  const team = useKi((s) => s.team);
  const name = useKi((s) => s.team.find((m) => m.id === s.agent)?.name ?? "");
  const jobs = useKi((s) => s.jobs);
  const timers = useKi((s) => s.timers);
  const going = team.filter((m) => m.archived === 0 && (m.busy || (m.asks ?? 0) > 0 || (m.subs ?? []).length > 0));
  return (
    <section className="page">
      <header className="head"><h1>Running</h1></header>
      <div className="scroll pb-4">
        {going.length + jobs.length + timers.length === 0 ? <p className="lede">Nothing runs right now. Agents at work, their subagents, background jobs and timers show here.</p> : null}
        {going.map((m) => (
          <div key={m.id} className="px-1.5">
            <Mate m={m} size={56} />
            {(m.subs ?? []).map((sub) => (
              <Link key={sub.name} to="/a/$agent/s/$name" params={{ agent: m.id, name: sub.name }} className="item pl-6">
                <GitBranchIcon size={18} />
                <p><b className="font-semibold">{sub.name}</b><small>{[sub.model, sub.effort, sub.doing === "" ? sub.task : sub.doing].filter((x) => x !== "").join(" · ")}</small></p>
              </Link>
            ))}
          </div>
        ))}
        {jobs.length === 0 ? null : <h2 className="label">{name === "" ? "Background jobs" : name + "'s background jobs"}</h2>}
        {jobs.map((job) => (
          <div key={job.device + job.id} className="item">
            <TerminalWindowIcon size={18} />
            <p>Job <span className="font-mono text-[0.84em]">{job.id}</span><small>on {job.device}</small></p>
          </div>
        ))}
        {timers.length === 0 ? null : <h2 className="label">{name === "" ? "Timers" : name + "'s timers"}</h2>}
        {timers.map((timer) => (
          <div key={timer.id} className="item">
            <AlarmIcon size={18} />
            <p><span className="line-clamp-2">{timer.text}</span><small>{timer_when(timer)}</small></p>
            <button type="button" className="pillbtn min-h-11 px-4 text-[0.875rem]" onClick={() => confirm("Cancel this timer?") && act({ $: "Unschedule", id: timer.id })}>Cancel</button>
          </div>
        ))}
      </div>
    </section>
  );
}

function pin_note(pin: Pin): string {
  return [pin.until === null ? "lasting" : "until " + pin.until, "used " + pin.used].join(" · ");
}

// what is kept: how full the open chat's context is, and the pins every
// agent follows
export function Memory(): ReactNode {
  const name = useKi((s) => s.team.find((m) => m.id === s.agent)?.name ?? "");
  const talk = useKi((s) => s.talk);
  const [pins, setPins] = useState<Pin[] | null | undefined>(undefined);
  const load = (unpin: number | null) => {
    const init = unpin === null ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ unpin }) };
    void fetch("/api/pins", init).then((res) => (res.ok ? (res.json() as Promise<Pin[]>) : null), () => null).then(setPins);
  };
  useEffect(() => load(null), []);
  return (
    <section className="page">
      <header className="head"><h1>Memory</h1></header>
      <div className="scroll pb-4">
        {talk === null ? null : (
          <>
            <h2 className="label pt-2">{name === "" ? "Context" : name + "'s context"}</h2>
            <div className="px-5.5">
              <p><b className="font-display text-3xl font-extrabold tracking-tight tabular-nums">{View.talk_percent(talk)}%</b> <span className="text-mid">full</span></p>
              <div className="my-2 h-2 overflow-hidden rounded-full bg-raise" role="meter" aria-label="Context used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={View.talk_percent(talk)}>
                <div className="h-full rounded-full bg-act" style={{ width: Math.min(100, View.talk_percent(talk)) + "%" }} />
              </div>
              <p className="text-[0.875rem] text-mid">{View.talk_tokens(talk)}</p>
            </div>
          </>
        )}
        <h2 className="label">Pins</h2>
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

const THEMES: Array<[Theme, string]> = [["system", "Auto"], ["dark", "Dark"], ["light", "Light"]];

const BELL: Record<Notify, string> = {
  off     : "Replies on this device, when Ki isn't open.",
  on      : "Replies on this device, when Ki isn't open.",
  blocked : "Blocked in this browser's settings for this site.",
  home    : "On iPhone and iPad: Share, then Add to Home Screen, and open it from there.",
};

// this device's notifications, turned on and off here
function Bell(): ReactNode {
  const [bell, setBell] = useState<Bell | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void push_state().catch(() => null).then(setBell);
  }, []);
  if (bell === null) {
    return null;
  }
  const push = bell.push;
  const turn = () => {
    if (push === null) {
      return;
    }
    const what = bell.state === "on" ? "off" : "on";
    setBusy(true);
    void push_turn(what === "on", push).then((out) => note(out.error === undefined ? "Notifications are " + what + "." : "Could not turn notifications " + what + ": " + text_of(out.error)), (err: unknown) => note("Could not turn notifications " + what + ": " + err_why(err))).then(push_state).catch(() => null).then((next) => {
      setBell(next);
      setBusy(false);
    });
  };
  return (
    <label className="set">
      <span>Notifications<small>{BELL[bell.state]}</small></span>
      {bell.state === "home" ? null : <input type="checkbox" role="switch" className="switch" checked={bell.state === "on"} disabled={busy || bell.state === "blocked"} onChange={turn} />}
    </label>
  );
}

// the MCP servers of the devices, on or off for the chat last open
function Plugs(): ReactNode {
  const plugs = useKi((s) => s.plugs);
  const name = useKi((s) => s.team.find((m) => m.id === s.agent)?.name ?? "");
  return (
    <>
      <h2 className="label">{name === "" ? "MCP servers" : "MCP servers for " + name}</h2>
      {plugs.length === 0 ? <p className="lede">None set up. Add them as <code className="font-mono text-[0.84em]">mcp</code> in a device's own config.json: they run on that device.</p> : plugs.map((p) => (
        <label key={p.name} className="set">
          <span>{p.name}</span>
          <input type="checkbox" role="switch" className="switch" checked={p.on} onChange={() => act({ $: "Plug", name: p.name })} />
        </label>
      ))}
    </>
  );
}

export function Settings(): ReactNode {
  const accent = usePrefs((s) => s.accent);
  const theme = usePrefs((s) => s.theme);
  const out = async () => {
    await push_sub().then((sub) => sub?.unsubscribe()).catch(() => {});
    await View.post("/api/logout", {});
    signed_out();
  };
  return (
    <section className="page">
      <header className="head pl-3.5">
        <Link to="/team" className="round gl" aria-label="Back to the team"><CaretLeftIcon size={22} weight="bold" /></Link>
        <h1 className="pl-1.5">Settings</h1>
      </header>
      <div className="scroll pb-6">
        <div className="mx-auto max-w-xl">
          <h2 className="label pt-2">Accent</h2>
          <div className="swatches px-4">
            {ACCENTS.map((hex) => (
              <button key={hex} type="button" aria-label={"Accent #" + hex} aria-pressed={hex === accent} onClick={() => prefs_set({ accent: hex })}><i style={{ "--s": "#" + hex } as Swatch} /></button>
            ))}
            <label aria-label="Another color" aria-pressed={!ACCENTS.includes(accent)}>
              <i style={{ "--s": ACCENTS.includes(accent) ? "conic-gradient(#f55,#fc3,#5d5,#3cf,#75f,#f5a,#f55)" : "#" + accent } as Swatch} />
              <input type="color" className="sr-only" value={"#" + accent} onChange={(ev) => prefs_set({ accent: ev.target.value.slice(1).toLowerCase() })} />
            </label>
          </div>
          <h2 className="label">Appearance</h2>
          <div className="seg gl mx-3.5 max-w-sm">
            {THEMES.map(([value, text]) => <button key={value} type="button" aria-pressed={value === theme} onClick={() => prefs_set({ theme: value })}>{text}</button>)}
          </div>
          <h2 className="label">This device</h2>
          <Bell />
          <div className="px-3.5 pt-4"><button type="button" className="pillbtn" onClick={() => void out()}>Sign out</button></div>
          <Plugs />
          <Archived />
          <Owned />
        </div>
      </div>
    </section>
  );
}
