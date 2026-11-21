import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { ArrowDownIcon } from "@phosphor-icons/react";
import { useRef, useState, type ReactNode } from "react";
import { useKi } from "./Ki.ts";
import { items_of, Row, useWork } from "./Rows.tsx";

// the first rows start under the island, the room it takes
function Top(): ReactNode {
  return <div className="talk-top" />;
}

export function Timeline(): ReactNode {
  const rows = useKi((s) => s.rows);
  const open = useWork((s) => s.open);
  const list = useRef<LegendListRef>(null);
  const [away, setAway] = useState(false);
  return (
    <div className="talk">
      <LegendList
        ref={list}
        data={items_of(rows, open)}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => <Row item={item} />}
        ListHeaderComponent={Top}
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
        <button type="button" className="round small gl latest" aria-label="Latest messages" onClick={() => void list.current?.scrollToEnd({ animated: true })}>
          <ArrowDownIcon size={18} weight="bold" />
        </button>
      ) : null}
    </div>
  );
}
