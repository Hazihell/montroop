import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { ArrowDownIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { earlier, holds, useKi } from "./Ki.ts";
import { items_of, rose_keep, Row, useWork, type Item } from "./Rows.tsx";

// more items than this coming at once stay still
const FEW = 3;

const said = (item: Item): boolean => item.row.$ === "Msg" && item.row.kind === "user";

// where the user's messages are among items, the first at from
function said_at(items: Item[], from: number): number[] {
  return items.flatMap((item, at) => (said(item) ? [from + at] : []));
}

// the first rows start under the face and its name, the room they take
function Top(): ReactNode {
  return <div className="talk-top" />;
}

// the last row rests clear of the box, over the band where the talk fades
// out into it
function End(): ReactNode {
  return <div className="talk-end" />;
}

// the way up to the owner's message: a bubble tailed on the right, as theirs
// are, with an arrow up in it, so it reads as neither send nor the top
function MineIcon(): ReactNode {
  return (
    <svg width="22" height="22" viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="22" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M72 40H184A32 32 0 0 1 216 72V216L180 184H72A32 32 0 0 1 40 152V72A32 32 0 0 1 72 40Z" />
      <path d="M128 150V78M96 110L128 78L160 110" />
    </svg>
  );
}

// sub: a subagent's page, which loads its earlier entries near its top;
// head: the header's end, where the way up shows, out of the last row's way.
// Each tap goes one of the user's messages further up, and the way shows as
// long as one of them is above the face's room.
export function Timeline({ sub, head }: { sub: boolean; head: HTMLElement | null }): ReactNode {
  const rows = useKi((s) => s.rows);
  const tail = useKi((s) => s.tail);
  const greeted = useKi((s) => s.greeted);
  const open = useWork((s) => s.open);
  const list = useRef<LegendListRef>(null);
  const [away, setAway] = useState(false);
  const [above, setAbove] = useState(false);
  const talk = useRef<HTMLDivElement>(null);
  useEffect(() => {
    holds("place", away);
    return () => holds("place", false);
  }, [away]);
  // the React Compiler leaves this component as written: the chat's items
  // are made again only when its rows change, not at each piece of a reply
  const chat = useMemo(() => {
    const made = items_of(rows, open);
    return { ...made, mine: said_at(made.items, 0) };
  }, [rows, open]);
  const live = items_of(tail, open, chat.seen).items;
  const items = [...chat.items, ...live];
  const mine = [...chat.mine, ...said_at(live, chat.items.length)];
  // the items that may rise in: what streams in and waits at the end, and
  // the owner's own message as it lands, unless it waited there already.
  // Those that came since the last of them changed rise; the chat's first
  // rows, what the link brings over this browser's copy as the chat opens
  // or comes back, or many coming at once, stay still
  const end = chat.items.at(-1);
  const may = end !== undefined && said(end) ? [end, ...live] : live;
  const keys = may.map((item) => item.key).join("\n");
  const [came, setCame] = useState({ keys, greeted, fresh: new Set<string>(), waited: live.some(said) });
  if (came.keys !== keys || came.greeted !== greeted) {
    const was = new Set(came.keys.split("\n"));
    const fresh = came.greeted && greeted ? may.filter((item) => !was.has(item.key) && !(item === end && came.waited)) : [];
    setCame({ keys, greeted, fresh: new Set(fresh.length > FEW ? [] : fresh.map((item) => item.key)), waited: live.some(said) });
  }
  useEffect(() => rose_keep(new Set(keys.split("\n"))), [keys]);
  const room = () => talk.current?.querySelector<HTMLElement>(".talk-top")?.offsetHeight ?? 0;
  // the last of the user's messages that starts above the face's room: a
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
    touched();
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
  // until the owner touches the chat it holds its end: the rows drawn from
  // this browser's copy, which can be old, give way to the server's, and
  // keeping the rows on screen in place would leave the chat far from its end
  const [held, setHeld] = useState(true);
  const touched = () => setHeld(false);
  useEffect(() => {
    if (!held) {
      return undefined;
    }
    const end = () => void list.current?.scrollToEnd({ animated: false });
    end();
    const id = setTimeout(end, 150);
    return () => clearTimeout(id);
  }, [rows, held]);
  useEffect(() => {
    const id = setTimeout(() => setAbove(higher() >= 0), 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per row count: higher reads the list as it is then
  }, [count]);
  return (
    <div className={"talk" + (held ? " held" : "") + (away ? " away" : "")} ref={talk} onTouchStart={touched} onWheel={touched} onPointerDown={touched} onKeyDown={touched}>
      <LegendList
        ref={list}
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => <Row item={item} rise={came.fresh.has(item.key)} />}
        ListHeaderComponent={Top}
        ListFooterComponent={End}
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
      {head === null ? null : createPortal(
        <button type="button" className={"round gl mine" + (above ? " on" : "")} aria-label="Up to your message" title="Up to your message" inert={!above} onClick={up}>
          <MineIcon />
        </button>,
        head,
      )}
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
