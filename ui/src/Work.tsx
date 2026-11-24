import { ArrowUpIcon, CaretRightIcon, ChatCircleDotsIcon, HandPalmIcon, XCircleIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import * as Call from "../../Call.ts";
import { get, text_of } from "../../Json.ts";
import * as Md from "../../Md.ts";
import type { Parked, Question, Run, Say, Session } from "../../Session.ts";
import * as View from "../../View.ts";
import type { Told } from "../../Wire.ts";
import { Back } from "./Back.tsx";
import { note, show, useKi, work_live, work_state } from "./Ki.ts";
import { Blocks } from "./Markdown.tsx";
import { Ask, CallBody, ToolIcon } from "./Rows.tsx";
import { viewer_open } from "./Viewer.tsx";
import { useNow, useWorks, work_act, work_span, work_stop, WorkFace } from "./Works.tsx";

// one work session's page: what it is and does now, its log as it comes
// (newest at the bottom, followed while at the bottom), the calls and
// questions it waits on, its report and media, and a box to message it

type Detail = Session & { runs: Run[]; parked: Parked[]; questions: Question[]; says: Array<Say & { heard: number }>; media: string[]; log: Told[] };

// log entries a page brings
const PAGE = 100;
// how near the bottom still follows what comes, in px
const NEAR = 96;
const TOUCH = matchMedia("(pointer: coarse)").matches;
const PICTURE = /\.(png|jpe?g|gif|webp|avif)$/i;
const VIDEO = /\.(mp4|webm|mov)$/i;
// what Claude Code calls the tools the chat has icons for
const AS: Record<string, string> = { Bash: "shell", Read: "read", Write: "write", Edit: "edit", MultiEdit: "edit", Grep: "search", Glob: "search" };
// what a log line for each kind of entry never shows
const QUIET = new Set(["began", "heard", "replied", "dropped", "result"]);

async function load(id: string, query: string): Promise<Detail | null> {
  const res = await fetch("/api/sessions/" + id + "?" + query).catch(() => null);
  return res?.ok === true ? ((await res.json()) as Detail) : null;
}

// a random id for a message, the same on each retry of it
function request(): string {
  return [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// the session and its log: the latest page, then what comes after it each
// time its row in the team changes (moved) or again is called, and earlier
// pages as asked
function useDetail(id: string, moved: string): { d: Detail | null; log: Told[]; gone: boolean; earlier: () => void; again: () => void } {
  const [d, setD] = useState<Detail | null>(null);
  const [log, setLog] = useState<Told[]>([]);
  const [gone, setGone] = useState(false);
  const [asked, setAsked] = useState(0);
  const last = useRef(-1);
  useEffect(() => {
    let on = true;
    const after = last.current;
    void load(id, after < 0 ? "before=&n=" + PAGE : "after=" + after + "&n=1000").then((got) => {
      if (!on) {
        return;
      }
      if (got === null) {
        setGone(after < 0);
        return;
      }
      setD(got);
      const fresh = got.log.filter((t) => t.seq > last.current);
      last.current = Math.max(last.current, got.log.at(-1)?.seq ?? 0);
      setLog((was) => (after < 0 ? got.log : [...was, ...fresh]));
    });
    return () => {
      on = false;
    };
  }, [id, moved, asked]);
  const earlier = () => {
    const first = log[0]?.seq ?? 0;
    void load(id, "before=" + first + "&n=" + PAGE).then((got) => got !== null && setLog((was) => [...got.log, ...was.filter((t) => t.seq >= first)]));
  };
  return { d, log, gone, earlier, again: () => setAsked((n) => n + 1) };
}

// a media file of the session's, a picture opening in the viewer
function Media({ id, name }: { id: string; name: string }): ReactNode {
  const url = "/api/sessions/" + id + "/media/" + encodeURIComponent(name);
  if (VIDEO.test(name)) {
    return <video className="media" src={url} controls playsInline preload="metadata" aria-label={name} />;
  }
  if (PICTURE.test(name)) {
    return <img className="media" src={url} alt={name} loading="lazy" role="button" tabIndex={0} onClick={(ev) => viewer_open(ev.currentTarget)} onKeyDown={(ev) => ev.key === "Enter" && viewer_open(ev.currentTarget)} />;
  }
  return <a className="pillbtn min-h-11 px-4 text-[0.875rem]" href={url} target="_blank" rel="noreferrer">{name}</a>;
}

// a tool call with its result, folded as the chat folds one
function Step({ name, input, result }: { name: string; input: string; result: { text: string; error: boolean } | undefined }): ReactNode {
  const [open, setOpen] = useState(false);
  const call = Call.call_parse(name + " " + input);

  return (
    <details className={"line" + (result === undefined ? " running" : "")} open={open} onToggle={(ev) => setOpen(ev.currentTarget.open)}>
      <summary>
        <ToolIcon name={AS[name] ?? name} />
        <b>{call.name}</b>
        <span className="arg"><bdi>{Call.call_gist(call)}</bdi></span>
        {result?.error === true ? <XCircleIcon size={17} weight="fill" className="shrink-0 text-bad" aria-label="Failed" /> : null}
        <CaretRightIcon size={13} weight="bold" className={"shrink-0 text-dim" + (open ? " rotate-90" : "")} />
      </summary>
      {open ? (
        <div className="prose mt-1.5">
          <CallBody call={call} />
          {result === undefined ? null : <Blocks x={Md.md_output(result.text)} />}
        </div>
      ) : null}
    </details>
  );
}

// a message sent to it; waiting: why it is not yet taken in
function Sent({ text, waiting = "" }: { text: string; waiting?: string }): ReactNode {
  return (
    <div className={"msg user" + (waiting === "" ? "" : " queued")}>
      <div className="prose"><Blocks x={Md.md_parse(text)} /></div>
      {waiting === "" ? null : <p className="who">{waiting}</p>}
    </div>
  );
}

function Report({ text }: { text: string }): ReactNode {
  return (
    <div className="msg work card gl report">
      <p className="who"><b>Report</b></p>
      <div className="prose"><Blocks x={Md.md_parse(text)} /></div>
    </div>
  );
}

// what one log entry shows; media: the files it made
function Entry({ t, result, media, id, agent }: { t: Told; result: { text: string; error: boolean } | undefined; media: string[]; id: string; agent: string }): ReactNode {
  const ev = t.ev;
  const shown =
    ev.k === "text" ? <div className="msg reply"><div className="prose"><Blocks x={Md.md_parse(ev.text)} /></div></div>
    : ev.k === "tool" ? <Step name={ev.name} input={ev.input} result={result} />
    : ev.k === "ask" ? <p className="cap flex items-center gap-1.5"><HandPalmIcon size={16} weight="fill" className="shrink-0 text-act-ink" />Asked for your approval: {ev.what.toLowerCase()}</p>
    : ev.k === "answered" ? <p className="cap">{ev.ok ? "You approved it." : "You denied it."}</p>
    : ev.k === "question" ? <div className="msg work card gl"><p className="who"><ChatCircleDotsIcon size={16} /><b>Asked {agent}</b></p><div className="prose"><Blocks x={Md.md_parse(ev.text)} /></div></div>
    : ev.k === "report" ? <Report text={ev.text} />
    : ev.k === "compacted" ? <p className="cap">Its context was compacted.</p>
    : ev.k === "turn" ? (ev.ok ? null : <p className="cap text-bad">Its turn failed: {ev.text}</p>)
    : ev.k === "end" ? <p className={"cap end" + (ev.ok ? "" : " text-bad")}>{ev.ok ? "The run ended." : "The run failed: " + ev.text}</p>
    : null;
  return (
    <>
      {shown}
      {media.length === 0 ? null : <div className="mt-2 flex flex-wrap gap-2">{media.map((m) => <Media key={m} id={id} name={m} />)}</div>}
    </>
  );
}

// the box that messages the session: steer goes into the run at work at
// its next step, queue waits for the run to end; one that ended starts
// again on either; sent: one went
function SayBox({ id, name, live, sent }: { id: string; name: string; live: boolean; sent: () => void }): ReactNode {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"steer" | "queue">("steer");
  const [sending, setSending] = useState(false);
  const req = useRef(request());
  const blank = text.trim() === "";
  const send = async () => {
    if (blank || sending) {
      return;
    }
    setSending(true);
    const out = await work_act(id, "say", { text: text.trim(), request: req.current, mode });
    setSending(false);
    if (out !== null) {
      req.current = request();
      setText("");
      note(text_of(get(out, "sent"), "Sent."));
      sent();
    }
  };
  const key = (ev: KeyboardEvent) => {
    if (ev.key === "Enter" && !ev.shiftKey && !TOUCH && !ev.nativeEvent.isComposing) {
      ev.preventDefault();
      void send();
    }
  };
  const hint = "Message " + name;
  return (
    <form className="box gl open" onSubmit={(ev) => { ev.preventDefault(); void send(); }}>
      <div className="words">
        <textarea rows={1} placeholder={hint} aria-label={hint} enterKeyHint={TOUCH ? "enter" : "send"} value={text} onChange={(ev) => setText(ev.target.value)} onKeyDown={key} />
      </div>
      <div className="bar">
        <span className="mid">
          {live ? (
            <span className="seg mode" role="group" aria-label="How it goes in">
              <button type="button" aria-pressed={mode === "steer"} title="Into the run now, at its next step" onClick={() => setMode("steer")}>Steer</button>
              <button type="button" aria-pressed={mode === "queue"} title="After this run ends" onClick={() => setMode("queue")}>Queue</button>
            </span>
          ) : <span className="hint">Starts it again where it left off</span>}
        </span>
        <button type="submit" className="snd" aria-label="Send" disabled={blank || sending}><ArrowUpIcon size={20} weight="bold" /></button>
      </div>
    </form>
  );
}

export function WorkPage({ agent, id }: { agent: string; id: string }): ReactNode {
  const navigate = useNavigate();
  const works = useWorks(agent);
  const row = works.find((w) => w.id === id);
  const named = useKi((s) => s.team.find((m) => m.id === agent)?.name ?? "");
  const cards = useKi((s) => s.cards);
  const { d, log, gone, earlier, again } = useDetail(id, row === undefined ? "" : row.seq + " " + row.status + " " + row.wait);
  const scroll = useRef<HTMLDivElement>(null);
  const held = useRef({ bottom: true, height: 0, first: -1 });
  const live = row !== undefined && work_live(row);
  const now = useNow(live);
  useEffect(() => {
    show(agent, null, false);
    return () => show(null);
  }, [agent]);
  // looked at: it is no longer new for the owner
  const fresh = row?.fresh === true;
  useEffect(() => {
    if (fresh) {
      void View.post("/api/sessions/" + id + "/seen", {});
    }
  }, [fresh, id]);
  // follows the log while at its bottom; an earlier page keeps the place
  useLayoutEffect(() => {
    const el = scroll.current;
    if (el === null) {
      return;
    }
    const first = log[0]?.seq ?? -1;
    if (held.current.first !== -1 && first < held.current.first) {
      el.scrollTop += el.scrollHeight - held.current.height;
    } else if (held.current.bottom) {
      el.scrollTop = el.scrollHeight;
    }
    held.current = { ...held.current, height: el.scrollHeight, first };
  });
  // a picture or an opened call that grows it keeps it at its bottom too
  useEffect(() => {
    const el = scroll.current;
    const body = el?.firstElementChild;
    if (el === null || body === null || body === undefined) {
      return undefined;
    }
    const grew = new ResizeObserver(() => {
      if (held.current.bottom) {
        el.scrollTop = el.scrollHeight;
      }
      held.current.height = el.scrollHeight;
    });
    grew.observe(body);
    return () => grew.disconnect();
  }, []);
  const scrolled = () => {
    const el = scroll.current;
    if (el !== null) {
      held.current.bottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR;
    }
  };
  if (gone) {
    return (
      <section className="page">
        <header className="head pl-3.5"><Back to={"/a/" + agent + "/running"} label="Back to what runs" /><h1 className="truncate pl-1.5">Session</h1></header>
        <p className="lede">This session is gone: archived, or never was.</p>
      </section>
    );
  }
  const name = row?.name ?? d?.name ?? "";
  const results = new Map(log.flatMap((t) => (t.ev.k === "result" ? [[t.ev.id, { text: t.ev.text, error: t.ev.error }] as const] : [])));
  // each media file shows under the first entry that names it, the rest at the end
  const media = d?.media ?? [];
  const placed = new Map<number, string[]>();
  const rest = media.filter((m) => {
    const at = log.find((t) => (t.ev.k === "tool" || t.ev.k === "result") && (t.ev.k === "tool" ? t.ev.input : t.ev.text).includes(m));
    if (at !== undefined) {
      placed.set(at.seq, [...(placed.get(at.seq) ?? []), m]);
    }
    return at === undefined;
  });
  const shown = log.filter((t) => !QUIET.has(t.ev.k));
  const all = (log[0]?.seq ?? 1) <= 1;
  const from = log[0]?.at ?? 0;
  // the messages it was sent: each run's first, and those that went into a run at work
  const runs = d?.runs ?? [];
  const sent = [
    ...runs.map((r) => ({ key: "run" + r.n, text: r.prompt, at: r.started, waiting: false, queue: false })),
    ...(d?.says ?? []).filter((s) => s.heard === 0 || !runs.some((r) => r.prompt.includes(s.text))).map((s) => ({ key: s.id, text: s.text, at: s.at, waiting: s.heard === 0, queue: s.mode === "queue" })),
  ].filter((m) => m.waiting || all || m.at >= from).sort((a, b) => a.at - b.at);
  const said = sent.filter((m) => !m.waiting);
  const waiting = sent.filter((m) => m.waiting);
  const asks = cards.filter((a) => a.who === View.SESSION + name);
  const report = runs.at(-1)?.report ?? "";
  const reported = log.some((t) => t.ev.k === "report" && t.ev.text === report);
  const state = row === undefined ? d?.status ?? "" : work_state(row, named);
  const stopped = row?.status === "failed" || row?.status === "stopped";
  const archive = async () => {
    if (!confirm("Archive " + name + "? Its worktree and branch are removed; its record stays.")) {
      return;
    }
    const out = await View.post("/api/sessions/" + id + "/archive", { force: false });
    if (out.ok === true) {
      void navigate({ to: "/a/$agent/running", params: { agent }, replace: true });
      return;
    }
    const why = text_of(out.error, "Could not archive it.");
    if (confirm(why + "\n\nArchive it anyway? Work found nowhere else is lost for good.")) {
      if ((await work_act(id, "archive", { force: true })) !== null) {
        void navigate({ to: "/a/$agent/running", params: { agent }, replace: true });
      }
    }
  };
  // entries and the messages sent, in the order they came
  const flow: Array<{ key: string; node: ReactNode }> = [];
  let k = 0;
  for (const t of shown) {
    for (; k < said.length && said[k].at <= t.at; k++) {
      flow.push({ key: said[k].key, node: <Sent text={said[k].text} /> });
    }
    flow.push({ key: "e" + t.seq, node: <Entry t={t} result={t.ev.k === "tool" ? results.get(t.ev.id) : undefined} media={placed.get(t.seq) ?? []} id={id} agent={named} /> });
  }
  for (; k < said.length; k++) {
    flow.push({ key: said[k].key, node: <Sent text={said[k].text} /> });
  }
  return (
    <section className="page work-page">
      <header className="head pl-3.5">
        <Back to={"/a/" + agent + "/running"} label="Back to what runs" />
        {row === undefined ? null : <WorkFace w={row} size={44} />}
        <div className="min-w-0 flex-1 pl-0.5">
          <h1 className="truncate">{name}</h1>
          <p className="work-sub"><span className={"state " + (row === undefined || row.wait === "" ? row?.status ?? "" : "waiting")}>{state}</span>{row === undefined ? null : <> · <span className="tabular-nums">{work_span(row, now)}</span></>}{d === null ? null : <> · <bdi className="font-mono">{d.branch}</bdi></>}</p>
        </div>
      </header>
      <div className="work-acts">
        {live && row !== undefined ? <button type="button" className="pillbtn" onClick={() => work_stop(row)}>Stop</button> : null}
        {stopped ? <button type="button" className="pillbtn go" onClick={() => void work_act(id, "resume")}>Resume</button> : null}
        {row !== undefined && !live ? <button type="button" className="pillbtn" onClick={() => void archive()}>Archive</button> : null}
      </div>
      <div ref={scroll} className="scroll work-log" onScroll={scrolled}>
        <div>
          {d === null ? <p className="wait" role="status" aria-label="Loading"><i /><i /><i /></p> : null}
          {all ? null : <div className="row"><button type="button" className="pillbtn min-h-11 px-4 text-[0.875rem]" onClick={earlier}>Earlier</button></div>}
          {flow.map((f) => <div key={f.key} className="row">{f.node}</div>)}
          {!reported && report !== "" && !live ? <div className="row"><Report text={report} /></div> : null}
          {rest.length === 0 ? null : <div className="row"><p className="cap">Its media</p><div className="mt-2 flex flex-wrap gap-2">{rest.map((m) => <Media key={m} id={id} name={m} />)}</div></div>}
          {waiting.map((m) => <div key={m.key} className="row"><Sent text={m.text} waiting={m.queue ? "Queued for its next run" : "Goes in at its next step"} /></div>)}
          {(d?.questions ?? []).map((q) => <div key={q.id} className="row"><p className="cap">Waits for {named || "its agent"} to answer “{Md.md_flat(q.text)}”. A message here answers it too.</p></div>)}
          {asks.map((a) => <div key={a.id} className="row"><Ask row={View.ask_row(a)} /></div>)}
          {live && asks.length === 0 && (d?.questions.length ?? 0) === 0 ? <div className="row"><p className="wait" role="status" aria-label="Working"><i /><i /><i /></p></div> : null}
        </div>
      </div>
      {row === undefined ? null : <SayBox id={id} name={name} live={live} sent={again} />}
    </section>
  );
}
