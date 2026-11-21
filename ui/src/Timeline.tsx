import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { ArrowDownIcon } from "@phosphor-icons/react";
import { useRef, useState, type ReactNode } from "react";
import { useKi } from "./Ki.ts";
import { items_of, Row } from "./Rows.tsx";

export function Timeline(): ReactNode {
  const rows = useKi((s) => s.rows);
  const list = useRef<LegendListRef>(null);
  const [away, setAway] = useState(false);
  return (
    <div className="relative min-h-0 flex-1">
      <LegendList
        ref={list}
        data={items_of(rows)}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => <Row item={item} />}
        estimatedItemSize={72}
        recycleItems={false}
        alignItemsAtEnd
        initialScrollAtEnd
        maintainScrollAtEnd
        maintainVisibleContentPosition
        onScroll={() => setAway(list.current?.getState().isAtEnd === false)}
        style={{ height: "100%" }}
      />
      {away ? (
        <button type="button" className="tap absolute bottom-3 left-1/2 -translate-x-1/2 border border-line bg-surface shadow-sm" aria-label="Latest messages" onClick={() => void list.current?.scrollToEnd({ animated: true })}>
          <ArrowDownIcon size={18} />
        </button>
      ) : null}
    </div>
  );
}
