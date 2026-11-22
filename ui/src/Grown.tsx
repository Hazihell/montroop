import { useEffect, type ReactNode } from "react";
import { tree_hide, tree_show } from "./Tree.ts";
import { useKi } from "./Ki.ts";
import { Tabs } from "./Pages.tsx";

// an agent's memory as it is: what it sees now (view), or all of it as the
// tree of summaries (tree), which Tree.ts draws into this page's elements
export function Grown({ agent, view }: { agent: string; view: boolean }): ReactNode {
  const name = useKi((s) => s.team.find((m) => m.id === agent)?.name ?? "");
  useEffect(() => {
    if (agent !== "") {
      tree_show(view ? "VIEW" : "TREE", agent);
    }
  }, [agent, view]);
  useEffect(() => tree_hide, []);
  return (
    <section className="page">
      <header className="head"><h1 className="truncate">{name === "" ? "Memory" : name + "'s memory"}</h1></header>
      <Tabs agent={agent} />
      <main id="tree">
        <nav className="levels"><a className="tab" data-tab="VIEW" /><a className="tab" data-tab="TREE" /><small className="legend" /><button type="button" className="prev" aria-label="Level below">‹</button><button type="button" className="next" aria-label="Level above">›</button></nav>
        <section className="view" tabIndex={-1} />
        <section className="bracket" />
      </main>
    </section>
  );
}
