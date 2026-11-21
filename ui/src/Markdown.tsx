import { CheckIcon, CopyIcon, PaperclipIcon } from "@phosphor-icons/react";
import { useState, type CSSProperties, type ReactNode } from "react";
import * as Md from "../../Md.ts";
import * as View from "../../View.ts";

const COPIED = 1500;

export function Copy({ text }: { text: string }): ReactNode {
  const [done, setDone] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setDone(true);
      setTimeout(() => setDone(false), COPIED);
    });
  };
  return (
    <button type="button" className="copy" aria-label={done ? "Copied" : "Copy"} onClick={copy}>
      {done ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
    </button>
  );
}

function Chip({ url, name }: { url: string; name: string }): ReactNode {
  const shown = name.trim() || (url.split("/").pop() ?? "");
  return (
    <a className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-raise px-3 py-1.5 text-sm" href={url} download={shown}>
      <PaperclipIcon size={16} className="shrink-0 text-dim" />
      <span className="truncate">{shown}</span>
    </a>
  );
}

function Pict({ s }: { s: Extract<Md.Span, { $: "Pict" }> }): ReactNode {
  const title = s.t === "" ? undefined : s.t;
  switch (View.media_kind(s.k)) {
    case "image": {
      return <a href={s.k} target="_blank" rel="noopener"><img className="media" src={s.k} alt={s.x} title={title} loading="lazy" /></a>;
    }
    case "video": {
      return <video className="media" src={s.k} title={title} controls preload="metadata" />;
    }
    case "audio": {
      return <audio className="w-full" src={s.k} title={title} controls preload="metadata" />;
    }
    case "html": {
      return <iframe className="media h-96 w-full" src={s.k} title={s.t || s.x} sandbox="allow-same-origin allow-popups" loading="lazy" />;
    }
    default: {
      return View.store_file(s.k) ? <Chip url={s.k} name={s.x} /> : <a href={s.k} title={title} target="_blank" rel="noopener">{s.x || s.k}</a>;
    }
  }
}

function Spans({ x }: { x: Md.Span[] }): ReactNode {
  return x.map((s, k) => {
    switch (s.$) {
      case "Text": {
        return s.x;
      }
      case "Code": {
        return <code key={k}>{s.x}</code>;
      }
      case "Bold": {
        return <strong key={k}><Spans x={s.x} /></strong>;
      }
      case "Ital": {
        return <em key={k}><Spans x={s.x} /></em>;
      }
      case "Strk": {
        return <del key={k}><Spans x={s.x} /></del>;
      }
      case "Link": {
        return View.store_file(s.k)
          ? <Chip key={k} url={s.k} name={Md.spans_text(s.x)} />
          : <a key={k} href={s.k} title={s.t === "" ? undefined : s.t} target="_blank" rel="noopener"><Spans x={s.x} /></a>;
      }
      case "Pict": {
        return <Pict key={k} s={s} />;
      }
      case "Brk": {
        return <br key={k} />;
      }
    }
  });
}

function Numbered({ head, width, children }: { head: ReactNode; width: number; children: ReactNode }): ReactNode {
  return (
    <pre className="numbered" style={{ "--nw": width + "ch" } as CSSProperties}>
      <span className="lang">{head}</span>
      <code>{children}</code>
    </pre>
  );
}

function Diff({ b }: { b: Extract<Md.Block, { $: "Diff" }> }): ReactNode {
  const all  = b.x.flat();
  const adds = all.filter((l) => l.s === "+").length;
  const dels = all.filter((l) => l.s === "-").length;
  const head = <>{b.k} <b className="text-ok">+{adds}</b> <b className="text-bad">−{dels}</b></>;
  return (
    <Numbered head={head} width={all.reduce((w, l) => Math.max(w, String(l.n).length), 0)}>
      {b.x.map((hunk, h) => (
        <span key={h} className={h === 0 ? "contents" : "hunk"}>
          {hunk.map((l, k) => <span key={k} className={l.s === "+" ? "add" : l.s === "-" ? "del" : ""}><i>{l.n}</i>{l.s} {l.x}</span>)}
        </span>
      ))}
    </Numbered>
  );
}

export function Blocks({ x, tight = false }: { x: Md.Block[]; tight?: boolean }): ReactNode {
  return x.map((b, k) => {
    switch (b.$) {
      case "Para": {
        return tight ? <Spans key={k} x={b.x} /> : <p key={k}><Spans x={b.x} /></p>;
      }
      case "Head": {
        const Tag = (["h2", "h3", "h4"] as const)[Math.min(2, b.k - 1)];
        return <Tag key={k}><Spans x={b.x} /></Tag>;
      }
      case "Code": {
        return (
          <pre key={k}>
            <span className="lang">{b.k}<Copy text={b.x} /></span>
            <code>{b.x}</code>
          </pre>
        );
      }
      case "Rule": {
        return <hr key={k} />;
      }
      case "Quot": {
        return <blockquote key={k}><Blocks x={b.x} /></blockquote>;
      }
      case "List": {
        const Tag = b.k ? "ol" : "ul";
        return (
          <Tag key={k} start={b.k && b.n !== 1 ? b.n : undefined}>
            {b.x.map((item, i) => (
              <li key={i} className={b.c[i] == null ? undefined : "task"}>
                {b.c[i] == null ? null : <input type="checkbox" disabled checked={b.c[i]} />}
                <Blocks x={item} tight={b.t} />
              </li>
            ))}
          </Tag>
        );
      }
      case "Tabl": {
        return (
          <div key={k} className="table">
            <table>
              <tbody>
                {b.x.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, c) => {
                      const Tag = i === 0 ? "th" : "td";
                      return <Tag key={c} style={{ textAlign: b.a[c] === "" ? undefined : (b.a[c] as "left" | "center" | "right") }}><Spans x={cell} /></Tag>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      case "Diff": {
        return <Diff key={k} b={b} />;
      }
      case "File": {
        return (
          <Numbered key={k} head={b.k} width={String(b.n + b.x.length - 1).length}>
            {b.x.map((line, i) => <span key={i}><i>{b.n + i}</i>{line}</span>)}
          </Numbered>
        );
      }
    }
  });
}
