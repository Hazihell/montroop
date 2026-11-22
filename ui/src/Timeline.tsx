import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { ArrowDownIcon, ArrowUpIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { earlier, holds, useKi } from "./Ki.ts";
import { items_of, Row, useWork } from "./Rows.tsx";

// the first rows start under the island, the room it takes
function Top(): ReactNode {
  return <div className="talk-top" />;
}

// sub: a subagent's page, which loads its earlier entries near its top;
// head: the header's end, where the way up to the user's message shows, out
// of the last row's way
export function Timeline({ sub, head }: { sub: boolean; head: HTMLElement | null }): ReactNode {
  const rows = useKi((s) => s.rows);
  const open = useWork((s) => s.open);
  const list = useRef<LegendListRef>(null);
  const [away, setAway] = useState(false);
  const [above, setAbove] = useState(false);
  useEffect(() => {
    holds("place", away);
    return () => holds("place", false);
  }, [away]);
  const items = items_of(rows, open);
  const mine = items.findLastIndex((i) => i.row.$ === "Msg" && i.row.kind === "user");
  const scrolled = () => {
    const state = list.current?.getState();
    setAway(state?.isAtEnd === false);
    setAbove(mine >= 0 && state !== undefined && mine < state.start);
  };
  return (
    <div className="talk">
      <LegendList
        ref={list}
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => <Row item={item} />}
        ListHeaderComponent={Top}
        estimatedItemSize={72}
        recycleItems={false}
        alignItemsAtEnd
        initialScrollAtEnd
        maintainScrollAtEnd
        maintainVisibleContentPosition
        onScroll={scrolled}
        onStartReached={sub ? earlier : undefined}
        style={{ height: "100%" }}
      />
      {above && head !== null ? createPortal(
        <button type="button" className="round small gl" aria-label="Up to your message" onClick={() => void list.current?.scrollToIndex({ index: mine, animated: true })}>
          <ArrowUpIcon size={18} weight="bold" />
        </button>,
        head,
      ) : null}
      <div className="jump">
        {away ? (
          <button type="button" className="round small gl" aria-label="Latest messages" onClick={() => void list.current?.scrollToEnd({ animated: true })}>
            <ArrowDownIcon size={18} weight="bold" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
