import { SidebarSimpleIcon, XIcon } from "@phosphor-icons/react";
import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Outlet, redirect, useLocation, useMatches, useNavigate, useRouter } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import * as View from "../../View.ts";
import { Avatar, Face, look_of } from "./Avatar.tsx";
import { Composer } from "./Composer.tsx";
import { intro_end, MOODS, mood_of, noted, show, useKunumy, welcomed } from "./Kunumy.ts";
import { Back, steps_of, turn, TURNS, useBack, useEdgeBack, useStep } from "./Back.tsx";
import { Agents, Memory, Running, useLeaving, usePop } from "./Pages.tsx";
import { Menu, Panel, useGoing } from "./Panel.tsx";
import { list_set, panel_set, usePrefs } from "./Prefs.ts";
import { Timeline } from "./Timeline.tsx";
import { Viewer } from "./Viewer.tsx";

// the pages few visits open come when first opened
const Importer  = lazy(() => import("./Importer.tsx"));
const AgentPage = lazyRouteComponent(() => import("./Agent.tsx"), "AgentPage");
const Look      = lazyRouteComponent(() => import("./Look.tsx"), "Look");
const Grown     = lazyRouteComponent(() => import("./Grown.tsx"), "Grown");
const Settings  = lazyRouteComponent(() => import("./Settings.tsx"), "Settings");
const WorkPage  = lazyRouteComponent(() => import("./Work.tsx"), "WorkPage");

const NOTE = 6000;
// the face over a chat, in px: .isl's height
const FACE = 76;
// the intro's two scenes, then its fade
const INTRO = 3050;
const FADE = 600;

function SignIn(): ReactNode {
  return (
    <form className="m-auto flex w-full max-w-sm flex-col items-start gap-3 p-6" method="post" action="/auth">
      <Avatar look={look_of("", "kunumy")} mood="asking" size={104} lit />
      <h1 className="text-4xl font-extrabold tracking-tight">Sign in</h1>
      <p className="text-mid">This Kunumy server is private. On the computer it runs on, run <code className="font-mono text-[0.84em]">kny serve login</code> and type the code it prints here.</p>
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
  const note = useKunumy((s) => s.note);
  const stale = useKunumy((s) => s.stale);
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

// the first open of this browser: what Kunumy is, in two scenes, gone at a tap
function Intro(): ReactNode {
  const on = useKunumy((s) => s.intro);
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
      <div><Avatar look={look_of("", "kunumy")} mood="idle" size={88} lit /><h1>Kunumy</h1></div>
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
  const own = /^\/a\/[^/]+\/(running|memory|tree|w)\b/.exec(path)?.[1];
  return own === "tree" ? "memory" : own === "w" ? "running" : own ?? (/^\/a\/[^/]+(\/s\/[^/]+)?$/.test(path) ? "chat" : "team");
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

const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);

// hides the agents' column and brings it back; a focus in the column as it
// goes stays on the button
function Tuck({ shown }: { shown: boolean }): ReactNode {
  const button = useRef<HTMLButtonElement>(null);
  const flip = useCallback(() => {
    const on = !usePrefs.getState().list;
    if (!on && document.getElementById("agents")?.contains(document.activeElement) === true) {
      button.current?.focus({ preventScroll: true });
    }
    list_set(on);
  }, []);
  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      if (ev.key.toLowerCase() === "b" && (MAC ? ev.metaKey : ev.ctrlKey) && !ev.altKey && !ev.shiftKey) {
        ev.preventDefault();
        ev.repeat || flip();
      }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [flip]);
  return (
    <button ref={button} type="button" className="tuck round gl" aria-label="Agents" aria-controls="agents" aria-expanded={shown} aria-keyshortcuts={MAC ? "Meta+B" : "Control+B"} title={(shown ? "Hide" : "Show") + " the agents (" + (MAC ? "⌘B" : "Ctrl+B") + ")"} onClick={flip}>
      <SidebarSimpleIcon size={22} />
    </button>
  );
}

// no bar of places: the list is home, and all about one agent opens from
// its chat
function Shell(): ReactNode {
  const signed = useKunumy((s) => s.signed);
  const path = useLocation().pathname;
  const at = useMatches({ select: (all) => all.at(-1)?.routeId });
  const wide = useMedia(WIDE);
  const listed = usePrefs((s) => s.list);
  const split = wide && (path === "/" || path.startsWith("/a/") || path === "/new");
  // with the column away the button takes the top left corner: a chat's floating
  // head has it level with its own buttons, and a page with a back button of
  // its own moves over for it
  const tucked = !split || listed ? "" : " tucked" + (at === chat.id || at === sub.id ? " headed" : "") + (at === home.id || at === chat.id ? "" : " backed");
  const [aurora, setAurora] = useState<HTMLElement | null>(null);
  useLamps(aurora);
  if (signed === null) {
    return null;
  }
  return (
    <div className={"shell" + (split ? " split" : "") + tucked}>
      <div ref={setAurora} className="aurora"><i /><i /><i /></div>
      {signed ? <>{split ? <aside id="agents" className="side" inert={!listed}><Agents side /></aside> : null}<Outlet />{split ? <Tuck shown={listed} /> : null}</> : <div className="flex h-full"><SignIn /></div>}
      <Note />
      <Viewer />
      <Intro />
    </div>
  );
}

// Kunumy opens on the agents; a wide screen has them beside, and here what to do
function Home(): ReactNode {
  const wide = useMedia(WIDE);
  const any = useKunumy((s) => s.team.some((m) => m.archived === 0));
  const listed = usePrefs((s) => s.list);
  if (!wide) {
    return <Agents />;
  }
  return (
    <section className="page">
      <div className="m-auto grid max-w-xs justify-items-center gap-3 p-6 text-center">
        <Avatar look={look_of("", "kunumy")} mood="idle" size={88} lit />
        <p className="text-mid">{!listed ? "Show the agents to open a chat." : any ? "Pick an agent to open its chat." : "Make your first agent with the + button."}</p>
      </div>
    </section>
  );
}

function Tree({ agent }: { agent: string }): ReactNode {
  return <Grown agent={agent} view={useLocation().hash === "view"} />;
}

// what a face acts out, which no word repeats beside it; idle acts out
// nothing, and its "" among them leaves no note
const ACTED = new Set(Object.values(MOODS).map((m) => m.toLowerCase()));

// the name on a glass pill over the face's chin, and after it what the face
// can't show (Kunumy offline, a subagent's tool, its usage limit, it done). The
// pill's width follows its words; a note gone stays in it, fading, as it
// narrows back to the name, which gives way first when both don't fit
function Tag({ name, note }: { name: string; note: string }): ReactNode {
  const pill = useRef<HTMLSpanElement>(null);
  const named = useRef<HTMLElement>(null);
  const told = useRef<HTMLElement>(null);
  const [said, setSaid] = useState(note);
  if (note !== "" && note !== said) {
    setSaid(note);
  }
  useLayoutEffect(() => {
    const [el, b, i] = [pill.current, named.current, told.current];
    if (el === null || b === null || i === null) {
      return undefined;
    }
    // the words' own widths, rounded down, so each gets a pixel more
    const fit = () => {
      const style = getComputedStyle(el);
      const full = Math.ceil(parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth) + b.scrollWidth + 1 + (note === "" ? 0 : i.scrollWidth + 1));
      const most = parseFloat(style.maxWidth);
      el.style.width = Math.min(full, most) + "px";
      el.classList.toggle("long", note !== "" && full > most);
    };
    fit();
    let on = true;
    void document.fonts.ready.then(() => on && fit());
    addEventListener("resize", fit);
    return () => {
      on = false;
      removeEventListener("resize", fit);
    };
  }, [name, note, said]);
  return (
    <span ref={pill} className="tag">
      <b ref={named}>{name}</b>
      <i ref={told} className={(note === "" ? "" : "on") + (said === "Offline" ? " off" : "")}>{said}</i>
    </span>
  );
}

// an agent's chat, or the page of a subagent it spawned: what that one
// does, read only
function Chat({ agent, sub }: { agent: string; sub: string | null }): ReactNode {
  const navigate = useNavigate();
  const mate = useKunumy((s) => s.team.find((m) => m.id === agent));
  const loaded = useKunumy((s) => s.loaded && s.agent === agent && s.page === sub);
  const mood = useKunumy((s) => (sub !== null ? s.mood : mate === undefined ? "idle" : mood_of(mate, s)));
  const offline = useKunumy((s) => s.offline);
  const row = useKunumy((s) => s.sub);
  const meter = useKunumy((s) => s.meter);
  const knobs = useKunumy((s) => s.knobs);
  const welcome = useKunumy((s) => s.welcome);
  const [head, setHead] = useState<HTMLElement | null>(null);
  const [page, setPage] = useState<HTMLElement | null>(null);
  const back = useBack(sub === null ? "/" : "/a/" + agent);
  const wider = useMedia(WIDER);
  const shown = usePrefs((s) => s.panel);
  const going = useGoing(agent);
  const pop = usePop(going, agent);
  const [menu, openMenu, closeMenu] = useStep(agent, "about");
  const [drawn, gone] = useLeaving(menu && !wider && sub === null);
  const [face, setFace] = useState<HTMLButtonElement | null>(null);
  const panel = wider && shown && sub === null;
  useEdgeBack(page, back);
  useEffect(() => {
    show(agent, sub);
    return () => show(null);
  }, [agent, sub]);
  // the server shows another agent's chat when it has none of this one
  useEffect(() => useKunumy.subscribe((s) => {
    if (s.loaded && s.agent !== agent) {
      void navigate({ to: "/a/$agent", params: { agent: s.agent }, replace: true });
    }
  }), [agent, navigate]);
  const doing = offline ? "Offline" : sub === null ? MOODS[mood] : row === null ? "Done" : row.doing;
  const note = offline || (sub !== null && !ACTED.has(doing.toLowerCase())) ? doing : "";
  return (
    <section ref={setPage} className={"page swipe" + (panel ? " paned" : "")}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <header className="top">
          <Back to={sub === null ? "/" : "/a/" + agent} label={sub === null ? "Back to the agents" : "Back to " + (mate?.name ?? "the chat")} className={sub === null ? "back" : ""} />
          {sub === null ? (
            <button ref={setFace} type="button" className="isl" aria-haspopup={wider ? undefined : "menu"} aria-expanded={wider ? panel : menu} aria-label={[mate?.name ?? "This agent", doing, going > 0 ? going + " at work" : ""].filter((t) => t !== "").join(", ")} onClick={() => (wider ? panel_set(!shown) : openMenu())}>
              <span className="relative">
                <Face picture={mate?.picture ?? ""} id={agent} mood={mood} size={FACE} />
                {going > 0 ? <em key={going} className={"count" + pop}>{going}</em> : null}
              </span>
              <Tag name={mate?.name ?? ""} note={note} />
            </button>
          ) : (
            <p className="isl" role="img" aria-label={[sub, doing].filter((t) => t !== "").join(", ")}>
              <Avatar look={look_of("", agent + "/" + sub)} mood={mood} size={FACE} />
              <Tag name={sub} note={note} />
            </p>
          )}
          <span ref={setHead} className="top-end" />
          {drawn === false ? null : <Menu agent={agent} face={face} close={closeMenu} leaving={drawn === "leaving"} gone={gone} />}
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
    </section>
  );
}

// the agent the owner had open last, for an old link with no agent in it
const last = (): string => useKunumy.getState().agent;
const own = (where: "running" | "memory" | "tree", hash?: string) => () => {
  const agent = last();
  if (agent === "") {
    redirect({ to: "/", replace: true, throw: true });
  }
  redirect({ to: "/a/$agent/" + where, params: { agent }, hash, replace: true, throw: true });
};

const root     = createRootRoute({ component: Shell });
const home     = createRoute({ getParentRoute: () => root, path: "/", component: Home });
const chat     = createRoute({ getParentRoute: () => root, path: "/a/$agent", validateSearch: steps_of, component: () => <Chat agent={chat.useParams().agent} sub={null} /> });
const sub      = createRoute({ getParentRoute: () => root, path: "/a/$agent/s/$name", component: () => <Chat agent={sub.useParams().agent} sub={sub.useParams().name} /> });
const fresh    = createRoute({ getParentRoute: () => root, path: "/new", component: () => <AgentPage agent={null} /> });
const edit     = createRoute({ getParentRoute: () => root, path: "/a/$agent/edit", component: () => <AgentPage agent={edit.useParams().agent} /> });
const look     = createRoute({ getParentRoute: () => root, path: "/a/$agent/look", component: () => <Look agent={look.useParams().agent} /> });
const running  = createRoute({ getParentRoute: () => root, path: "/a/$agent/running", component: () => <Running agent={running.useParams().agent} /> });
const work     = createRoute({ getParentRoute: () => root, path: "/a/$agent/w/$id", component: () => <WorkPage key={work.useParams().id} agent={work.useParams().agent} id={work.useParams().id} /> });
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

export const router = createRouter({ routeTree: root.addChildren([home, chat, sub, fresh, edit, look, running, work, memory, tree, runningOld, memoryOld, treeOld, team, settings]), defaultViewTransition: TURNS && { types: turn } });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
