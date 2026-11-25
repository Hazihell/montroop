import { CaretRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { text_of } from "../../Json.ts";
import * as View from "../../View.ts";
import { Face } from "./Avatar.tsx";
import { note, useMontroop, work_mood } from "./Montroop.ts";

// an agent's work sessions and subagents as the app shows them, one kind:
// in its list of what runs (each opens its page, one at work stops from
// there), and what they do

const NO_WORKS: View.SessionRow[] = [];

export function useWorks(agent: string): View.SessionRow[] {
  return useMontroop((s) => s.team.find((m) => m.id === agent)?.works ?? NO_WORKS);
}

export function work_live(w: View.SessionRow): boolean {
  return w.status === "running" || w.status === "waiting";
}

// what a session's face is drawn from: the same face wherever it shows
export function work_seed(w: View.SessionRow): string {
  return "session/" + w.id;
}

// the time now, again each second while on
export function useNow(on: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!on) {
      return undefined;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [on]);
  return now;
}

// how long its latest run has run: till now, or till it ended
export function work_span(w: View.SessionRow, now: number): string {
  const s = Math.max(0, Math.round(((w.ended ?? now) - w.started) / 1000));
  return s < 60 ? s + "s" : s < 3600 ? Math.floor(s / 60) + "m" : Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
}

export function WorkFace({ w, size }: { w: View.SessionRow; size: number }): ReactNode {
  return <Face picture="" id={work_seed(w)} mood={work_mood(w) ?? "idle"} size={size} />;
}

export const STATES: Record<View.SessionRow["status"], string> = { running: "Running", waiting: "Waiting", done: "Done", failed: "Failed", stopped: "Stopped" };

// what it does, in words, tinted by it; agent: its agent's name, whom its
// question waits on
export function WorkState({ w, agent, now }: { w: View.SessionRow; agent: string; now: number }): ReactNode {
  const said = w.waits === "approval" ? "Needs your approval"
    : w.waits === "answer" ? "Asks " + (agent || "its mon")
    : w.waits === "limit" ? "Usage limit · " + (w.until === null || w.until <= now ? "trying again" : "resets " + View.clock(w.until, now))
    : STATES[w.status];
  return <span className={"state " + (w.waits === null ? w.status : "waiting")}>{said}</span>;
}

// how full its context was at its latest request, as a small bar
function WorkMeter({ m }: { m: View.Meter }): ReactNode {
  const full = Math.ceil((m.tokens * 100) / m.window);
  return (
    <span className="gauge" role="meter" aria-label="Context used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={full}>
      <i><b style={{ width: Math.min(100, full) + "%" }} /></i>{full}%
    </span>
  );
}

// how it runs: its model and effort, and how full its context is; long:
// the tokens too, in words
export function WorkHow({ w, long = false }: { w: View.SessionRow; long?: boolean }): ReactNode {
  const how = [w.model, w.effort].filter((x) => x !== "").join(" · ");
  if (how === "" && w.meter === null) {
    return null;
  }
  return (
    <small className="how">
      {how === "" ? null : <span>{how}</span>}
      {w.meter === null ? null : <WorkMeter m={w.meter} />}
      {long && w.meter !== null ? <span>{View.tokens_said(w.meter.tokens) + " of " + View.tokens_said(w.meter.window) + " tokens"}</span> : null}
    </small>
  );
}

// the server's answer, or null when it refused (said in a note)
export async function work_act(id: string, act: "say" | "stop" | "resume" | "archive", body: object = {}): Promise<Record<string, unknown> | null> {
  const out = await View.post("/api/sessions/" + id + "/" + act, body);
  if (out.ok !== true) {
    note(text_of(out.error, "Could not " + act + " the submon."));
    return null;
  }
  return out;
}

export function work_stop(w: View.SessionRow): void {
  if (confirm("Stop " + w.name + "? It stops at once; its worktree and branch stay, and a message starts it again.")) {
    void work_act(w.id, "stop");
  }
}

export function WorkRows({ agent }: { agent: string }): ReactNode {
  const works = useWorks(agent);
  const name = useMontroop((s) => s.team.find((m) => m.id === agent)?.name ?? "");
  const now = useNow(works.some(work_live));
  return works.map((w) => (
    <div key={w.id} className="item work">
      <Link to="/a/$agent/w/$id" params={{ agent, id: w.id }} className="go">
        <WorkFace w={w} size={32} />
        <p>
          <b className="font-semibold">{w.name}</b>
          <small><WorkState w={w} agent={name} now={now} /> · <span className="tabular-nums">{work_span(w, now)}</span></small>
          {w.task === "" ? null : <small className="task">{w.task}</small>}
          {w.last === "" ? null : <small className="said">{w.last}</small>}
          <WorkHow w={w} />
        </p>
        {work_live(w) ? null : <CaretRightIcon size={16} className="self-center" />}
      </Link>
      {work_live(w) ? <button type="button" className="pillbtn min-h-11 self-center px-4 text-[0.875rem]" aria-label={"Stop " + w.name} onClick={() => work_stop(w)}>Stop</button> : null}
    </div>
  ));
}
