import { AlarmIcon, CaretRightIcon, GearSixIcon, GitBranchIcon, PaintBrushIcon, PlayIcon, TerminalWindowIcon, TreeStructureIcon, BrainIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";
import type { Timer } from "../../Timer.ts";
import { timer_when } from "../../Timer.ts";
import * as View from "../../View.ts";
import { Face } from "./Avatar.tsx";
import { act, MOODS, mood_of, useKi } from "./Ki.ts";

// everything about one agent past its chat: what goes on for it, its memory,
// its settings; a sheet over the chat on a phone, a column beside it on a
// screen wide enough

const NO_JOBS: View.BgJob[] = [];
const NO_TIMERS: Timer[] = [];
const NO_SUBS: NonNullable<View.Mate["subs"]> = [];
// how far a finger drags the sheet down, or how fast, to close it
const DOWN = 96;
const FLING = 0.5;

// the client holds one agent at a time: its jobs, timers and context are
// known only while it is that one
function useHeld(agent: string): boolean {
  return useKi((s) => s.agent === agent && s.loaded);
}

// how many things work for the agent now: its subagents and its background
// jobs; timers wait, so they don't count
export function useGoing(agent: string): number {
  return useKi((s) => (s.team.find((m) => m.id === agent)?.subs?.length ?? 0) + (s.agent === agent ? s.jobs.length : 0));
}

function useContext(agent: string): number | null {
  return useKi((s) => (s.agent === agent && s.talk !== null ? View.talk_percent(s.talk) : null));
}

// the agent's subagents, background jobs and timers
export function RunList({ agent }: { agent: string }): ReactNode {
  const held = useHeld(agent);
  const subs = useKi((s) => s.team.find((m) => m.id === agent)?.subs ?? NO_SUBS);
  const allJobs = useKi((s) => s.jobs);
  const allTimers = useKi((s) => s.timers);
  const jobs = held ? allJobs : NO_JOBS;
  const timers = held ? allTimers : NO_TIMERS;
  if (subs.length + jobs.length + timers.length === 0) {
    return <p className="lede py-2">{held ? "Nothing runs right now. Its subagents, background jobs and timers show here." : "…"}</p>;
  }
  return (
    <div className="pb-2">
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
  const talk = useKi((s) => (s.agent === agent ? s.talk : null));
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

// the agent as the head of its sheet or column: its face, name, mood, about
function Who({ agent, size }: { agent: string; size: number }): ReactNode {
  const mate = useKi((s) => s.team.find((m) => m.id === agent));
  const mood = useKi((s) => (mate === undefined ? "idle" : mood_of(mate, s)));
  return (
    <div className="who">
      <Face picture={mate?.picture ?? ""} id={agent} mood={mood} size={size} />
      <div>
        <h2>{mate?.name ?? ""}</h2>
        <p>{MOODS[mood] === "" ? mate?.about ?? "" : <><i>{MOODS[mood]}</i>{mate?.about ? " · " + mate.about : ""}</>}</p>
      </div>
    </div>
  );
}

// where to go from the agent; in the sheet each place takes the sheet's
// place in the history, so back from it lands on the chat
function Places({ agent, replace, running }: { agent: string; replace: boolean; running: boolean }): ReactNode {
  const going = useGoing(agent);
  const full = useContext(agent);
  const held = useHeld(agent);
  const timers = useKi((s) => (s.agent === agent ? s.timers.length : 0));
  const run = [going > 0 ? going + " at work" : "", timers > 0 ? timers + (timers === 1 ? " timer" : " timers") : ""].filter((x) => x !== "").join(" · ");
  return (
    <nav className="places" aria-label="The agent">
      {running ? (
        <Link to="/a/$agent/running" params={{ agent }} replace={replace} className="item go">
          <PlayIcon size={20} weight={going > 0 ? "fill" : "regular"} />
          <p>Running<small>{held ? (run === "" ? "Nothing right now" : run) : "Subagents, jobs and timers"}</small></p>
          {going > 0 ? <em className="count static">{going}</em> : null}
          <CaretRightIcon size={16} className="self-center" />
        </Link>
      ) : null}
      <Link to="/a/$agent/memory" params={{ agent }} replace={replace} className="item go">
        <BrainIcon size={20} />
        <p>Memory<small>{full === null ? "Context and pins" : full + "% of its context · pins"}</small></p>
        <CaretRightIcon size={16} className="self-center" />
      </Link>
      <Link to="/a/$agent/tree" params={{ agent }} replace={replace} className="item go">
        <TreeStructureIcon size={20} />
        <p>Tree<small>All it remembers, as summaries of summaries</small></p>
        <CaretRightIcon size={16} className="self-center" />
      </Link>
      <Link to="/a/$agent/edit" params={{ agent }} replace={replace} className="item go">
        <GearSixIcon size={20} />
        <p>Agent settings<small>Prompt, account, MCP servers, history</small></p>
        <CaretRightIcon size={16} className="self-center" />
      </Link>
      <Link to="/a/$agent/look" params={{ agent }} replace={replace} className="item go">
        <PaintBrushIcon size={20} />
        <p>Its look<small>Draw its avatar</small></p>
        <CaretRightIcon size={16} className="self-center" />
      </Link>
    </nav>
  );
}

// a phone's sheet over the chat; back, a tap beside it, Escape or a drag
// down close it. Leaving: closed, it slides away and takes nothing more,
// then says it is gone
export function Sheet({ agent, close, leaving, gone }: { agent: string; close: () => void; leaving: boolean; gone: () => void }): ReactNode {
  const box = useRef<HTMLDivElement>(null);
  const dim = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!leaving) {
      return undefined;
    }
    let on = true;
    const moves = [box.current, dim.current].flatMap((el) => el?.getAnimations() ?? []);
    void Promise.allSettled(moves.map((move) => move.finished)).then(() => on && gone());
    return () => {
      on = false;
    };
  }, [leaving, gone]);
  useEffect(() => {
    const el = box.current;
    if (el === null || leaving) {
      return undefined;
    }
    el.style.transform = "";
    el.focus({ preventScroll: true });
    const key = (ev: KeyboardEvent) => ev.key === "Escape" && close();
    const at = { y: -1, t: 0, dy: 0 };
    const start = (ev: TouchEvent) => {
      at.y = el.scrollTop <= 0 && ev.touches.length === 1 ? ev.touches[0]?.clientY ?? -1 : -1;
      at.t = ev.timeStamp;
      at.dy = 0;
    };
    const move = (ev: TouchEvent) => {
      const t = ev.touches[0];
      if (at.y < 0 || t === undefined) {
        return;
      }
      at.dy = Math.max(0, t.clientY - at.y);
      if (at.dy > 0) {
        ev.preventDefault();
        el.classList.add("dragged");
        el.style.transform = "translateY(" + at.dy + "px)";
      }
    };
    const end = (ev: TouchEvent) => {
      if (at.y < 0) {
        return;
      }
      el.classList.remove("dragged");
      const away = at.dy > DOWN || at.dy / Math.max(1, ev.timeStamp - at.t) > FLING;
      el.style.transform = away ? "translateY(110%)" : "";
      if (away) {
        close();
      }
      at.y = -1;
    };
    window.addEventListener("keydown", key);
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      window.removeEventListener("keydown", key);
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [close, leaving]);
  return (
    <>
      <button ref={dim} type="button" className={"dim" + (leaving ? " leaving" : "")} aria-label="Close" inert={leaving} onClick={close} />
      <div ref={box} className={"agsheet" + (leaving ? " leaving" : "")} inert={leaving} role="dialog" aria-modal="true" aria-label="The agent" tabIndex={-1}>
        <i className="grip" aria-hidden />
        <Who agent={agent} size={72} />
        <Places agent={agent} replace running />
      </div>
    </>
  );
}

// a wide screen's column beside the chat: what runs for the agent, open,
// then its other places
export function Panel({ agent }: { agent: string }): ReactNode {
  return (
    <aside className="panel" aria-label="The agent">
      <Who agent={agent} size={64} />
      <Context agent={agent} />
      <h2 className="label pt-3">Running</h2>
      <RunList agent={agent} />
      <Places agent={agent} replace={false} running={false} />
    </aside>
  );
}
