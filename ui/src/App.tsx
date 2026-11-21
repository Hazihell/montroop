import { CaretLeftIcon, XIcon } from "@phosphor-icons/react";
import { createRootRoute, createRoute, createRouter, Link, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Composer } from "./Composer.tsx";
import { noted, show, useKi } from "./Ki.ts";
import { Face } from "./Rows.tsx";
import { Timeline } from "./Timeline.tsx";

const NOTE = 6000;

function SignIn(): ReactNode {
  return (
    <form className="m-auto flex w-full max-w-sm flex-col gap-3 p-6" method="post" action="/auth">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="text-muted">This Ki server is private. On the computer it runs on, run <code className="font-mono text-sm">ki serve login</code> and type the code it prints here.</p>
      <input type="hidden" name="to" value={location.pathname} />
      <input className="field text-center text-xl tracking-widest" name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus aria-label="Sign-in code" />
      <button type="submit" className="btn primary">Sign in</button>
    </form>
  );
}

function Agents(): ReactNode {
  const team = useKi((s) => s.team);
  const here = useParams({ strict: false }).agent;
  return (
    <nav aria-label="Agents" className="flex h-full flex-col overflow-y-auto pb-[env(safe-area-inset-bottom)]">
      <h1 className="px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-2 text-xl font-semibold">Ki</h1>
      {team.filter((m) => m.archived === 0).map((m) => (
        <div key={m.id}>
          <Link to="/a/$agent" params={{ agent: m.id }} className="mate" aria-current={m.id === here ? "page" : undefined}>
            <Face picture={m.picture} size={40} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-2"><b className="truncate font-semibold">{m.name}</b>{m.busy ? <i className="busy" aria-label="Working" /> : null}</span>
              <span className="truncate text-sm text-muted">{m.last}</span>
            </span>
            {m.unread > 0 ? <span className="pill" aria-label={m.unread + " unread"}>{m.unread}</span> : null}
          </Link>
          {(m.subs ?? []).map((s) => (
            <p key={s.name} className="flex gap-2 py-1 pr-4 pl-17 text-sm">
              <span className="shrink-0 font-semibold">{s.name}</span>
              <span className="truncate text-muted">{s.doing === "" ? s.task : s.doing}</span>
            </p>
          ))}
        </div>
      ))}
    </nav>
  );
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
    <p role="status" className="fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10 mx-auto flex max-w-md items-center gap-2 rounded-card border border-line bg-surface py-1 pr-1 pl-4 shadow-lg">
      <span className="min-w-0 flex-1">{note}</span>
      <button type="button" className="tap" aria-label="Dismiss" onClick={noted}><XIcon size={16} /></button>
    </p>
  );
}

function Shell(): ReactNode {
  const signed = useKi((s) => s.signed);
  if (signed === null) {
    return null;
  }
  if (!signed) {
    return <div className="flex h-full"><SignIn /></div>;
  }
  return (
    <div className="flex h-full">
      <aside className="hidden w-80 shrink-0 border-r border-line md:block"><Agents /></aside>
      <main className="min-w-0 flex-1"><Outlet /></main>
      <Note />
    </div>
  );
}

function Home(): ReactNode {
  return (
    <>
      <div className="h-full md:hidden"><Agents /></div>
      <p className="hidden h-full place-items-center text-muted md:grid">Pick an agent to open its chat.</p>
    </>
  );
}

function Chat(): ReactNode {
  const { agent } = chat.useParams();
  const navigate = useNavigate();
  const mate = useKi((s) => s.team.find((m) => m.id === agent));
  const loaded = useKi((s) => s.loaded && s.agent === agent);
  const offline = useKi((s) => s.offline);
  useEffect(() => {
    show(agent);
    return () => show(null);
  }, [agent]);
  // the server shows another agent's chat when it has none of this one
  useEffect(() => useKi.subscribe((s) => {
    if (s.loaded && s.agent !== agent) {
      void navigate({ to: "/a/$agent", params: { agent: s.agent }, replace: true });
    }
  }), [agent, navigate]);
  return (
    <section className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-line px-1 pt-[env(safe-area-inset-top)] md:px-4">
        <Link to="/" className="tap md:hidden" aria-label="All agents"><CaretLeftIcon size={20} /></Link>
        <Face picture={mate?.picture ?? ""} size={32} />
        <h1 className="flex min-h-14 min-w-0 flex-1 flex-col justify-center">
          <b className="truncate font-semibold">{mate?.name ?? ""}</b>
          <span className="truncate text-sm font-normal text-muted">{offline ? "Offline, trying again" : mate?.busy === true ? "Working" : mate?.about ?? ""}</span>
        </h1>
      </header>
      {loaded ? <Timeline key={agent} /> : <div className="grid flex-1 place-items-center"><p className="wait" role="status" aria-label="Loading"><i /><i /><i /></p></div>}
      <Composer />
    </section>
  );
}

const root = createRootRoute({ component: Shell });
const home = createRoute({ getParentRoute: () => root, path: "/", component: Home });
const chat = createRoute({ getParentRoute: () => root, path: "/a/$agent", component: Chat });

export const router = createRouter({ routeTree: root.addChildren([home, chat]) });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
