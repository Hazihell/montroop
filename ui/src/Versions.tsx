import { CaretRightIcon, ClockCounterClockwiseIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Diff } from "../../Diff.ts";
import { text_of } from "../../Json.ts";
import type { Version } from "../../Team.ts";
import * as View from "../../View.ts";
import { note } from "./Ki.ts";

type Got = { prompt: string; versions: Version[] };

const FIRST = 3;

// each kind of line's class and what a screen reader says for its sign
const OPS: Record<"-" | "+" | " ", [string | undefined, string | undefined]> = { "-": ["del", "taken out"], "+": ["add", "brought back"], " ": [undefined, undefined] };

async function versions_read(agent: string): Promise<Got | null> {
  const res = await fetch("/api/agents/" + agent + "/prompts").catch(() => null);
  return res?.ok === true ? ((await res.json().catch(() => null)) as Got | null) : null;
}

// its first line the prompt now lacks, else its first
function preview(v: Version, now: Set<string>): string {
  const lines = v.prompt.split("\n").filter((l) => l.trim() !== "");
  return lines.find((l) => !now.has(l)) ?? lines[0] ?? "";
}

function by(v: Version): string {
  return "Replaced by " + (v.who ?? "you") + ", " + View.clock(v.at);
}

// a version beside the prompt now: what a revert takes out, what it brings back
function Opened({ agent, v, now, shut, reverted }: { agent: string; v: Version; now: string; shut: () => void; reverted: () => void }): ReactNode {
  const box = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const hunks = Diff.hunks(now, v.prompt);
  useEffect(() => box.current?.showModal(), []);
  const revert = () => {
    setBusy(true);
    void View.post("/api/agents/" + agent + "/prompts", { id: v.id }).then((out) => {
      setBusy(false);
      if (out.error !== undefined) {
        return note(text_of(out.error));
      }
      note("The prompt is back as it was before " + View.clock(v.at) + ".");
      reverted();
      box.current?.close();
    });
  };
  return (
    <dialog ref={box} className="import gl" aria-label="An earlier system prompt" onClose={shut}>
      <section>
        <h2>Earlier prompt</h2>
        <p className="sub">{by(v)}. {hunks.length === 0 ? "It is the same as the prompt now." : "Reverting takes out the red lines and brings back the green ones."}</p>
        {hunks.length === 0 ? null : (
          <div className="diff">
            {hunks.map((h) => (
              <div key={h.old_line + "." + h.new_line}>
                <p className="at">Line {h.old_line}</p>
                {h.lines.map((l, k) => <p key={k} className={OPS[l.op][0]}><i aria-label={OPS[l.op][1]}>{l.op}</i>{l.text}</p>)}
              </div>
            ))}
          </div>
        )}
        <div className="acts">
          <button type="button" className="pillbtn" onClick={() => box.current?.close()}>Close</button>
          {hunks.length === 0 ? null : <button type="button" className="pillbtn go" disabled={busy} onClick={revert}>{busy ? "Reverting…" : "Revert"}</button>}
        </div>
      </section>
    </dialog>
  );
}

// the system prompts an agent had, newest first, each kept when it was
// changed; read again when saved changes, and when one opens
export function Versions({ agent, saved, reverted }: { agent: string; saved: number; reverted: (prompt: string) => void }): ReactNode {
  const [got, setGot] = useState<Got | null | undefined>(undefined);
  const [open, setOpen] = useState<Version | null>(null);
  const [all, setAll] = useState(false);
  const [read, setRead] = useState(0);
  useEffect(() => {
    void versions_read(agent).then(setGot);
  }, [agent, saved, read]);
  const shown = got == null ? [] : all ? got.versions : got.versions.slice(0, FIRST);
  const now = new Set(got?.prompt.split("\n"));
  return (
    <>
      <h2 className="label">Prompt history</h2>
      {got === undefined ? null
        : got === null ? <p className="lede">Could not read it. <button type="button" className="font-semibold text-act-ink underline" onClick={() => setRead(read + 1)}>Try again</button></p>
        : got.versions.length === 0 ? <p className="lede">No earlier prompts yet. Each change to the system prompt keeps the one before here.</p>
        : (
          <nav className="places versions" aria-label="Earlier system prompts">
            {shown.map((v) => (
              <button key={v.id} type="button" className="item go" onClick={() => { setOpen(v); setRead(read + 1); }}>
                <ClockCounterClockwiseIcon size={20} />
                <p><span>{preview(v, now)}</span><small>{by(v)}</small></p>
                <CaretRightIcon size={16} className="self-center" />
              </button>
            ))}
            {got.versions.length > FIRST ? <button type="button" className="more" onClick={() => setAll(!all)}>{all ? "Show fewer" : "Show all " + got.versions.length}</button> : null}
          </nav>
        )}
      {open === null || got == null ? null : <Opened agent={agent} v={open} now={got.prompt} shut={() => setOpen(null)} reverted={() => { reverted(open.prompt); setRead(read + 1); }} />}
    </>
  );
}
