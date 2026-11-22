import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { err_why } from "../../Err.ts";
import { text_of } from "../../Json.ts";
import * as View from "../../View.ts";
import { Archived } from "./Agent.tsx";
import { act, note, signed_out, useKi } from "./Ki.ts";
import { Owned } from "./Owned.tsx";
import { ACCENTS, prefs_set, usePrefs, type Theme } from "./Prefs.ts";
import { push_state, push_sub, push_turn, type Bell, type Notify } from "./Push.ts";

type Swatch = CSSProperties & { "--s": string };

const THEMES: Array<[Theme, string]> = [["system", "Auto"], ["dark", "Dark"], ["light", "Light"]];

const BELL: Record<Notify, string> = {
  off     : "Replies on this device, when Ki isn't open.",
  on      : "Replies on this device, when Ki isn't open.",
  blocked : "Blocked in this browser's settings for this site.",
  home    : "On iPhone and iPad: Share, then Add to Home Screen, and open it from there.",
};

// this device's notifications, turned on and off here
function Bell(): ReactNode {
  const [bell, setBell] = useState<Bell | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void push_state().catch(() => null).then(setBell);
  }, []);
  if (bell === null) {
    return null;
  }
  const push = bell.push;
  const turn = () => {
    if (push === null) {
      return;
    }
    const what = bell.state === "on" ? "off" : "on";
    setBusy(true);
    void push_turn(what === "on", push).then((out) => note(out.error === undefined ? "Notifications are " + what + "." : "Could not turn notifications " + what + ": " + text_of(out.error)), (err: unknown) => note("Could not turn notifications " + what + ": " + err_why(err))).then(push_state).catch(() => null).then((next) => {
      setBell(next);
      setBusy(false);
    });
  };
  return (
    <label className="set">
      <span>Notifications<small>{BELL[bell.state]}</small></span>
      {bell.state === "home" ? null : <input type="checkbox" role="switch" className="switch" checked={bell.state === "on"} disabled={busy || bell.state === "blocked"} onChange={turn} />}
    </label>
  );
}

// the MCP servers of the devices, on or off for the chat last open
function Plugs(): ReactNode {
  const plugs = useKi((s) => s.plugs);
  const name = useKi((s) => s.team.find((m) => m.id === s.agent)?.name ?? "");
  return (
    <>
      <h2 className="label">{name === "" ? "MCP servers" : "MCP servers for " + name}</h2>
      {plugs.length === 0 ? <p className="lede">None set up. Add them as <code className="font-mono text-[0.84em]">mcp</code> in a device's own config.json: they run on that device.</p> : plugs.map((p) => (
        <label key={p.name} className="set">
          <span>{p.name}</span>
          <input type="checkbox" role="switch" className="switch" checked={p.on} onChange={() => act({ $: "Plug", name: p.name })} />
        </label>
      ))}
    </>
  );
}

export function Settings(): ReactNode {
  const accent = usePrefs((s) => s.accent);
  const theme = usePrefs((s) => s.theme);
  const out = async () => {
    await push_sub().then((sub) => sub?.unsubscribe()).catch(() => {});
    await View.post("/api/logout", {});
    signed_out();
  };
  return (
    <section className="page">
      <header className="head"><h1>Settings</h1></header>
      <div className="scroll pb-6">
        <div className="mx-auto max-w-xl">
          <h2 className="label pt-2">Accent</h2>
          <div className="swatches px-4">
            {ACCENTS.map((hex) => (
              <button key={hex} type="button" aria-label={"Accent #" + hex} aria-pressed={hex === accent} onClick={() => prefs_set({ accent: hex })}><i style={{ "--s": "#" + hex } as Swatch} /></button>
            ))}
            <label aria-label="Another color" aria-pressed={!ACCENTS.includes(accent)}>
              <i style={{ "--s": ACCENTS.includes(accent) ? "conic-gradient(#f55,#fc3,#5d5,#3cf,#75f,#f5a,#f55)" : "#" + accent } as Swatch} />
              <input type="color" className="sr-only" value={"#" + accent} onChange={(ev) => prefs_set({ accent: ev.target.value.slice(1).toLowerCase() })} />
            </label>
          </div>
          <h2 className="label">Appearance</h2>
          <div className="seg gl mx-3.5 max-w-sm">
            {THEMES.map(([value, text]) => <button key={value} type="button" aria-pressed={value === theme} onClick={() => prefs_set({ theme: value })}>{text}</button>)}
          </div>
          <h2 className="label">This device</h2>
          <Bell />
          <div className="px-3.5 pt-4"><button type="button" className="pillbtn" onClick={() => void out()}>Sign out</button></div>
          <Plugs />
          <Archived />
          <Owned />
        </div>
      </div>
    </section>
  );
}
