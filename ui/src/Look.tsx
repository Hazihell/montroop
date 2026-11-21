import { CaretLeftIcon, CheckIcon } from "@phosphor-icons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type CSSProperties, type ReactNode } from "react";
import { text_of } from "../../Json.ts";
import * as View from "../../View.ts";
import { Avatar, BODIES, DETAILS, look_of, look_text, Outline, PICKS, type Look as Drawn, type Mood } from "./Avatar.tsx";
import { MOODS, useKi } from "./Ki.ts";

type Part = keyof typeof PICKS;
type Swatch = CSSProperties & { "--s": string };

const PARTS: Array<[Part, string]> = [["shape", "Shape"], ["eyes", "Eyes"], ["glasses", "Glasses"], ["extra", "Extras"]];
const TRY: Mood[] = ["idle", "thinking", "working", "writing", "asking", "done", "sleeping"];

type Saved = { id: string; name: string; about: string; prompt: string };

// the agent's other fields go back as they are: the server takes an agent whole
async function save(agent: string, look: Drawn): Promise<string> {
  const res = await fetch("/api/agents").catch(() => null);
  const all = res?.ok === true ? ((await res.json().catch(() => null)) as { agents: Saved[] } | null) : null;
  const a = all?.agents.find((x) => x.id === agent);
  if (a === undefined) {
    return "Could not read the agent. Try again in a moment.";
  }
  const out = await View.post("/api/agents/" + agent, { name: a.name, about: a.about, prompt: a.prompt, picture: look_text(look) });
  return out.error === undefined ? "" : text_of(out.error, "Could not save the look.");
}

function Colors({ list, on, pick, label }: { list: string[]; on: string; pick: (hex: string) => void; label: string }): ReactNode {
  return (
    <div className="swatches px-4" role="group" aria-label={label}>
      {list.map((hex) => <button key={hex} type="button" aria-label={label + " #" + hex} aria-pressed={hex === on} onClick={() => pick(hex)}><i style={{ "--s": "#" + hex } as Swatch} /></button>)}
    </div>
  );
}

// the avatar's editor, opened once the agent is known: every pick shows on
// the big one at once, in the mood chosen to try it
function Editor({ agent, mate }: { agent: string; mate: View.Mate }): ReactNode {
  const navigate = useNavigate();
  const [look, setLook] = useState(() => look_of(mate.picture, agent));
  const [mood, setMood] = useState<Mood>("idle");
  const [part, setPart] = useState<Part>("shape");
  const [saving, setSaving] = useState(false);
  const done = () => {
    setSaving(true);
    void save(agent, look).then((error) => {
      setSaving(false);
      if (error === "") {
        void navigate({ to: "/a/$agent", params: { agent } });
      } else {
        useKi.setState({ note: error });
      }
    });
  };
  return (
    <section className="page">
      <header className="head pl-3.5">
        <Link to="/a/$agent" params={{ agent }} className="round gl" aria-label="Back to the chat"><CaretLeftIcon size={22} weight="bold" /></Link>
        <h1 className="truncate pl-1.5">{mate.name}</h1>
        <button type="button" className="round go" aria-label="Save the look" disabled={saving} onClick={done}><CheckIcon size={22} weight="bold" /></button>
      </header>
      <div className="scroll pb-6">
        <div className="mx-auto flex max-w-xl flex-col">
          <div className="grid place-items-center pt-6 pb-4"><Avatar look={look} mood={mood} size={200} lit /></div>
          <div className="flex gap-1.5 overflow-x-auto px-3.5 pb-1 [scrollbar-width:none]" role="group" aria-label="Try a mood">
            {TRY.map((m) => <button key={m} type="button" className={"pillbtn min-h-11 shrink-0 px-4 text-[0.9375rem]" + (m === mood ? " go" : "")} aria-pressed={m === mood} onClick={() => setMood(m)}>{MOODS[m] === "" ? "Idle" : MOODS[m]}</button>)}
          </div>
          <div className="seg gl mx-3.5 mt-5">
            {PARTS.map(([key, text]) => <button key={key} type="button" aria-pressed={key === part} onClick={() => setPart(key)}>{text}</button>)}
          </div>
          <div className="picks mx-3.5 mt-3">
            {PICKS[part].map((pick) => (
              <button key={pick} type="button" aria-label={pick} aria-pressed={look[part] === pick} onClick={() => setLook({ ...look, [part]: pick })}>
                {part === "shape" ? <Outline shape={pick} size={48} /> : <Avatar look={{ ...look, [part]: pick }} size={50} />}
              </button>
            ))}
          </div>
          <h2 className="label">Body</h2>
          <Colors list={BODIES} on={look.c} pick={(c) => setLook({ ...look, c })} label="Body color" />
          <h2 className="label">Detail</h2>
          <Colors list={DETAILS} on={look.c2} pick={(c2) => setLook({ ...look, c2 })} label="Detail color" />
        </div>
      </div>
    </section>
  );
}

export function Look({ agent }: { agent: string }): ReactNode {
  const mate = useKi((s) => s.team.find((m) => m.id === agent));
  return mate === undefined ? <section className="page" /> : <Editor key={agent} agent={agent} mate={mate} />;
}
