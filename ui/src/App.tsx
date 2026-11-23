import { XIcon } from "@phosphor-icons/react";
import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Outlet, redirect, useLocation, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import * as View from "../../View.ts";
import { Avatar, Face, look_of } from "./Avatar.tsx";
import { Composer } from "./Composer.tsx";
import { intro_end, MOODS, mood_of, noted, show, useKi, welcomed } from "./Ki.ts";
import { Back, turn, TURNS, useBack, useEdgeBack } from "./Back.tsx";
import { Agents, Memory, Running, usePop } from "./Pages.tsx";
import { Panel, Sheet, useGoing } from "./Panel.tsx";
import { panel_set, usePrefs } from "./Prefs.ts";
import { Timeline } from "./Timeline.tsx";
import { Viewer } from "./Viewer.tsx";

// the pages few visits open come when first opened
const Importer  = lazy(() => import("./Importer.tsx"));
const AgentPage = lazyRouteComponent(() => import("./Agent.tsx"), "AgentPage");
const Look      = lazyRouteComponent(() => import("./Look.tsx"), "Look");
const Grown     = lazyRouteComponent(() => import("./Grown.tsx"), "Grown");
const Settings  = lazyRouteComponent(() => import("./Settings.tsx"), "Settings");

const NOTE = 6000;
// the intro's two scenes, then its fade
const INTRO = 3050;
const FADE = 600;

function SignIn(): ReactNode {
  return (
    <form className="m-auto flex w-full max-w-sm flex-col items-start gap-3 p-6" method="post" action="/auth">
      <Avatar look={look_of("", "ki")} mood="asking" size={104} lit />
      <h1 className="text-4xl font-extrabold tracking-tight">Sign in</h1>
      <p className="text-mid">This Ki server is private. On the computer it runs on, run <code className="font-mono text-[0.84em]">ki serve login</code> and type the code it prints here.</p>
      <input type="hidden" name="to" value={location.pathname} />
      <input className="field text-center font-mono text-xl tracking-[0.3em]" name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus aria-label="Sign-in code" />
      <button type="submit" className="pillbtn go w-full">Sign in</button>
    </form>
  );
}

function Wait(): ReactNode {
  return <div className="grid flex-1 place-items-center"><p className="wait" role="status" aria-label="Loading"><i /><i /><i /></p></div>;
}

function Note(): ReactNode {
  const note = useKi((s) => s.note);
  const stale = useKi((s) => s.stale);
  useEffect(() => {
    const timer = note === "" || stale ? undefined : setTimeout(noted, NOTE);
    return () => clearTimeout(timer);
  }, [note, stale]);
  if (note === "") {
    return null;
  }
  return (
    <p role="status" className="toast gl">
      <span className="min-w-0 flex-1">{note}</span>
      {stale ? <button type="button" className="pillbtn go min-h-9 px-4 text-[0.875rem]" onClick={() => location.reload()}>Reload</button> : null}
      <button type="button" className="round small" aria-label="Dismiss" onClick={noted}><XIcon size={16} weight="bold" /></button>
    </p>
  );
}

// the first open of this browser: what Ki is, in two scenes, gone at a tap
function Intro(): ReactNode {
  const on = useKi((s) => s.intro);
  const [out, setOut] = useState(false);
  useEffect(() => {
    if (!on) {
      return undefined;
    }
    const end = () => {
      setOut(true);
      setTimeout(intro_end, FADE);
    };
    const timer = setTimeout(end, INTRO);
    window.addEventListener("keydown", end);
    window.addEventListener("pointerdown", end);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", end);
      window.removeEventListener("pointerdown", end);
    };
  }, [on]);
  if (!on) {
    return null;
  }
  return (
    <div className={"intro" + (out ? " out" : "")}>
      <div><p>Your entire life.</p><p>One single chat.</p></div>
      <div><Avatar look={look_of("", "ki")} mood="idle" size={88} lit /><h1>Ki</h1></div>
    </div>
  );
}

// a screen wide enough for the list beside the open chat, and one wider
// still for the agent's own column beside that
const WIDE = matchMedia("(min-width: 64rem)");
const WIDER = matchMedia("(min-width: 80rem)");

function useMedia(query: MediaQueryList): boolean {
  const on = useCallback((then: () => void) => {
    query.addEventListener("change", then);
    return () => query.removeEventListener("change", then);
  }, [query]);
  return useSyncExternalStore(on, () => query.matches);
}

// where the ground's lamps sit for each screen
function lamps(path: string): string {
  const own = /^\/a\/[^/]+\/(running|memory|tree)\b/.exec(path)?.[1];
  return own === "tree" ? "memory" : own ?? (/^\/a\/[^/]+(\/s\/[^/]+)?$/.test(path) ? "chat" : "team");
}

// the view transition's own animations, once they have started: a phone
// can hold them a while after the transition is ready
function turned(): Promise<unknown> {
  return Promise.all(document.getAnimations().filter((a) => a.effect instanceof KeyframeEffect && a.effect.pseudoElement?.startsWith("::view-transition") === true).map((a) => a.ready));
}

// the lamps set off with the page's move: the router shows the next place
// before it has the page, and takes the page in inside its view transition,
// which holds the screen meanwhile; lamps set off before its animations
// start would show far along their way, or at its end, at its first frame
function useLamps(el: HTMLElement | null): void {
  const router = useRouter();
  useLayoutEffect(() => el?.setAttribute("data-at", lamps(router.state.location.pathname)), [el, router]);
  useEffect(() => {
    if (el === null) {
      return undefined;
    }
    let last = 0;
    return router.subscribe("onLoad", ({ toLocation }) => {
      const now = ++last;
      const move = () => {
        if (now === last) {
          el.setAttribute("data-at", lamps(toLocation.pathname));
        }
      };
      const turning = document.activeViewTransition as ViewTransition | null | undefined;
      if (turning === null || turning === undefined) {
        move();
      } else {
        turning.ready.then(turned).then(move, move);
      }
    });
  }, [el, router]);
}

// no bar of places: the list is home, and all about one agent opens from
// its chat
function Shell(): ReactNode {
  const signed = useKi((s) => s.signed);
  const path = useLocation().pathname;
  const wide = useMedia(WIDE);
  const split = wide && (path === "/" || path.startsWith("/a/") || path === "/new");
  const [aurora, setAurora] = useState<HTMLElement | null>(null);
  useLamps(aurora);
  if (signed === null) {
    return null;
  }
  return (
    <div className={"shell" + (split ? " split" : "")}>
      <div ref={setAurora} className="aurora"><i /><i /><i /></div>
      {signed ? <>{split ? <aside className="side"><Agents side /></aside> : null}<Outlet /></> : <div className="flex h-full"><SignIn /></div>}
      <Note />
      <Viewer />
      <Intro />
    </div>
  );
}

// Ki opens on the agents; a wide screen has them beside, and here what to do
function Home(): ReactNode {
  const wide = useMedia(WIDE);
  const any = useKi((s) => s.team.some((m) => m.archived === 0));
  if (!wide) {
    return <Agents />;
  }
  return (
    <section className="page">
      <div className="m-auto grid max-w-xs justify-items-center gap-3 p-6 text-center">
        <Avatar look={look_of("", "ki")} mood="idle" size={88} lit />
        <p className="text-mid">{any ? "Pick an agent to open its chat." : "Make your first agent with the + button."}</p>
      </div>
    </section>
  );
}

function Tree({ agent }: { agent: string }): ReactNode {
  return <Grown agent={agent} view={useLocation().hash === "view"} />;
}

// what is shown stays drawn, leaving, after it closes, until it says it
// is gone
function useLeaving(on: boolean): ["on" | "leaving" | false, () => void] {
  const [kept, setKept] = useState(on);
  if (on && !kept) {
    setKept(true);
  }
  const gone = useCallback(() => setKept(false), []);
  return [on ? "on" : kept ? "leaving" : false, gone];
}

// the agent's sheet is a step in the history, so the phone's back closes it
function useSheet(agent: string): [boolean, () => void, () => void] {
  const open = useSearch({ strict: false, select: (s: { about?: 1 }) => s.about === 1 });
  const navigate = useNavigate();
  const router = useRouter();
  const show_it = useCallback(() => void navigate({ to: "/a/$agent", params: { agent }, search: { about: 1 } }), [navigate, agent]);
  const hide = useCallback(() => {
    if ((router.history.location.state as { __TSR_index?: number }).__TSR_index !== 0) {
      router.history.back();
    } else {
      void navigate({ to: "/a/$agent", params: { agent }, search: {}, replace: true });
    }
  }, [router, navigate, agent]);
  return [open, show_it, hide];
}

// an agent's chat, or the page of a subagent it spawned: what that one
// does, read only
function Chat({ agent, sub }: { agent: string; sub: string | null }): ReactNode {
  const navigate = useNavigate();
  const mate = useKi((s) => s.team.find((m) => m.id === agent));
  const loaded = useKi((s) => s.loaded && s.agent === agent && s.page === sub);
  const mood = useKi((s) => (sub !== null ? s.mood : mate === undefined ? "idle" : mood_of(mate, s)));
  const offline = useKi((s) => s.offline);
  const row = useKi((s) => s.sub);
  const meter = useKi((s) => s.meter);
  const knobs = useKi((s) => s.knobs);
  const welcome = useKi((s) => s.welcome);
  const [head, setHead] = useState<HTMLElement | null>(null);
  const [page, setPage] = useState<HTMLElement | null>(null);
  const back = useBack(sub === null ? "/" : "/a/" + agent);
  const wider = useMedia(WIDER);
  const shown = usePrefs((s) => s.panel);
  const going = useGoing(agent);
  const pop = usePop(going, agent);
  const [sheet, openSheet, closeSheet] = useSheet(agent);
  const [drawn, gone] = useLeaving(sheet && !wider && sub === null);
  const panel = wider && shown && sub === null;
  useEdgeBack(page, back);
  useEffect(() => {
    show(agent, sub);
    return () => show(null);
  }, [agent, sub]);
  // the server shows another agent's chat when it has none of this one
  useEffect(() => useKi.subscribe((s) => {
    if (s.loaded && s.agent !== agent) {
      void navigate({ to: "/a/$agent", params: { agent: s.agent }, replace: true });
    }
  }), [agent, navigate]);
  const doing = offline ? "Offline" : sub === null ? MOODS[mood] : row === null ? "Done" : row.doing;
  return (
    <section ref={setPage} className={"page swipe" + (panel ? " paned" : "")}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <header className="top">
          <Back to={sub === null ? "/" : "/a/" + agent} label={sub === null ? "Back to the agents" : "Back to " + (mate?.name ?? "the chat")} className={sub === null ? "back" : ""} />
          {sub === null ? (
            <button type="button" className="isl" aria-expanded={wider ? panel : sheet} aria-label={(mate?.name ?? "This agent") + ": what runs, its memory and settings"} onClick={() => (wider ? panel_set(!shown) : openSheet())}>
              <span className="relative">
                <Face picture={mate?.picture ?? ""} id={agent} mood={mood} size={56} />
                {going > 0 ? <em key={going} className={"count" + pop} aria-label={going + " at work"}>{going}</em> : null}
              </span>
              <b>{mate?.name ?? ""}</b>
              {doing === "" ? null : <span>{doing}</span>}
            </button>
          ) : (
            <p className="isl">
              <Avatar look={look_of("", agent + "/" + sub)} mood={mood} size={56} />
              <b>{sub}</b>
              {doing === "" ? null : <span>{doing}</span>}
            </p>
          )}
          <span ref={setHead} className="top-end" />
        </header>
        {loaded ? <Timeline key={agent + "/" + (sub ?? "")} sub={sub !== null} head={head} /> : <Wait />}
        {welcome && sub === null ? <Suspense><Importer agent={agent} shut={welcomed} /></Suspense> : null}
        {sub === null ? <Composer key={agent} agent={agent} name={mate?.name ?? ""} /> : (
          <p className="under">
            {knobs.map((k) => k.text).join(" · ")}
            {meter === null ? "" : " · context " + View.talk_percent(meter) + "%"}
          </p>
        )}
      </div>
      {panel ? <Panel agent={agent} /> : null}
      {drawn === false ? null : <Sheet agent={agent} close={closeSheet} leaving={drawn === "leaving"} gone={gone} />}
    </section>
  );
}

// the agent the owner had open last, for an old link with no agent in it
const last = (): string => useKi.getState().agent;
const own = (where: "running" | "memory" | "tree", hash?: string) => () => {
  const agent = last();
  if (agent === "") {
    redirect({ to: "/", replace: true, throw: true });
  }
  redirect({ to: "/a/$agent/" + where, params: { agent }, hash, replace: true, throw: true });
};

const root     = createRootRoute({ component: Shell });
const home     = createRoute({ getParentRoute: () => root, path: "/", component: Home });
const chat     = createRoute({ getParentRoute: () => root, path: "/a/$agent", validateSearch: (s): { about?: 1 } => (s.about === 1 || s.about === "1" ? { about: 1 } : {}), component: () => <Chat agent={chat.useParams().agent} sub={null} /> });
const sub      = createRoute({ getParentRoute: () => root, path: "/a/$agent/s/$name", component: () => <Chat agent={sub.useParams().agent} sub={sub.useParams().name} /> });
const fresh    = createRoute({ getParentRoute: () => root, path: "/new", component: () => <AgentPage agent={null} /> });
const edit     = createRoute({ getParentRoute: () => root, path: "/a/$agent/edit", component: () => <AgentPage agent={edit.useParams().agent} /> });
const look     = createRoute({ getParentRoute: () => root, path: "/a/$agent/look", component: () => <Look agent={look.useParams().agent} /> });
const running  = createRoute({ getParentRoute: () => root, path: "/a/$agent/running", component: () => <Running agent={running.useParams().agent} /> });
const memory   = createRoute({ getParentRoute: () => root, path: "/a/$agent/memory", component: () => <Memory agent={memory.useParams().agent} /> });
const tree     = createRoute({ getParentRoute: () => root, path: "/a/$agent/tree", component: () => <Tree agent={tree.useParams().agent} /> });
// where these were before they became each agent's own, and the list home
const runningOld = createRoute({ getParentRoute: () => root, path: "/running", beforeLoad: own("running") });
const memoryOld  = createRoute({ getParentRoute: () => root, path: "/memory", beforeLoad: own("memory") });
const treeOld    = createRoute({ getParentRoute: () => root, path: "/tree", beforeLoad: ({ search, location }) => {
  const a = (search as { a?: unknown }).a;
  if (typeof a === "string" && a !== "") {
    redirect({ to: "/a/$agent/tree", params: { agent: a }, hash: location.hash, replace: true, throw: true });
  }
  own("tree", location.hash)();
} });
const team     = createRoute({ getParentRoute: () => root, path: "/team", beforeLoad: () => redirect({ to: "/", replace: true, throw: true }) });
const settings = createRoute({ getParentRoute: () => root, path: "/settings", component: Settings });

export const router = createRouter({ routeTree: root.addChildren([home, chat, sub, fresh, edit, look, running, memory, tree, runningOld, memoryOld, treeOld, team, settings]), defaultViewTransition: TURNS && { types: turn } });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
