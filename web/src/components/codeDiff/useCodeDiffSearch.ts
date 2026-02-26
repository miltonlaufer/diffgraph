import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { scrollToRowIndex } from "./diffUtils";
import type { CodeDiffDrawerStoreInstance } from "./store";

interface UseCodeDiffSearchParams {
  store: CodeDiffDrawerStoreInstance;
  textSearchMatches: number[];
  oldCodeScrollRef: MutableRefObject<HTMLDivElement | null>;
  codeSearchNavDirection: "next" | "prev";
  codeSearchNavTick: number;
}

export const useCodeDiffSearch = ({
  store,
  textSearchMatches,
  oldCodeScrollRef,
  codeSearchNavDirection,
  codeSearchNavTick,
}: UseCodeDiffSearchParams): {
  goToTextMatch: (idx: number) => void;
  handleTextSearchKey: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
} => {
  const lastAppliedCodeSearchNavTickRef = useRef(0);

  const goToTextMatch = useCallback(
    (idx: number) => {
      if (textSearchMatches.length === 0) return;
      const clamped =
        ((idx % textSearchMatches.length) + textSearchMatches.length) % textSearchMatches.length;
      store.setTextSearchIdx(clamped);
      scrollToRowIndex(oldCodeScrollRef.current, textSearchMatches[clamped]);
    },
    [textSearchMatches, store, oldCodeScrollRef],
  );

  const handleTextSearchKey = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (store.textSearch.trim().length === 0) return;
      if (event.key === "Enter") {
        goToTextMatch(event.shiftKey ? store.textSearchIdx - 1 : store.textSearchIdx + 1);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key === "ArrowDown") {
        goToTextMatch(store.textSearchIdx + 1);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key === "ArrowUp") {
        goToTextMatch(store.textSearchIdx - 1);
        event.preventDefault();
        event.stopPropagation();
      }
    },
    [goToTextMatch, store.textSearch, store.textSearchIdx],
  );

  useEffect(() => {
    if (codeSearchNavTick <= 0) return;
    if (codeSearchNavTick === lastAppliedCodeSearchNavTickRef.current) return;
    lastAppliedCodeSearchNavTickRef.current = codeSearchNavTick;
    if (codeSearchNavDirection === "next") {
      goToTextMatch(store.textSearchIdx + 1);
      return;
    }
    goToTextMatch(store.textSearchIdx - 1);
  }, [codeSearchNavDirection, codeSearchNavTick, goToTextMatch, store.textSearchIdx]);

  return { goToTextMatch, handleTextSearchKey };
};
