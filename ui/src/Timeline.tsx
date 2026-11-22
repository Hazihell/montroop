import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { ArrowDownIcon, ArrowUpIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { earlier, holds, useKi } from "./Ki.ts";
import { items_of, Row, useWork } from "./Rows.tsx";

// the room the island takes over the list, in rem: .talk-top's height
const ROOM = 5.5;

// the first rows start under the island, the room it takes
function Top(): ReactNode {
  return <div className="talk-top" />;
}

// sub: a subagent's page, which loads its earlier entries near its top;
// head: the header's end, where the way up shows, out of the last row's way.
// Each tap goes one of the user's messages further up, and the way shows as
// long as one of them is above the island.
export function Timeline({ sub, head }: { sub: boolean; head: HTMLElement | null }): ReactNode {
  const rows = useKi((s) => s.rows);
  const open = useWork((s) => s.open);
  const list = useRef<LegendListRef>(null);
  const [away, setAway] = useState(false);
  const [above, setAbove] = useState(false);
  const talk = useRef<HTMLDivElement>(null);
  useEffect(() => {
    holds("place", away);
    return () => holds("place", false);
  }, [away]);
  const items = items_of(rows, open);
  const mine = items.flatMap((i, at) => (i.row.$ === "Msg" && i.row.kind === "user" ? [at] : []));
  const room = () => ROOM * parseFloat(getComputedStyle(document.documentElement).fontSize);
  // the last of the user's messages that starts above the island's room: a
  // drawn row says where it is, one not drawn is above when before the drawn
  const higher = (): number => {
    const state = list.current?.getState();
    const box = talk.current?.getBoundingClientRect();
    if (state === undefined || box === undefined) {
      return -1;
    }
    const line = box.top + room() - 2;
    return mine.findLast((at) => {
      const el = state.elementAtIndex(at) as HTMLElement | undefined | null;
      return el === undefined || el === null ? at < state.start : el.getBoundingClientRect().top < line;
    }) ?? -1;
  };
  const scrolled = () => {
    setAway(list.current?.getState().isAtEnd === false);
    setAbove(higher() >= 0);
  };
  // a row far away is measured only as it comes, and each measure moves a
  // smooth scroll's target, which a phone then drops midway: only a drawn row
  // is slid to
  const up = () => {
    const state = list.current?.getState();
    const at = higher();
    if (state !== undefined && at >= 0) {
      void list.current?.scrollToIndex({ index: at, animated: at >= state.startBuffered, viewOffset: room() });
    }
  };
  // the same on the way down: slid when the end is near, else jumped to
  const down = () => {
    const state = list.current?.getState();
    void list.current?.scrollToEnd({ animated: state !== undefined && state.distanceFromEnd < 2 * state.scrollLength });
  };
  const count = items.length;
  useEffect(() => {
    const id = setTimeout(() => setAbove(higher() >= 0), 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per row count: higher reads the list as it is then
  }, [count]);
  return (
    <div className="talk" ref={talk}>
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
        <button type="button" className="round small gl" aria-label="Up to your message" onClick={up}>
          <ArrowUpIcon size={18} weight="bold" />
        </button>,
        head,
      ) : null}
      <div className="jump">
        {away ? (
          <button type="button" className="round small gl" aria-label="Latest messages" onClick={down}>
            <ArrowDownIcon size={18} weight="bold" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
