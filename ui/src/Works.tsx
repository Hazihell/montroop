import { CaretRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { text_of } from "../../Json.ts";
import * as View from "../../View.ts";
import { Face } from "./Avatar.tsx";
import { note, useKi, work_live, work_mood, work_state } from "./Ki.ts";

// an agent's work sessions in its list of what runs: each opens its page,
// one at work stops from here

const NO_WORKS: View.Work[] = [];

export function useWorks(agent: string): View.Work[] {
  return useKi((s) => s.team.find((m) => m.id === agent)?.works ?? NO_WORKS);
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

// how long it has run: till now, or till its latest run ended
export function work_span(w: View.Work, now: number): string {
  const s = Math.max(0, Math.round(((work_live(w) ? now : w.ended ?? now) - w.made) / 1000));
  return s < 60 ? s + "s" : s < 3600 ? Math.floor(s / 60) + "m" : Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
}

// a session's own face, the same in every list it is in
export function WorkFace({ w, size }: { w: View.Work; size: number }): ReactNode {
  return <Face picture="" id={"session/" + w.id} mood={work_mood(w) ?? "idle"} size={size} />;
}

// act: stop, resume, archive, seen; null: done, else why not
export async function work_act(id: string, act: string, body: object = {}): Promise<Record<string, unknown> | null> {
  const out = await View.post("/api/sessions/" + id + "/" + act, body);
  if (out.ok !== true) {
    note(text_of(out.error, "Could not " + act + " the session."));
    return null;
  }
  return out;
}

export function work_stop(w: View.Work): void {
  if (confirm("Stop " + w.name + "? It stops at once; its worktree and branch stay, and a message starts it again.")) {
    void work_act(w.id, "stop");
  }
}

export function WorkRows({ agent }: { agent: string }): ReactNode {
  const works = useWorks(agent);
  const name = useKi((s) => s.team.find((m) => m.id === agent)?.name ?? "");
  const now = useNow(works.some(work_live));
  return works.map((w) => (
    <div key={w.id} className="item work">
      <Link to="/a/$agent/w/$id" params={{ agent, id: w.id }} className="go" aria-label={w.name + ", " + work_state(w, name)}>
        <WorkFace w={w} size={32} />
        <p>
          <b className="font-semibold">{w.name}</b>
          <small><span className={"state " + (w.wait === "" ? w.status : "waiting")}>{work_state(w, name)}</span> · <span className="tabular-nums">{work_span(w, now)}</span></small>
          {w.line === "" ? null : <small className="said">{w.line}</small>}
        </p>
        {work_live(w) ? null : <CaretRightIcon size={16} className="self-center" />}
      </Link>
      {work_live(w) ? <button type="button" className="pillbtn min-h-11 self-center px-4 text-[0.875rem]" onClick={() => work_stop(w)}>Stop</button> : null}
    </div>
  ));
}
