import { createContext, createSignal, useContext } from "solid-js";
import type { ParentProps } from "solid-js";

interface BoardHeaderContextValue {
  isOnBoard: () => boolean;
  setIsOnBoard: (v: boolean) => void;
  title: () => string;
  setTitle: (t: string) => void;
  renaming: () => boolean;
  setRenaming: (v: boolean) => void;
  renameValue: () => string;
  setRenameValue: (v: string) => void;
}

const BoardHeaderContext = createContext<BoardHeaderContextValue>();

export function BoardHeaderProvider(props: ParentProps) {
  const [isOnBoard, setIsOnBoard] = createSignal(false);
  const [title, setTitle] = createSignal("");
  const [renaming, setRenaming] = createSignal(false);
  const [renameValue, setRenameValue] = createSignal("");

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
      }}
    >
      {props.children}
    </BoardHeaderContext.Provider>
  );
}

export const useBoardHeader = () => useContext(BoardHeaderContext)!;
