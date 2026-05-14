import { createContext, createSignal, useContext } from "solid-js";
import type { ParentProps } from "solid-js";

interface LabelContextValue {
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  hasBoard: () => boolean;
  setHasBoard: (v: boolean) => void;
  boardTitle: () => string;
  setBoardTitle: (title: string) => void;
}

const LabelContext = createContext<LabelContextValue>();

export function LabelProvider(props: ParentProps) {
  const [isOpen, setIsOpen] = createSignal(false);
  const [hasBoard, setHasBoard] = createSignal(false);
  const [boardTitle, setBoardTitle] = createSignal("");

  return (
    <LabelContext.Provider
      value={{
        isOpen,
        open: () => setIsOpen(true),
        close: () => setIsOpen(false),
        toggle: () => setIsOpen((v) => !v),
        hasBoard,
        setHasBoard,
        boardTitle,
        setBoardTitle,
      }}
    >
      {props.children}
    </LabelContext.Provider>
  );
}

export const useLabelContext = () => useContext(LabelContext)!;
