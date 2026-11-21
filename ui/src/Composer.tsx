import { ArrowUpIcon, PlusIcon, StopIcon, XIcon } from "@phosphor-icons/react";
import { useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import * as View from "../../View.ts";
import { act, useKi } from "./Ki.ts";

// on a phone Enter is a new line: its keyboard has no Shift+Enter
const TOUCH = matchMedia("(pointer: coarse)").matches;

// a press on one of the box's buttons leaves the caret in the text: the
// keyboard stays up, and the box does not move under the finger
function hold(ev: MouseEvent): void {
  if (ev.target instanceof Element && ev.target.closest("button") !== null) {
    ev.preventDefault();
  }
}

export function Composer({ name }: { name: string }): ReactNode {
  const stoppable = useKi((s) => s.stoppable);
  const [text, setText] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const file = useRef<HTMLInputElement>(null);
  const blank = text.trim() === "" && images.length === 0;
  const hint = name === "" ? View.HINT : "Message " + name;
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
    <form className="box gl" onSubmit={(ev) => { ev.preventDefault(); send(); }} onMouseDown={hold}>
      {images.length === 0 ? null : (
        <ul>
          {images.map((image, k) => (
            <li key={k}>
              <span className="truncate">{image.name}</span>
              <button type="button" aria-label={"Remove " + image.name} onClick={() => setImages(images.filter((_, i) => i !== k))}><XIcon size={15} weight="bold" /></button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <button type="button" aria-label="Add images" title={View.IMAGES} onClick={() => file.current?.click()}><PlusIcon size={21} weight="bold" /></button>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={(ev) => { setImages([...images, ...(ev.target.files ?? [])]); ev.target.value = ""; }} />
        <textarea
          rows={1}
          placeholder={hint}
          aria-label={hint}
          enterKeyHint={TOUCH ? "enter" : "send"}
          value={text}
          onChange={(ev) => setText(ev.target.value)}
          onKeyDown={key}
        />
        {blank && stoppable
          ? <button type="submit" className="snd" aria-label="Stop"><StopIcon size={18} weight="fill" /></button>
          : <button type="submit" className="snd" aria-label="Send" disabled={blank}><ArrowUpIcon size={20} weight="bold" /></button>}
      </div>
    </form>
  );
}
