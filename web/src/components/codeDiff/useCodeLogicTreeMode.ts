import { useEffect, useRef } from "react";
import type { CodeDiffDrawerStoreInstance } from "./store";

interface UseCodeLogicTreeModeParams {
  store: CodeDiffDrawerStoreInstance;
  codeLogicTreeRequestTick: number;
  codeLogicTreeRequestSide: "old" | "new";
  codeLogicTreeRequestLines: number[];
}

export const useCodeLogicTreeMode = ({
  store,
  codeLogicTreeRequestTick,
  codeLogicTreeRequestSide,
  codeLogicTreeRequestLines,
}: UseCodeLogicTreeModeParams): void => {
  const lastAppliedCodeLogicTreeTickRef = useRef(0);

  useEffect(() => {
    if (codeLogicTreeRequestTick <= 0) return;
    if (codeLogicTreeRequestTick === lastAppliedCodeLogicTreeTickRef.current) return;
    lastAppliedCodeLogicTreeTickRef.current = codeLogicTreeRequestTick;
    const normalizedLines = [
      ...new Set(
        codeLogicTreeRequestLines
          .map((line) => Math.floor(line))
          .filter((line) => Number.isFinite(line) && line > 0),
      ),
    ].sort((a, b) => a - b);
    if (normalizedLines.length === 0) return;
    store.setCodeLogicTreeMode(codeLogicTreeRequestSide, normalizedLines);
    store.setFullscreen(true);
  }, [
    codeLogicTreeRequestLines,
    codeLogicTreeRequestSide,
    codeLogicTreeRequestTick,
    store,
  ]);
};
