import {
  AlarmIcon, BookOpenTextIcon, CalendarBlankIcon, CaretDownIcon, CaretRightIcon, ChatCircleTextIcon, FilePlusIcon, HandPalmIcon, type Icon, MagnifyingGlassIcon,
  MagnifyingGlassPlusIcon, PencilSimpleLineIcon, TerminalWindowIcon, UsersThreeIcon, WrenchIcon, XCircleIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { memo, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { create } from "zustand";
import * as Call from "../../Call.ts";
import * as Md from "../../Md.ts";
import { QUESTION, Question, type Answers } from "../../Question.ts";
import * as View from "../../View.ts";
import { wake_read } from "../../Wake.ts";
import { Face } from "./Avatar.tsx";
import { act, answer, useMontroop } from "./Montroop.ts";
import { Blocks, Copy } from "./Markdown.tsx";
import { viewer_open } from "./Viewer.tsx";

type Of<K extends View.Row["$"]> = Extract<View.Row, { $: K }>;

// a run of finished tool calls, shown as one line saying what was done:
// opened, its calls follow it one by one
type Work = { $: "Work"; id: string; lines: Array<Of<"Line">>; open: boolean };

// the timeline's items: an opened fold's rows come flat after its head,
// one level deeper, so a long opened fold is drawn row by row as any other
export type Item = { key: string; depth: number; row: View.Row | Work };

const RUN = 2;

export const useWork = create<{ open: ReadonlySet<string> }>(() => ({ open: new Set() }));

function work_toggle(id: string): void {
  const open = new Set(useWork.getState().open);
  if (!open.delete(id)) {
    open.add(id);
  }
  useWork.setState({ open });
}

// after: the counts of the keys of the items before these, which a key
// made here goes on from
export function items_of(rows: View.Row[], open: ReadonlySet<string>, after?: Map<string, number>): { items: Item[]; seen: Map<string, number> } {
  const seen = new Map(after);
  const out: Item[] = [];
  const key = (base: string) => {
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return base + "." + n;
  };
  const one = (row: View.Row, depth: number) => {
    const id = row.$ === "Ask" ? row.ask.id : row.$ === "Sum" || row.$ === "Box" ? row.id + "+" + row.n : row.$ === "Cap" ? "" : String(row.id);
    out.push({ key: key(row.$ + id), depth, row });
  };
  const walk = (list: View.Row[], depth: number) => {
    for (let k = 0; k < list.length; k++) {
      const row = list[k];
      const run: Array<Of<"Line">> = [];
      for (let next = list[k + run.length]; next?.$ === "Line" && next.phase === undefined; next = list[k + run.length]) {
        run.push(next);
      }
      if (run.length >= RUN) {
        const id = "w" + String(run[0]?.id) + "d" + depth;
        out.push({ key: key(id), depth, row: { $: "Work", id, lines: run, open: open.has(id) } });
        open.has(id) && run.forEach((line) => one(line, depth + 1));
        k += run.length - 1;
      } else {
        one(row, depth);
        row.$ === "Box" && walk(row.rows, depth + 1);
      }
    }
  };
  walk(rows, 0);
  return { items: out, seen };
}

const TOOLS: Record<string, Icon> = {
  zoom       : MagnifyingGlassPlusIcon,
  search     : MagnifyingGlassIcon,
  date       : CalendarBlankIcon,
  shell      : TerminalWindowIcon,
  read       : BookOpenTextIcon,
  write      : FilePlusIcon,
  edit       : PencilSimpleLineIcon,
  schedule   : AlarmIcon,
  schedules  : AlarmIcon,
  unschedule : AlarmIcon,
  spawn      : UsersThreeIcon,
  tell       : ChatCircleTextIcon,
  stop       : HandPalmIcon,
};

export function ToolIcon({ name }: { name: string }): ReactNode {
  const Shown = TOOLS[name] ?? WrenchIcon;
  return <Shown size={17} />;
}

function Sum({ row }: { row: Of<"Sum"> }): ReactNode {
  if (row.n === 1) {
    return <p className="cap">{row.text}</p>;
  }
  return (
    <button type="button" className="fold" aria-expanded={false} onClick={() => act({ $: "Open", id: row.id, n: row.n })}>
      <span className="count">{row.msgs}</span>
      <span className="line-clamp-2 min-w-0 flex-1">{row.text}</span>
      <CaretRightIcon size={14} weight="bold" />
    </button>
  );
}

function BoxHead({ row }: { row: Of<"Box"> }): ReactNode {
  return (
    <button type="button" className="fold" aria-expanded onClick={() => act({ $: "Shut", id: row.id, n: row.n })}>
      <span className="count">{row.msgs}</span>
      <span className="min-w-0 flex-1">messages, opened</span>
      <CaretDownIcon size={14} weight="bold" />
    </button>
  );
}

function Pics({ names }: { names: string[] }): ReactNode {
  const agent = useMontroop((s) => s.agent);
  if (names.length === 0) {
    return null;
  }
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {names.map((name) => {
        const url = "/image/" + agent + "/" + name;
        return <img key={name} className="media" src={url} alt={name} loading="lazy" role="button" tabIndex={0} onClick={(ev) => viewer_open(ev.currentTarget)} onKeyDown={(ev) => ev.key === "Enter" && viewer_open(ev.currentTarget)} />;
      })}
    </div>
  );
}

export function CallBody({ call }: { call: Call.Call }): ReactNode {
  return (
    <>
      <p className="call">{call.head}</p>
      <Blocks x={call.blocks} />
    </>
  );
}

function Said({ row }: { row: Of<"Msg"> }): ReactNode {
  const mate = useMontroop((s) => s.team.find((m) => m.id === row.from));
  const gist = Md.md_flat(wake_read(row.text)?.text ?? row.text);
  return (
    <details className="said card gl">
      <summary className="who">
        <Face picture={mate?.picture ?? ""} id={row.from ?? ""} size={30} />
        <b>{mate?.name ?? row.who}</b>
        <span>{gist}</span>
        <CaretRightIcon size={14} weight="bold" className="shrink-0 text-dim [[open]>summary>&]:rotate-90" />
      </summary>
      <div className="prose mt-1"><Blocks x={row.body} /></div>
      <Pics names={row.images} />
    </details>
  );
}

function Msg({ row }: { row: Of<"Msg"> }): ReactNode {
  if (row.from !== undefined) {
    return <Said row={row} />;
  }
  const state = (row.queued === true ? " queued" : "") + (row.writing === true ? " writing" : "");
  return (
    <div className={"msg " + row.kind + state + (row.kind === "work" ? " card gl" : "")}>
      {row.who === "" ? null : <p className="who"><b>{row.who}</b></p>}
      <div className="prose">{row.call === null ? <Blocks x={row.body} /> : <CallBody call={row.call} />}</div>
      <Pics names={row.images} />
      {row.queued === true ? <p className="who">Queued</p> : null}
      {row.kind === "reply" ? <Copy text={row.text} /> : null}
    </div>
  );
}

function failed(row: Of<"Line">): boolean {
  return row.echo?.startsWith("error") === true;
}

// the lines a write or an edit added and took out, as its result's diff says
function changed(row: Of<"Line">): [number, number] | null {
  if ((row.call.name !== "write" && row.call.name !== "edit") || row.echo === null || failed(row)) {
    return null;
  }
  const lines = row.echo.split("\n");
  return [lines.filter((l) => /^\+(?!\+\+)/.test(l)).length, lines.filter((l) => /^-(?!--)/.test(l)).length];
}

function Changed({ n }: { n: [number, number] }): ReactNode {
  return <span className="shrink-0 font-mono text-[0.8125rem] whitespace-nowrap tabular-nums"><span className="text-ok">+{n[0]}</span> <span className="text-bad">−{n[1]}</span></span>;
}

const DID: Array<[string[], string, string]> = [[["shell"], "ran", "command"], [["write", "edit"], "edited", "file"], [["read"], "read", "file"], [["search", "zoom"], "looked back", "time"]];

// what a run of calls did, by its two largest kinds, the rest counted
function did(lines: Array<Of<"Line">>): string {
  const count = (names: string[]) => lines.filter((l) => names.includes(l.call.name)).length;
  const said = DID.map(([names, verb, thing]) => [count(names), verb, thing] as const).filter(([n]) => n > 0).sort((a, b) => b[0] - a[0]).slice(0, 2);
  const rest = lines.length - said.reduce((sum, [n]) => sum + n, 0);
  const all = [...said.map(([n, verb, thing]) => verb + " " + n + " " + thing + (n === 1 ? "" : "s")), ...(rest === 0 ? [] : said.length === 0 ? ["used " + rest + " tools"] : [rest + " more"])].join(", ");
  return all.charAt(0).toUpperCase() + all.slice(1);
}

function WorkHead({ row }: { row: Work }): ReactNode {
  const sums = row.lines.map(changed).filter((n) => n !== null);
  return (
    <button type="button" className="line work" aria-expanded={row.open} onClick={() => work_toggle(row.id)}>
      <TerminalWindowIcon size={17} />
      <span className="min-w-0 truncate">{did(row.lines)}</span>
      <CaretRightIcon size={13} weight="bold" className={"shrink-0 text-dim" + (row.open ? " rotate-90" : "")} />
      {sums.length === 0 ? null : <span className="ml-auto"><Changed n={[sums.reduce((sum, n) => sum + n[0], 0), sums.reduce((sum, n) => sum + n[1], 0)]} /></span>}
      {row.lines.some(failed) ? <XCircleIcon size={17} weight="fill" className={"shrink-0 text-bad" + (sums.length === 0 ? " ml-auto" : "")} aria-label="A call failed" /> : null}
    </button>
  );
}

function Line({ row }: { row: Of<"Line"> }): ReactNode {
  const [open, setOpen] = useState(false);
  const c = row.call;
  const files = c.name === "write" || c.name === "edit";
  const lines = changed(row);
  return (
    <details className={"line" + (row.phase === undefined ? "" : " " + row.phase)} open={open} onToggle={(ev) => setOpen(ev.currentTarget.open)}>
      <summary>
        <ToolIcon name={c.name} />
        {c.name === "" ? null : <b>{c.name}</b>}
        <span className={files ? "arg path" : "arg"}><bdi>{c.head.trim().replace(/\s*\n\s*/g, " ")}</bdi></span>
        {lines === null ? null : <Changed n={lines} />}
        {failed(row) ? <XCircleIcon size={17} weight="fill" className="shrink-0 text-bad" aria-label="Failed" /> : null}
        {c.device === "" ? null : <span className="shrink-0 text-dim">{c.device}</span>}
        <CaretRightIcon size={13} weight="bold" className={"shrink-0 text-dim" + (open ? " rotate-90" : "")} />
      </summary>
      {open ? (
        <div className="prose mt-1.5">
          {row.rows.map((part, k) => part.$ !== "Msg" ? null : (
            <div key={k}>
              {part.call === null ? <Blocks x={part.body} /> : <CallBody call={part.call} />}
              <Pics names={part.images} />
            </div>
          ))}
        </div>
      ) : null}
    </details>
  );
}

function Cap({ row }: { row: Of<"Cap"> }): ReactNode {
  if (row.wait === true) {
    return <p className="wait" role="status" aria-label="Working"><i /><i /><i /></p>;
  }
  return <p className={"cap" + (row.think === true ? " think" : "")}>{row.text}</p>;
}

// who asked: a work session's name opens its page
function AskedBy({ ask }: { ask: Of<"Ask">["ask"] }): ReactNode {
  const work = useMontroop((s) => s.team.find((m) => m.id === ask.agent)?.works?.find((w) => ask.from === "session" && w.who === ask.who));
  return work === undefined ? View.asker(ask) : <Link to="/a/$agent/w/$id" params={{ agent: ask.agent, id: work.id }} className="underline underline-offset-2">{View.asker(ask)}</Link>;
}

export function Ask({ row }: { row: Of<"Ask"> }): ReactNode {
  const questions = row.ask.tool === QUESTION ? Question.of(input_of(row.ask.input)) : [];
  return questions.length > 0 ? <Asks ask={row.ask} questions={questions} /> : <Approve row={row} />;
}

function input_of(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function Approve({ row }: { row: Of<"Ask"> }): ReactNode {
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const say = (ok: boolean) => {
    setSent(true);
    void answer(row.ask.id, ok, note.trim()).then((done) => done || setSent(false));
  };
  return (
    <div className="ask card" role="group" aria-label={View.ASKS + ": " + row.ask.what}>
      <h3>{row.ask.what}</h3>
      {row.ask.who === "" ? null : <p className="cap">asked by <AskedBy ask={row.ask} /></p>}
      <div className="prose my-2.5 text-[0.9375rem]"><CallBody call={row.call} /></div>
      <input className="field" maxLength={2000} placeholder="Note for the mon (optional)" aria-label="Note for the mon" autoComplete="off" value={note} onChange={(ev) => setNote(ev.target.value)} />
      <div className="mt-3 flex gap-2">
        <button type="button" className="pillbtn go" disabled={sent} onClick={() => say(true)}>Approve</button>
        <button type="button" className="pillbtn" disabled={sent} onClick={() => say(false)}>Deny</button>
      </div>
    </div>
  );
}

// what the owner picked for one question, and typed as another answer
type Pick = { picked: string[]; other: string };

// a question the run asks the owner, as choices: a tap on one answers a
// lone question that takes one; otherwise each is picked, or typed in, and
// sent together. Dismissed, the run goes on without the answer
function Asks({ ask, questions }: { ask: Of<"Ask">["ask"]; questions: Question[] }): ReactNode {
  const [picks, setPicks] = useState<Pick[]>(() => questions.map(() => ({ picked: [], other: "" })));
  const [sent, setSent] = useState(false);
  const tap = questions.length === 1 && !questions[0].multi;
  const said = (p: Pick) => [...p.picked, ...(p.other.trim() === "" ? [] : [p.other.trim()])].join(", ");
  const send = (ok: boolean, now: Pick[] = picks) => {
    setSent(true);
    const answers: Answers = ok ? Object.fromEntries(questions.map((q, k) => [q.question, said(now[k])])) : {};
    void answer(ask.id, ok, "", answers).then((done) => done || setSent(false));
  };
  const set = (k: number, p: Pick) => setPicks(picks.map((x, j) => (j === k ? p : x)));
  const choose = (k: number, label: string) => {
    const q = questions[k];
    const had = picks[k];
    const p = q.multi ? { ...had, picked: had.picked.includes(label) ? had.picked.filter((l) => l !== label) : [...had.picked, label] } : { picked: [label], other: "" };
    if (tap) {
      send(true, [p]);
    }
    set(k, p);
  };
  const ready = picks.every((p) => said(p) !== "");
  return (
    <div className="ask card" role="group" aria-label={questions.length === 1 ? questions[0].question : questions.length + " questions"}>
      {ask.who === "" ? null : <p className="cap">asked by <AskedBy ask={ask} /></p>}
      {questions.map((q, k) => (
        <fieldset key={k} className="mt-3 first:mt-1" disabled={sent}>
          <legend className="contents">
            {q.header === "" ? null : <span className="chip">{q.header}</span>}
            <h3 className="mt-1.5 text-[1.125rem]">{q.question}</h3>
          </legend>
          {q.multi ? <p className="cap mt-0.5">Pick any</p> : null}
          <div className="mt-2.5 grid gap-1.5">
            {q.options.map((o) => {
              const on = picks[k].picked.includes(o.label);
              return (
                <button key={o.label} type="button" className={"choice" + (on ? " on" : "")} aria-pressed={tap ? undefined : on} onClick={() => choose(k, o.label)}>
                  <b>{o.label}</b>
                  {o.description === "" ? null : <span>{o.description}</span>}
                </button>
              );
            })}
          </div>
          <input className="field mt-2" maxLength={2000} placeholder={q.multi ? "Add another answer" : "Another answer"} aria-label={"Another answer to: " + q.question} autoComplete="off" enterKeyHint="send" value={picks[k].other}
            onChange={(ev) => set(k, { picked: q.multi ? picks[k].picked : [], other: ev.target.value })}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" && ready) {
                send(true);
              }
            }} />
        </fieldset>
      ))}
      <div className="mt-3 flex gap-2">
        {tap && picks[0].other.trim() === "" ? null : <button type="button" className="pillbtn go" disabled={sent || !ready} onClick={() => send(true)}>Send</button>}
        <button type="button" className="pillbtn" disabled={sent} onClick={() => send(false)}>Dismiss</button>
      </div>
    </div>
  );
}

// the view makes a tool line anew at each draw, around the same call and
// result: it is the same line while those are. Rise counts only as a row is
// first drawn
function same(a: { item: Item; rise: boolean }, b: { item: Item; rise: boolean }): boolean {
  const [x, y] = [a.item.row, b.item.row];
  if (a.item.depth !== b.item.depth) {
    return false;
  }
  if (x.$ === "Line" && y.$ === "Line") {
    return x.rows[0] === y.rows[0] && x.echo === y.echo && x.phase === y.phase;
  }
  if (x.$ === "Box" && y.$ === "Box") {
    return x.id === y.id && x.n === y.n && x.msgs === y.msgs;
  }
  if (x.$ === "Work" && y.$ === "Work") {
    return x.id === y.id && x.open === y.open && x.lines.length === y.lines.length && x.lines.at(-1)?.echo === y.lines.at(-1)?.echo;
  }
  return x === y;
}

// the keys of the rows that rose in, so one drawn again, as the list
// scrolls back to it, stays still; a key gone from the end is forgotten,
// and the next row to take it rises in
const ROSE = new Set<string>();

export function rose_keep(keys: ReadonlySet<string>): void {
  [...ROSE].filter((key) => !keys.has(key)).forEach((key) => ROSE.delete(key));
}

// rise: it just came, and comes in moving as it is first drawn
export const Row = memo(function Row({ item, rise }: { item: Item; rise: boolean }): ReactNode {
  const row = item.row;
  const [rose] = useState(() => rise && !ROSE.has(item.key));
  useEffect(() => {
    rose && ROSE.add(item.key);
  }, [rose, item.key]);
  return (
    <div className={"row" + (row.$ === "Line" || row.$ === "Work" ? " thin" : "") + (rose ? " rise" : "")} style={{ "--depth": item.depth } as CSSProperties}>
      {row.$ === "Work" ? <WorkHead row={row} />
        : row.$ === "Sum" ? <Sum row={row} />
        : row.$ === "Box" ? <BoxHead row={row} />
        : row.$ === "Msg" ? <Msg row={row} />
        : row.$ === "Line" ? <Line row={row} />
        : row.$ === "Cap" ? <Cap row={row} />
        : <Ask row={row} />}
    </div>
  );
}, same);
