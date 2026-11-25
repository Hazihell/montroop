import { useEffect, useRef, useState, type ReactNode } from "react";
import * as Import from "../../Import.ts";
import * as View from "../../View.ts";
import { import_flow, import_send, useMontroop } from "./Montroop.ts";

type Read = { sessions: Import.Session[]; moved: number };

const APPS = ["Claude", "ChatGPT"];
const NONE = "No Claude or ChatGPT chats in that folder. Choose ~/.claude or ~/.codex.";
const DAY  = 864e5;
const DESK = matchMedia("(hover: hover)").matches;

// a file as it is now: one that changes while read fails here, not later
async function copy_of(file: File): Promise<Blob> {
  const reader = file.stream().getReader();
  const parts: Blob[] = [];
  for (let got = await reader.read(); !got.done; got = await reader.read()) {
    parts.push(new Blob([got.value]));
  }
  return new Blob(parts);
}

function day(at: string | number): string {
  return new Date(at).getUTCDate() + " " + new Date(at).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

// past Claude and ChatGPT chats, read in this browser, picked, then sent
// into the agent's memory, whose tree the server builds meanwhile
export default function Importer({ agent, shut }: { agent: string; shut: () => void }): ReactNode {
  const run = useMontroop((s) => s.importing);
  const box = useRef<HTMLDialogElement>(null);
  const dir = useRef<HTMLInputElement>(null);
  const zip = useRef<HTMLInputElement>(null);
  const [found, setFound] = useState(new Map<string, Read>());
  const [done, setDone] = useState<Import.Done>({});
  const [off, setOff] = useState(new Set<string>());
  const [tools, setTools] = useState(false);
  const [back, setBack] = useState(0);
  const [status, setStatus] = useState("");
  const [step, setStep] = useState<"" | "send" | "run" | "done">("");
  const [now] = useState(() => Date.now());

  useEffect(() => {
    box.current?.showModal();
    void fetch("/api/imported?agent=" + encodeURIComponent(agent)).then((res) => res.json()).then((d) => setDone(d as Import.Done), () => {});
  }, [agent]);

  const reads = [...found.values()];
  const sessions = reads.flatMap((read) => read.sessions);
  const today = Math.floor(now / DAY);
  const first = Import.import_plan(sessions, { off: [...off], since: "", tools }, done).first;
  const min = Math.floor(Date.parse(first || new Date(now).toISOString()) / DAY);
  const since = back > min ? new Date(back * DAY).toISOString().slice(0, 10) : "";
  const plan = Import.import_plan(sessions, { off: [...off], since, tools }, done);
  const left = reads.reduce((n, read) => n + read.moved, 0);
  const moved = left === 0 ? "" : " (" + left + (left === 1 ? " file" : " files") + " changed while read: choose the folder again to add them)";
  const reading = status.startsWith("Reading");
  const going = run !== null || step !== "";
  const finished = run === null && step === "done";
  const paused = Boolean(run?.why);

  const took = (name: string, read: Read, said: string) => {
    setFound((was) => new Map(was).set(name, read));
    setBack(0);
    setStatus(said);
  };
  const folder = async (all: File[]) => {
    const files = all.filter((f) => Import.import_file(f.webkitRelativePath));
    const got: Import.Session[] = [];
    let changed = 0;
    for (const [k, f] of files.entries()) {
      setStatus("Reading " + (k + 1) + " of " + files.length + " files…");
      const s = await copy_of(f).then((b) => Import.import_session(b, "log"), () => undefined);
      changed += s === undefined ? 1 : 0;
      got.push(...(s ? [s] : []));
    }
    took(all[0]?.webkitRelativePath.split("/")[0] ?? "", { sessions: got, moved: changed }, got.length > 0 ? "" : NONE);
  };
  const exports = async (files: File[]) => {
    for (const f of files) {
      setStatus("Reading " + f.name + "…");
      try {
        const got = await Import.import_export(await copy_of(f));
        took(f.name, { sessions: got, moved: 0 }, got.length > 0 ? "" : "No chats in " + f.name + ".");
      } catch (e) {
        took(f.name, { sessions: [], moved: 0 }, f.name + ": " + (e as Error).message);
      }
    }
  };
  const send = () => {
    const picked = plan.picked;
    setStep("send");
    setStatus("");
    void import_send(agent, async () => new Blob(await Array.fromAsync(Import.import_body(picked), (part) => new Blob([part])))).then((out) => {
      if (out.error === undefined) {
        setFound(new Map());
      }
      setStep(out.error !== undefined ? "" : out.going === true ? "run" : "done");
      setStatus(out.error === undefined ? "" : "Not imported: " + out.error);
    });
  };
  const toggle = (id: string, on: boolean) => {
    const next = new Set(off);
    on ? next.delete(id) : next.add(id);
    setOff(next);
  };

  return (
    <dialog ref={box} className="import gl" aria-label="Import your past AI chats" onClose={shut}>
      {going ? (
        <section>
          <h2>{finished ? "Memory tree built" : "Building your memory tree"}</h2>
          <progress max={1} value={run === null ? Number(finished) : run.done / Math.max(1, run.total)} />
          <p>{run !== null ? View.progress_show(run) : finished ? Import.DONE : step === "send" ? "Sending…" : "Starting…"}</p>
          {paused || finished ? null : <p className="sub">{Import.MIDWAY}</p>}
          <div className="acts">
            <button type="button" className="pillbtn" onClick={() => box.current?.close()}>Go to the chat</button>
            {run === null ? null : <button type="button" className="pillbtn go" onClick={import_flow}>{paused ? "Resume" : "Pause"}</button>}
          </div>
        </section>
      ) : (
        <form onSubmit={(ev) => { ev.preventDefault(); send(); }}>
          <h2>Import your past AI chats</h2>
          {DESK
            ? <p className="sub">Choose your <code>~/.claude</code> or <code>~/.codex</code> folder (hidden: <kbd>⌘</kbd><kbd>⇧</kbd><kbd>G</kbd> in the dialog), or add an export from the website.</p>
            : <p className="sub">Import on your computer: open this site there.</p>}
          <input ref={dir} type="file" hidden {...{ webkitdirectory: "" }} onChange={(ev) => { void folder([...(ev.target.files ?? [])]); ev.target.value = ""; }} />
          <input ref={zip} type="file" accept=".zip,.json" multiple hidden onChange={(ev) => { void exports([...(ev.target.files ?? [])]); ev.target.value = ""; }} />
          {DESK ? APPS.map((app) => {
            const shown = plan.sessions.filter((s) => s.app === app);
            const on = shown.filter((s) => !off.has(Import.import_id(s))).length;
            return (
              <fieldset key={app}>
                <legend>{app}</legend>
                {shown.length === 0 ? null : (
                  <details>
                    <summary>{(on < shown.length ? on + " of " : shown.length > 1 ? "All " : "") + shown.length + (shown.length === 1 ? " session" : " sessions") + " picked · choose"}</summary>
                    <div className="sessions">
                      {shown.map((s) => (
                        <label key={Import.import_id(s)} title={s.where + ", " + Import.import_count(s.heads.length, "")}>
                          <input type="checkbox" checked={!off.has(Import.import_id(s))} onChange={(ev) => toggle(Import.import_id(s), ev.target.checked)} />
                          {Import.import_cells(s).map((c, k) => <span key={k}>{c}</span>)}
                        </label>
                      ))}
                    </div>
                  </details>
                )}
                <button type="button" className="pillbtn min-h-11 px-4 text-[0.875rem]" disabled={reading} title={"From the website: " + Import.EXPORTS[app] + ", which emails you a zip."} onClick={() => zip.current?.click()}>Add a website export</button>
              </fieldset>
            );
          }) : null}
          {plan.first === "" ? null : (
            <fieldset>
              {sessions.some((s) => s.heads.some((m) => m.kind === "tool" || m.kind === "echo")) ? <label className="opt"><input type="checkbox" checked={tools} onChange={(ev) => setTools(ev.target.checked)} /> Tool calls</label> : null}
              <label className="since">
                <span>{day(since || plan.first || now)}</span><span>{day(now)}</span>
                <input type="range" min={min} max={today} value={Math.max(back, min)} onChange={(ev) => setBack(ev.target.valueAsNumber)} />
              </label>
            </fieldset>
          )}
          <p>{(sessions.length === 0 ? "" : plan.first === "" ? Import.OLD : Import.import_count(plan.msgs, "new ")) + moved}</p>
          <p className="sub">{status}</p>
          <div className="acts">
            <button type="button" className="pillbtn" onClick={() => box.current?.close()}>Close</button>
            {DESK ? <button type="button" className="pillbtn" disabled={reading} onClick={() => dir.current?.click()}>{plan.msgs > 0 ? "Add a folder" : "Choose folder"}</button> : null}
            {plan.msgs === 0 ? null : <button type="submit" className="pillbtn go" disabled={reading}>Import</button>}
          </div>
        </form>
      )}
    </dialog>
  );
}
