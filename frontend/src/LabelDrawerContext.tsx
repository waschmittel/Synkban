import { createContext, createSignal, useContext } from "solid-js";
import type { ParentProps } from "solid-js";

interface LabelDrawerContextValue {
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const LabelDrawerContext = createContext<LabelDrawerContextValue>();

export function LabelDrawerProvider(props: ParentProps) {
  const [isOpen, setIsOpen] = createSignal(false);

  return (
    <LabelDrawerContext.Provider
      value={{
        isOpen,
        open: () => setIsOpen(true),
        close: () => setIsOpen(false),
        toggle: () => setIsOpen((v) => !v),
      }}
    >
      {props.children}
    </LabelDrawerContext.Provider>
  );
}

export const useLabelDrawer = () => useContext(LabelDrawerContext)!;
