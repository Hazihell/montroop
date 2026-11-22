import { ArrowUpIcon, CheckIcon, FileIcon, MicrophoneIcon, PlusIcon, StopIcon, WarningIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import * as View from "../../View.ts";
import { act, holds, note, useKi, voice } from "./Ki.ts";
import { viewer_open } from "./Viewer.tsx";

// on a phone Enter is a new line: its keyboard has no Shift+Enter
const TOUCH = matchMedia("(pointer: coarse)").matches;

const FAILED = "A file didn't upload: remove it, then send.";

const MODES: Array<[string, string]> = [
  ["Standard", "Each message is summarized for the agent's memory. Cheapest, good for long working sessions."],
  ["Conversation", "Messages stay word for word in the agent's view until you switch back. Costs more per turn."],
];

type Item = { key: number; name: string; kind: string; size: number; state: "up" | "ok" | "bad"; part: number; url: string; peek: string };

let KEYS = 0;

// a press on one of the box's buttons leaves the caret in the text: the
// keyboard stays up, and the box does not move under the finger
function hold(ev: MouseEvent): void {
  if (ev.target instanceof Element && ev.target.closest("button") !== null) {
    ev.preventDefault();
  }
}

function answer_of(xhr: XMLHttpRequest): { url: string } | { error: string } {
  let out: unknown = null;
  try {
    out = JSON.parse(xhr.responseText);
  } catch {}
  if (typeof out === "object" && out !== null && "url" in out && typeof out.url === "string") {
    return { url: out.url };
  }
  const why = typeof out === "object" && out !== null && "error" in out && typeof out.error === "string" ? out.error : xhr.status === 0 ? "Can't reach Ki." : "HTTP " + xhr.status;
  return { error: "Could not upload: " + why };
}

function md_of(item: Item): string {
  return (View.media_kind(item.url) === null ? "" : "!") + "[" + item.name + "](" + item.url + ")";
}

// the sound's level as bars that move left, with the time recorded
function Meter({ stream }: { stream: MediaStream }): ReactNode {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const audio = new AudioContext();
    const probe = audio.createAnalyser();
    audio.createMediaStreamSource(stream).connect(probe);
    const buf = new Uint8Array(probe.fftSize);
    const levels: number[] = [];
    const start = performance.now();
    let frame = requestAnimationFrame(function draw(now) {
      const el = canvas.current;
      const pen = el?.getContext("2d");
      if (el == null || pen == null) {
        return;
      }
      probe.getByteTimeDomainData(buf);
      const power = buf.reduce((sum, b) => sum + ((b - 128) / 128) ** 2, 0) / buf.length;
      const slot = Math.floor((now - start) / 50);
      levels[slot] = Math.max(levels[slot] ?? 0, Math.min(1, Math.sqrt(power) * 5));
      setSecs(Math.floor((now - start) / 1000));
      const dpr = devicePixelRatio;
      const w = (el.width = el.clientWidth * dpr);
      const h = (el.height = el.clientHeight * dpr);
      pen.fillStyle = getComputedStyle(el).color;
      for (let i = 0; i * 5 * dpr < w && slot - i >= 0; i++) {
        const bar = Math.max(2 * dpr, (levels[slot - i] ?? 0) * h);
        pen.beginPath();
        pen.roundRect(w - (i + 1) * 5 * dpr, (h - bar) / 2, 3 * dpr, bar, dpr);
        pen.fill();
      }
      frame = requestAnimationFrame(draw);
    });
    return () => {
      cancelAnimationFrame(frame);
      void audio.close();
    };
  }, [stream]);
  return (
    <div className="voice" role="status" aria-label="Recording">
      <canvas ref={canvas} />
      <span>{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</span>
    </div>
  );
}

// the model, effort, speed and memory mode of the chat, behind one pill
function Knobs({ shut }: { shut: () => void }): ReactNode {
  const knobs = useKi((s) => s.knobs);
  const talk = useKi((s) => s.talk);
  const used = talk === null ? 0 : View.talk_percent(talk);
  return (
    <>
      <button type="button" className="veil" aria-label="Close" onClick={shut} />
      <div className="sheet gl" role="menu" aria-label="Model and memory">
        {knobs.filter((k) => k.choices.length > 1).map((k) => (
          <section key={k.move}>
            <h3>{k.move}</h3>
            <div className={k.move === "model" ? "list" : "seg"}>
              {k.choices.map((c) => (
                <span key={c.to} className="contents">
                  {c.vendor === null ? null : <p>{c.vendor}</p>}
                  <button type="button" role="menuitemradio" aria-checked={c.here} aria-pressed={c.here} onClick={() => { c.here || act({ $: "Move", move: c.move, to: c.to }); k.move === "model" && shut(); }}>
                    <span>{c.text}</span>
                    {c.here && k.move === "model" ? <CheckIcon size={17} weight="bold" /> : null}
                  </button>
                </span>
              ))}
            </div>
          </section>
        ))}
        <section>
          <h3>memory</h3>
          <div className="seg">
            {MODES.map(([name], k) => (
              <button key={name} type="button" role="menuitemradio" aria-checked={(talk !== null) === (k === 1)} aria-pressed={(talk !== null) === (k === 1)} onClick={() => (talk !== null) === (k === 1) || act({ $: "Talk", on: k === 1 })}>{name}</button>
            ))}
          </div>
          <p className="hint">{MODES[talk === null ? 0 : 1][1]}{talk === null ? "" : " Context " + used + "% used."}</p>
        </section>
      </div>
    </>
  );
}

export function Composer({ agent, name }: { agent: string; name: string }): ReactNode {
  const stoppable = useKi((s) => s.stoppable);
  const knobs = useKi((s) => s.knobs);
  const page = useKi((s) => s.page);
  const hearing = useKi((s) => s.hearing);
  const draft = "ki.draft." + agent;
  const [text, setText] = useState(() => sessionStorage.getItem(draft) ?? "");
  const [items, setItems] = useState<Item[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [menu, setMenu] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const ups = useRef(new Map<number, XMLHttpRequest>());
  const rec = useRef<MediaRecorder | null>(null);
  const after = useRef(false);
  const blank = text.trim() === "" && items.length === 0;
  const lossy = stream !== null || items.length > 0;
  useEffect(() => {
    holds("box", lossy);
    return () => holds("box", false);
  }, [lossy]);
  const hint = name === "" ? View.HINT : "Message " + name;
  const pill = knobs.slice(0, 2).map((k) => k.text).join(" · ");

  const type = (next: string) => {
    setText(next);
    sessionStorage.setItem(draft, next);
  };

  const send = (now: Item[] = items) => {
    if (now.some((i) => i.state === "bad")) {
      after.current = false;
      note(FAILED);
      return;
    }
    if (now.some((i) => i.state === "up")) {
      after.current = true;
      note("Sends once uploaded.");
      return;
    }
    after.current = false;
    const said = [text.trim(), now.map(md_of).join("\n")].filter((t) => t !== "").join("\n\n");
    act({ $: "Send", text: said }, () => setText((t) => (t.trim() === "" ? said : t)));
    now.forEach((i) => i.peek !== "" && URL.revokeObjectURL(i.peek));
    type("");
    setItems([]);
  };

  const change = (key: number, to: Partial<Item>) => {
    setItems((all) => {
      const next = all.map((i) => (i.key === key ? { ...i, ...to } : i));
      if (after.current && next.every((i) => i.state === "ok")) {
        queueMicrotask(() => send(next));
      }
      return next;
    });
  };

  const attach = (files: File[]) => {
    const added = files.map((f): Item => {
      const ext = View.media_ext(f.name);
      const kind = ext !== "" ? View.ext_kind(ext) ?? "file" : f.type.startsWith("image/") ? "image" : "file";
      return { key: ++KEYS, name: f.name.replace(/[[\]\\\n]/g, "") || "file", kind, size: f.size, state: "up", part: 0, url: "", peek: kind === "image" ? URL.createObjectURL(f) : "" };
    });
    setItems((all) => [...all, ...added]);
    added.forEach((item, k) => {
      const xhr = new XMLHttpRequest();
      ups.current.set(item.key, xhr);
      xhr.open("POST", "/api/media?agent=" + encodeURIComponent(agent) + "&name=" + encodeURIComponent(files[k].name));
      xhr.upload.onprogress = (ev) => change(item.key, { part: ev.lengthComputable ? ev.loaded / ev.total : 0 });
      xhr.onloadend = () => {
        if (ups.current.get(item.key) !== xhr) {
          return;
        }
        ups.current.delete(item.key);
        const out = answer_of(xhr);
        if ("error" in out) {
          note(out.error);
        }
        change(item.key, "url" in out ? { state: "ok", url: out.url } : { state: "bad" });
      };
      xhr.send(files[k]);
    });
  };

  const drop = (item: Item) => {
    ups.current.get(item.key)?.abort();
    ups.current.delete(item.key);
    item.peek !== "" && URL.revokeObjectURL(item.peek);
    setItems((all) => all.filter((i) => i.key !== item.key));
  };

  const heard = (said: string) => {
    const el = area.current;
    const at = el?.selectionStart ?? text.length;
    const gap = /\S$/.test(text.slice(0, at)) ? " " : "";
    type(text.slice(0, at) + gap + said + text.slice(el?.selectionEnd ?? at));
    el?.focus();
  };

  const mic = async () => {
    if (rec.current !== null) {
      rec.current.stop();
      return;
    }
    const got = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
    if (got === null) {
      note("Ki can't use the microphone.");
      return;
    }
    const made = new MediaRecorder(got, { mimeType: ["audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) });
    const parts: Blob[] = [];
    made.ondataavailable = (ev) => parts.push(ev.data);
    made.onstop = () => {
      got.getTracks().forEach((track) => track.stop());
      rec.current = null;
      setStream(null);
      void voice(new Blob(parts, { type: made.mimeType })).then((out) => {
        const said = out.text?.trim() ?? "";
        said === "" ? note(out.error ?? "No words heard.") : heard(said);
      });
    };
    made.start();
    rec.current = made;
    setStream(got);
  };

  const key = (ev: KeyboardEvent) => {
    if (ev.key === "Enter" && !ev.shiftKey && !TOUCH && !ev.nativeEvent.isComposing) {
      ev.preventDefault();
      send();
    }
  };

  const paste = (ev: ClipboardEvent) => {
    if (ev.clipboardData.files.length > 0) {
      ev.preventDefault();
      attach([...ev.clipboardData.files]);
    }
  };

  useEffect(() => {
    const over = (ev: DragEvent) => ev.preventDefault();
    const dropped = (ev: DragEvent) => {
      ev.preventDefault();
      const files = [...(ev.dataTransfer?.files ?? [])];
      files.length > 0 && attach(files);
    };
    document.addEventListener("dragover", over);
    document.addEventListener("drop", dropped);
    return () => {
      document.removeEventListener("dragover", over);
      document.removeEventListener("drop", dropped);
    };
  });

  return (
    <form className={"box gl" + (stream === null ? "" : " rec")} onSubmit={(ev) => { ev.preventDefault(); send(); }} onMouseDown={hold}>
      {menu ? <Knobs shut={() => setMenu(false)} /> : null}
      {items.length === 0 ? null : (
        <ul>
          {items.map((item) => (
            <li key={item.key} data-state={item.state} title={item.name} style={{ "--part": Math.round(item.part * 100) + "%" } as React.CSSProperties}>
              {item.peek !== "" ? <img src={item.peek} alt={item.name} onClick={(ev) => viewer_open(ev.currentTarget)} /> : item.state === "bad" ? <WarningIcon size={18} weight="fill" /> : <FileIcon size={18} />}
              <span>
                <b>{item.name}</b>
                <small>{item.state === "up" ? Math.round(item.part * 100) + "%" : item.state === "bad" ? "Failed" : View.size_show(item.size)}</small>
              </span>
              <button type="button" aria-label={"Remove " + item.name} onClick={() => drop(item)}><XIcon size={14} weight="bold" /></button>
            </li>
          ))}
        </ul>
      )}
      {stream === null
        ? <textarea ref={area} rows={1} placeholder={hint} aria-label={hint} enterKeyHint={TOUCH ? "enter" : "send"} value={text} onChange={(ev) => type(ev.target.value)} onKeyDown={key} onPaste={paste} />
        : <Meter stream={stream} />}
      <div>
        <button type="button" aria-label="Attach files" onClick={() => file.current?.click()}><PlusIcon size={21} weight="bold" /></button>
        <input ref={file} type="file" multiple hidden onChange={(ev) => { attach([...(ev.target.files ?? [])]); ev.target.value = ""; }} />
        {pill === "" ? <span className="grow" /> : page === null
          ? <button type="button" className="knob" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>{pill}</button>
          : <span className="knob">{pill}</span>}
        <button type="button" className={stream === null ? "" : "live"} aria-label={stream === null ? "Dictate" : "Stop recording"} aria-pressed={stream !== null} disabled={hearing} onClick={() => void mic()}>
          {stream === null ? <MicrophoneIcon size={21} /> : <StopIcon size={17} weight="fill" />}
        </button>
        {blank && stoppable
          ? <button type="submit" className="snd" aria-label="Stop"><StopIcon size={18} weight="fill" /></button>
          : <button type="submit" className="snd" aria-label="Send" disabled={blank}><ArrowUpIcon size={20} weight="bold" /></button>}
      </div>
    </form>
  );
}
