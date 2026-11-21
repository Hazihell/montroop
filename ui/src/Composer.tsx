import { ArrowUpIcon, ImageIcon, StopIcon, XIcon } from "@phosphor-icons/react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import * as View from "../../View.ts";
import { act, useKi } from "./Ki.ts";

// on a phone Enter is a new line: its keyboard has no Shift+Enter
const TOUCH = matchMedia("(pointer: coarse)").matches;

export function Composer(): ReactNode {
  const stoppable = useKi((s) => s.stoppable);
  const [text, setText] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const file = useRef<HTMLInputElement>(null);
  const blank = text.trim() === "" && images.length === 0;
  const send = () => {
    act({ $: "Send", text, images });
    setText("");
    setImages([]);
  };
  const key = (ev: KeyboardEvent) => {
    if (ev.key === "Enter" && !ev.shiftKey && !TOUCH && !ev.nativeEvent.isComposing) {
      ev.preventDefault();
      send();
    }
  };
  return (
    <form className="border-t border-line bg-ground px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]" onSubmit={(ev) => { ev.preventDefault(); send(); }}>
      {images.length === 0 ? null : (
        <ul className="mx-auto mb-2 flex max-w-184 flex-wrap gap-2 px-1">
          {images.map((image, k) => (
            <li key={k} className="flex max-w-full items-center rounded-control border border-line pl-2 text-sm">
              <span className="truncate">{image.name}</span>
              <button type="button" className="tap" aria-label={"Remove " + image.name} onClick={() => setImages(images.filter((_, i) => i !== k))}><XIcon size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="mx-auto flex max-w-184 items-end gap-1">
        <button type="button" className="tap text-muted" aria-label="Add images" title={View.IMAGES} onClick={() => file.current?.click()}><ImageIcon size={22} /></button>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={(ev) => { setImages([...images, ...(ev.target.files ?? [])]); ev.target.value = ""; }} />
        <textarea
          className="field max-h-48 flex-1 resize-none [field-sizing:content]"
          rows={1}
          placeholder={View.HINT}
          aria-label={View.HINT}
          enterKeyHint={TOUCH ? "enter" : "send"}
          value={text}
          onChange={(ev) => setText(ev.target.value)}
          onKeyDown={key}
        />
        {blank && stoppable
          ? <button type="submit" className="tap bg-action text-action-ink" aria-label="Stop"><StopIcon size={18} weight="fill" /></button>
          : <button type="submit" className="tap bg-action text-action-ink" aria-label="Send" disabled={blank}><ArrowUpIcon size={20} weight="bold" /></button>}
      </div>
    </form>
  );
}
