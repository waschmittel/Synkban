import { createContext, createSignal, useContext } from "solid-js";
import type { JSX, ParentProps } from "solid-js";

export interface BoardHeaderControls {
  left: () => JSX.Element;
  right: () => JSX.Element;
}

interface BoardHeaderContextValue {
  isOnBoard: () => boolean;
  setIsOnBoard: (v: boolean) => void;
  title: () => string;
  setTitle: (t: string) => void;
  renaming: () => boolean;
  setRenaming: (v: boolean) => void;
  renameValue: () => string;
  setRenameValue: (v: string) => void;
  controls: () => BoardHeaderControls | null;
  setControls: (c: BoardHeaderControls | null) => void;
}

const BoardHeaderContext = createContext<BoardHeaderContextValue>();

export function BoardHeaderProvider(props: ParentProps) {
  const [isOnBoard, setIsOnBoard] = createSignal(false);
  const [title, setTitle] = createSignal("");
  const [renaming, setRenaming] = createSignal(false);
  const [renameValue, setRenameValue] = createSignal("");
  const [controls, setControls] = createSignal<BoardHeaderControls | null>(null);

  return (
    <BoardHeaderContext.Provider
      value={{
        isOnBoard,
        setIsOnBoard,
        title,
        setTitle,
        renaming,
        setRenaming,
        renameValue,
        setRenameValue,
        controls,
        setControls,
      }}
    >
      {props.children}
    </BoardHeaderContext.Provider>
  );
}

export const useBoardHeader = () => useContext(BoardHeaderContext)!;
