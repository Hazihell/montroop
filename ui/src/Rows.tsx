import {
  AlarmIcon, BookOpenTextIcon, CalendarBlankIcon, CaretDownIcon, CaretRightIcon, ChatCircleTextIcon, FilePlusIcon, HandPalmIcon, type Icon, MagnifyingGlassIcon,
  MagnifyingGlassPlusIcon, PencilSimpleLineIcon, ShieldWarningIcon, TerminalWindowIcon, UsersThreeIcon, WrenchIcon, XCircleIcon,
} from "@phosphor-icons/react";
import { memo, useState, type CSSProperties, type ReactNode } from "react";
import * as Call from "../../Call.ts";
import * as Md from "../../Md.ts";
import * as View from "../../View.ts";
import { act, answer, useKi } from "./Ki.ts";
import { Blocks, Copy } from "./Markdown.tsx";

type Of<K extends View.Row["$"]> = Extract<View.Row, { $: K }>;

// the timeline's items: an opened fold's rows come flat after its head,
// one level deeper, so a long opened fold is drawn row by row as any other
export type Item = { key: string; depth: number; row: View.Row };

export function items_of(rows: View.Row[]): Item[] {
  const seen = new Map<string, number>();
  const out: Item[] = [];
  const key = (base: string) => {
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return base + "." + n;
  };
  const walk = (list: View.Row[], depth: number) => {
    for (const row of list) {
      if (row.$ === "Box") {
        out.push({ key: key("box" + row.id + "+" + row.n), depth, row });
        walk(row.rows, depth + 1);
      } else {
        const id = row.$ === "Ask" ? row.ask.id : row.$ === "Sum" ? row.id + "+" + row.n : row.$ === "Cap" ? "" : String(row.id);
        out.push({ key: key(row.$ + id), depth, row });
      }
    }
  };
  walk(rows, 0);
  return out;
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

function ToolIcon({ name }: { name: string }): ReactNode {
  const Shown = TOOLS[name] ?? WrenchIcon;
  return <Shown size={16} className="shrink-0 text-muted" />;
}

export function Face({ picture, size }: { picture: string; size: number }): ReactNode {
  const src = picture === "logo" ? "/mark.svg" : /^head-\d\d$/.test(picture) ? "/heads/" + picture + ".svg" : picture;
  const style = { width: size, height: size };
  return src === "" ? <span className="face" style={style} /> : <img className="face" style={style} src={src} alt="" />;
}

function Sum({ row }: { row: Of<"Sum"> }): ReactNode {
  if (row.n === 1) {
    return <p className="text-sm text-muted">{row.text}</p>;
  }
  return (
    <button type="button" className="fold" aria-expanded={false} onClick={() => act({ $: "Open", id: row.id, n: row.n })}>
      <CaretRightIcon size={14} className="mt-1 shrink-0" />
      <span className="count">{row.msgs}</span>
      <span className="line-clamp-2 text-left">{row.text}</span>
    </button>
  );
}

function BoxHead({ row }: { row: Of<"Box"> }): ReactNode {
  return (
    <button type="button" className="fold" aria-expanded onClick={() => act({ $: "Shut", id: row.id, n: row.n })}>
      <CaretDownIcon size={14} className="mt-1 shrink-0" />
      <span className="count">{row.msgs}</span>
      <span>messages, opened</span>
    </button>
  );
}

function Pics({ names }: { names: string[] }): ReactNode {
  const agent = useKi((s) => s.agent);
  if (names.length === 0) {
    return null;
  }
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {names.map((name) => {
        const url = "/image/" + agent + "/" + name;
        return <a key={name} href={url} target="_blank" rel="noopener"><img className="media max-h-48" src={url} alt={name} loading="lazy" /></a>;
      })}
    </div>
  );
}

function CallBody({ call }: { call: Call.Call }): ReactNode {
  return (
    <>
      <p className="call">{call.head}</p>
      <Blocks x={call.blocks} />
    </>
  );
}

function Said({ row }: { row: Of<"Msg"> }): ReactNode {
  const mate = useKi((s) => s.team.find((m) => m.id === row.from));
  const gist = Md.md_flat(Call.report_read(row.text)?.text ?? row.text);
  return (
    <details className="said">
      <summary>
        <Face picture={mate?.picture ?? ""} size={20} />
        <b>{mate?.name ?? row.who}</b>
        <span className="truncate text-muted">{gist}</span>
      </summary>
      <div className="prose mt-2"><Blocks x={row.body} /></div>
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
    <div className={"msg " + row.kind + state}>
      {row.who === "" ? null : <p className="who">{row.who}</p>}
      <div className="prose">{row.call === null ? <Blocks x={row.body} /> : <CallBody call={row.call} />}</div>
      <Pics names={row.images} />
      {row.queued === true ? <p className="who">Queued</p> : null}
      {row.kind === "reply" && row.writing !== true ? <Copy text={row.text} /> : null}
    </div>
  );
}

function Line({ row }: { row: Of<"Line"> }): ReactNode {
  const [open, setOpen] = useState(false);
  const c = row.call;
  const failed = row.echo?.startsWith("error") === true;
  const files = c.name === "write" || c.name === "edit";
  const lines = files && row.echo !== null && !failed ? row.echo.split("\n") : null;
  return (
    <details className={"line" + (row.phase === undefined ? "" : " " + row.phase)} open={open} onToggle={(ev) => setOpen(ev.currentTarget.open)}>
      <summary>
        <ToolIcon name={c.name} />
        {c.name === "" ? null : <b>{c.name}</b>}
        <span className={files ? "arg path" : "arg"}><bdi>{c.head.trim().replace(/\s*\n\s*/g, " ")}</bdi></span>
        {lines === null ? null : (
          <span className="shrink-0 tabular-nums">
            <b className="text-ok">+{lines.filter((l) => /^\+(?!\+\+)/.test(l)).length}</b> <b className="text-bad">−{lines.filter((l) => /^-(?!--)/.test(l)).length}</b>
          </span>
        )}
        {failed ? <XCircleIcon size={16} weight="fill" className="shrink-0 text-bad" aria-label="Failed" /> : null}
        {c.device === "" ? null : <span className="shrink-0 text-muted">{c.device}</span>}
      </summary>
      {open ? (
        <div className="prose mt-2">
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

function Ask({ row }: { row: Of<"Ask"> }): ReactNode {
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const say = (ok: boolean) => {
    setSent(true);
    void answer(row.ask.id, ok, note.trim()).then((done) => done || setSent(false));
  };
  return (
    <div className="ask" role="group" aria-label={View.ASKS + ": " + row.ask.what}>
      <p className="flex items-center gap-2 font-semibold">
        <ShieldWarningIcon size={18} className="shrink-0 text-action" />
        <span>{row.ask.what}</span>
        {row.ask.who === "" ? null : <span className="font-normal text-muted">{row.ask.who}</span>}
      </p>
      <div className="prose my-2 text-sm"><CallBody call={row.call} /></div>
      <input className="field" maxLength={2000} placeholder="Note for the agent (optional)" aria-label="Note for the agent" autoComplete="off" value={note} onChange={(ev) => setNote(ev.target.value)} />
      <div className="mt-2 flex gap-2">
        <button type="button" className="btn flex-1" disabled={sent} onClick={() => say(false)}>Deny</button>
        <button type="button" className="btn primary flex-1" disabled={sent} onClick={() => say(true)}>Approve</button>
      </div>
    </div>
  );
}

// the view makes a tool line anew at each draw, around the same call and
// result: it is the same line while those are
function same(a: { item: Item }, b: { item: Item }): boolean {
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
  return x === y;
}

export const Row = memo(function Row({ item }: { item: Item }): ReactNode {
  const row = item.row;
  return (
    <div className="row" style={{ "--depth": item.depth } as CSSProperties}>
      {row.$ === "Sum" ? <Sum row={row} />
        : row.$ === "Box" ? <BoxHead row={row} />
        : row.$ === "Msg" ? <Msg row={row} />
        : row.$ === "Line" ? <Line row={row} />
        : row.$ === "Cap" ? <Cap row={row} />
        : <Ask row={row} />}
    </div>
  );
}, same);
