import { ArrowLeftIcon, ChatCircleIcon, PlayIcon, TreeStructureIcon, UsersThreeIcon, XIcon } from "@phosphor-icons/react";
import { createRootRoute, createRoute, createRouter, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import * as View from "../../View.ts";
import { AgentPage } from "./Agent.tsx";
import { Avatar, Face, look_of } from "./Avatar.tsx";
import { Composer } from "./Composer.tsx";
import { MOODS, mood_of, noted, show, useKi } from "./Ki.ts";
import { Look } from "./Look.tsx";
import { Memory, Running, Settings, Team } from "./Pages.tsx";
import { Timeline } from "./Timeline.tsx";
import { Viewer } from "./Viewer.tsx";

const NOTE = 6000;

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
  useEffect(() => {
    const timer = note === "" ? undefined : setTimeout(noted, NOTE);
    return () => clearTimeout(timer);
  }, [note]);
  if (note === "") {
    return null;
  }
  return (
    <p role="status" className="toast gl">
      <span className="min-w-0 flex-1">{note}</span>
      <button type="button" className="round small" aria-label="Dismiss" onClick={noted}><XIcon size={16} weight="bold" /></button>
    </p>
  );
}

// the four places: the chat last open, what runs, what is kept, who is there
function Bar(): ReactNode {
  const agent = useKi((s) => s.agent);
  const first = useKi((s) => s.team.find((m) => m.archived === 0)?.id ?? "");
  const going = useKi((s) => s.team.filter((m) => m.archived === 0 && (m.busy || (m.asks ?? 0) > 0)).length);
  const to = agent === "" ? first : agent;
  return (
    <nav className="bar gl" aria-label="Places">
      {to === ""
        ? <Link to="/"><span><ChatCircleIcon size={23} /></span>Chat</Link>
        : <Link to="/a/$agent" params={{ agent: to }}>{({ isActive }) => <><span><ChatCircleIcon size={23} weight={isActive ? "fill" : "regular"} /></span>Chat</>}</Link>}
      <Link to="/running">{({ isActive }) => <><span><PlayIcon size={23} weight={isActive ? "fill" : "bold"} />{going > 0 ? <em aria-label={going + " at work"}>{going}</em> : null}</span>Running</>}</Link>
      <Link to="/memory">{({ isActive }) => <><span><TreeStructureIcon size={23} weight={isActive ? "fill" : "regular"} /></span>Memory</>}</Link>
      <Link to="/team">{({ isActive }) => <><span><UsersThreeIcon size={23} weight={isActive ? "fill" : "regular"} /></span>Team</>}</Link>
    </nav>
  );
}

function Shell(): ReactNode {
  const signed = useKi((s) => s.signed);
  const at = /^\/(team|running|memory|settings)/.exec(useLocation().pathname)?.[1] ?? "chat";
  if (signed === null) {
    return null;
  }
  return (
    <div className="shell">
      <div className="aurora" data-at={at === "settings" ? "team" : at}><i /><i /><i /></div>
      {signed ? <><Outlet /><Bar /></> : <div className="flex h-full"><SignIn /></div>}
      <Note />
      <Viewer />
    </div>
  );
}

// the chat last open, else the first agent's
function Home(): ReactNode {
  const navigate = useNavigate();
  const agent = useKi((s) => s.agent || (s.team.find((m) => m.archived === 0)?.id ?? ""));
  useEffect(() => {
    if (agent !== "") {
      void navigate({ to: "/a/$agent", params: { agent }, replace: true });
    }
  }, [agent, navigate]);
  return <section className="page"><Wait /></section>;
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
    <section className="page">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <header className="top">
          {sub === null ? (
            <Link to="/a/$agent/edit" params={{ agent }} className="isl" aria-label={(mate?.name ?? "This agent") + ": its settings"}>
              <Face picture={mate?.picture ?? ""} id={agent} mood={mood} size={56} />
              <b>{mate?.name ?? ""}</b>
              {doing === "" ? null : <span>{doing}</span>}
            </Link>
          ) : (
            <>
              <Link to="/a/$agent" params={{ agent }} className="round gl" aria-label={"Back to " + (mate?.name ?? "the chat")}><ArrowLeftIcon size={20} weight="bold" /></Link>
              <p className="isl">
                <Avatar look={look_of("", agent + "/" + sub)} mood={mood} size={56} />
                <b>{sub}</b>
                {doing === "" ? null : <span>{doing}</span>}
              </p>
            </>
          )}
        </header>
        {loaded ? <Timeline key={agent + "/" + (sub ?? "")} sub={sub !== null} /> : <Wait />}
        {sub === null ? <Composer key={agent} agent={agent} name={mate?.name ?? ""} /> : (
          <p className="under">
            {knobs.map((k) => k.text).join(" · ")}
            {meter === null ? "" : " · context " + View.talk_percent(meter) + "%"}
          </p>
        )}
      </div>
    </section>
  );
}

const root     = createRootRoute({ component: Shell });
const home     = createRoute({ getParentRoute: () => root, path: "/", component: Home });
const chat     = createRoute({ getParentRoute: () => root, path: "/a/$agent", component: () => <Chat agent={chat.useParams().agent} sub={null} /> });
const sub      = createRoute({ getParentRoute: () => root, path: "/a/$agent/s/$name", component: () => <Chat agent={sub.useParams().agent} sub={sub.useParams().name} /> });
const fresh    = createRoute({ getParentRoute: () => root, path: "/new", component: () => <AgentPage agent={null} /> });
const edit     = createRoute({ getParentRoute: () => root, path: "/a/$agent/edit", component: () => <AgentPage agent={edit.useParams().agent} /> });
const look     = createRoute({ getParentRoute: () => root, path: "/a/$agent/look", component: () => <Look agent={look.useParams().agent} /> });
const running  = createRoute({ getParentRoute: () => root, path: "/running", component: Running });
const memory   = createRoute({ getParentRoute: () => root, path: "/memory", component: Memory });
const team     = createRoute({ getParentRoute: () => root, path: "/team", component: Team });
const settings = createRoute({ getParentRoute: () => root, path: "/settings", component: Settings });

export const router = createRouter({ routeTree: root.addChildren([home, chat, sub, fresh, edit, look, running, memory, team, settings]) });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
