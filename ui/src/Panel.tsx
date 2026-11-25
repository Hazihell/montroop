import { AlarmIcon, CaretRightIcon, GearSixIcon, GitBranchIcon, PaintBrushIcon, PlayIcon, TerminalWindowIcon, TreeStructureIcon, BrainIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";
import type { Timer } from "../../Timer.ts";
import { timer_when } from "../../Timer.ts";
import * as View from "../../View.ts";
import { act, MOODS, mood_of, useKunumy } from "./Kunumy.ts";
import { useWorks, work_live, WorkRows } from "./Works.tsx";

// everything about one agent past its chat: what goes on for it, its memory,
// its settings; a menu dropped from its face on a phone, a column beside the
// chat on a screen wide enough

const NO_JOBS: View.BgJob[] = [];
const NO_TIMERS: Timer[] = [];
const NO_SUBS: NonNullable<View.Mate["subs"]> = [];

// the client holds one agent at a time: its jobs, timers and context are
// known only while it is that one
function useHeld(agent: string): boolean {
  return useKunumy((s) => s.agent === agent && s.loaded);
}

// how many things work for the agent now: its subagents, its work
// sessions at work and its background jobs; timers wait, so they don't count
export function useGoing(agent: string): number {
  return useKunumy((s) => {
    const mate = s.team.find((m) => m.id === agent);
    return (mate?.subs?.length ?? 0) + (mate?.works?.filter(work_live).length ?? 0) + (s.agent === agent ? s.jobs.length : 0);
  });
}

function useContext(agent: string): number | null {
  return useKunumy((s) => (s.agent === agent && s.talk !== null ? View.talk_percent(s.talk) : null));
}

// the agent's work sessions, subagents, background jobs and timers
export function RunList({ agent }: { agent: string }): ReactNode {
  const held = useHeld(agent);
  const works = useWorks(agent);
  const subs = useKunumy((s) => s.team.find((m) => m.id === agent)?.subs ?? NO_SUBS);
  const allJobs = useKunumy((s) => s.jobs);
  const allTimers = useKunumy((s) => s.timers);
  const jobs = held ? allJobs : NO_JOBS;
  const timers = held ? allTimers : NO_TIMERS;
  if (works.length + subs.length + jobs.length + timers.length === 0) {
    return <p className="lede py-2">{held ? "Nothing runs right now. Its work sessions, subagents, background jobs and timers show here." : "…"}</p>;
  }
  return (
    <div className="pb-2">
      <WorkRows agent={agent} />
      {subs.map((sub) => (
        <Link key={sub.name} to="/a/$agent/s/$name" params={{ agent, name: sub.name }} className="item go">
          <GitBranchIcon size={18} />
          <p><b className="font-semibold">{sub.name}</b><small>{[sub.model, sub.effort, sub.doing === "" ? sub.task : sub.doing].filter((x) => x !== "").join(" · ")}</small></p>
          <CaretRightIcon size={16} className="self-center" />
        </Link>
      ))}
      {jobs.map((job) => (
        <div key={job.device + job.id} className="item">
          <TerminalWindowIcon size={18} />
          <p>Job <span className="font-mono text-[0.84em]">{job.id}</span><small>on {job.device}</small></p>
        </div>
      ))}
      {timers.map((timer) => (
        <div key={timer.id} className="item">
          <AlarmIcon size={18} />
          <p><span className="line-clamp-2">{timer.text}</span><small>{timer_when(timer)}</small></p>
          <button type="button" className="pillbtn min-h-11 px-4 text-[0.875rem]" onClick={() => confirm("Cancel this timer?") && act({ $: "Unschedule", id: timer.id })}>Cancel</button>
        </div>
      ))}
    </div>
  );
}

// how full the agent's context is
export function Context({ agent, label = false }: { agent: string; label?: boolean }): ReactNode {
  const talk = useKunumy((s) => (s.agent === agent ? s.talk : null));
  if (talk === null) {
    return null;
  }
  const full = View.talk_percent(talk);
  return (
    <>
      {label ? <h2 className="label pt-2">Context</h2> : null}
      <div className="px-5.5 pt-1 pb-2">
        <p><b className="font-display text-3xl font-extrabold tracking-tight tabular-nums">{full}%</b> <span className="text-mid">of its context</span></p>
        <div className="my-2 h-2 overflow-hidden rounded-full bg-raise" role="meter" aria-label="Context used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={full}>
          <div className="h-full rounded-full bg-act" style={{ width: Math.min(100, full) + "%" }} />
        </div>
        <p className="text-[0.875rem] text-mid">{View.talk_tokens(talk)}</p>
      </div>
    </>
  );
}

// the agent as the head of its column, in words: the chat's header beside
// it already shows its face
function Who({ agent }: { agent: string }): ReactNode {
  const mate = useKunumy((s) => s.team.find((m) => m.id === agent));
  const mood = useKunumy((s) => (mate === undefined ? "idle" : mood_of(mate, s)));
  return (
    <header className="mast">
      <h2>{mate?.name ?? ""}</h2>
      <p>{MOODS[mood] === "" ? mate?.about ?? "" : <><i>{MOODS[mood]}</i>{mate?.about ? " · " + mate.about : ""}</>}</p>
    </header>
  );
}

// where to go from the agent, past what runs for it, which the column shows
function Places({ agent }: { agent: string }): ReactNode {
  const full = useContext(agent);
  return (
    <nav className="places" aria-label="The agent">
      <Link to="/a/$agent/memory" params={{ agent }} className="item go">
        <BrainIcon size={20} />
        <p>Memory<small>{full === null ? "Context and pins" : full + "% of its context · pins"}</small></p>
        <CaretRightIcon size={16} className="self-center" />
      </Link>
      <Link to="/a/$agent/tree" params={{ agent }} className="item go">
        <TreeStructureIcon size={20} />
        <p>Tree<small>All it remembers, as summaries of summaries</small></p>
        <CaretRightIcon size={16} className="self-center" />
      </Link>
      <Link to="/a/$agent/edit" params={{ agent }} className="item go">
        <GearSixIcon size={20} />
        <p>Agent settings<small>Prompt, account, MCP servers, history</small></p>
        <CaretRightIcon size={16} className="self-center" />
      </Link>
      <Link to="/a/$agent/look" params={{ agent }} className="item go">
        <PaintBrushIcon size={20} />
        <p>Its look<small>Draw its avatar</small></p>
        <CaretRightIcon size={16} className="self-center" />
      </Link>
    </nav>
  );
}

// a phone's menu of the agent's places, dropped from its face over the chat.
// Each place takes the menu's step in the history, so back from it lands on
// the chat. Leaving: it takes nothing more, and says when it is gone
export function Menu({ agent, face, close, leaving, gone }: { agent: string; face: HTMLElement | null; close: () => void; leaving: boolean; gone: () => void }): ReactNode {
  const box = useRef<HTMLDivElement>(null);
  const mate = useKunumy((s) => s.team.find((m) => m.id === agent));
  const mood = useKunumy((s) => (mate === undefined ? "idle" : mood_of(mate, s)));
  const going = useGoing(agent);
  const full = useContext(agent);
  const state = useKunumy((s) => (s.offline ? "Offline" : MOODS[mood]));
  useEffect(() => {
    if (!leaving) {
      return undefined;
    }
    face?.focus({ preventScroll: true });
    let on = true;
    void Promise.allSettled((box.current?.getAnimations() ?? []).map((move) => move.finished)).then(() => on && gone());
    return () => {
      on = false;
    };
  }, [leaving, gone, face]);
  useEffect(() => {
    const el = box.current;
    if (el === null || leaving) {
      return undefined;
    }
    const items = () => [...el.querySelectorAll<HTMLElement>("[role=menuitem]")];
    items()[0]?.focus({ preventScroll: true });
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" || ev.key === "Tab") {
        ev.preventDefault();
        close();
        return;
      }
      const all = items();
      const at = all.indexOf(document.activeElement as HTMLElement);
      const from = at < 0 && ev.key === "ArrowUp" ? all.length : at;
      const to = { ArrowDown: from + 1, ArrowUp: from - 1, Home: 0, End: all.length - 1 }[ev.key];
      if (to !== undefined) {
        ev.preventDefault();
        all[(to + all.length) % all.length]?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [close, leaving]);
  return (
    <>
      <button type="button" className="veil" tabIndex={-1} aria-hidden inert={leaving} onClick={close} />
      <div ref={box} className={"menu" + (leaving ? " leaving" : "")} inert={leaving}>
        <p>{mate?.name ?? ""}{state === "" ? null : <i>{state}</i>}</p>
        <div role="menu" aria-label={mate?.name ?? "The agent"}>
          <Link role="menuitem" to="/a/$agent/running" params={{ agent }} replace>
            <PlayIcon size={20} weight={going > 0 ? "fill" : "regular"} />Running
            {going > 0 ? <em className="count static">{going}</em> : null}
          </Link>
          <Link role="menuitem" to="/a/$agent/memory" params={{ agent }} replace>
            <BrainIcon size={20} />Memory
            {full === null ? null : <small>{full}%</small>}
          </Link>
          <Link role="menuitem" to="/a/$agent/tree" params={{ agent }} replace>
            <TreeStructureIcon size={20} />Tree
          </Link>
          <hr />
          <Link role="menuitem" to="/a/$agent/edit" params={{ agent }} replace>
            <GearSixIcon size={20} />Agent settings
          </Link>
          <Link role="menuitem" to="/a/$agent/look" params={{ agent }} replace>
            <PaintBrushIcon size={20} />Its look
          </Link>
        </div>
      </div>
    </>
  );
}

// a wide screen's column beside the chat: what runs for the agent, open,
// then its other places
export function Panel({ agent }: { agent: string }): ReactNode {
  return (
    <aside className="panel" aria-label="The agent">
      <Who agent={agent} />
      <Context agent={agent} />
      <h2 className="label pt-3">Running</h2>
      <RunList agent={agent} />
      <Places agent={agent} />
    </aside>
  );
}
