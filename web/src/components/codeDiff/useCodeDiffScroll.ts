import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import {
  clearPreviewSourceLine,
  scrollToPreviewSourceLine,
  scrollToSourceLine,
} from "./diffUtils";

interface UseCodeDiffScrollParams {
  oldCodeScrollRef: MutableRefObject<HTMLDivElement | null>;
  newCodeScrollRef: MutableRefObject<HTMLDivElement | null>;
  targetLine: number;
  targetSide: "old" | "new";
  scrollTick: number;
  hoveredCodeLine: number;
  hoveredCodeSide: "old" | "new";
}

export const useCodeDiffScroll = ({
  oldCodeScrollRef,
  newCodeScrollRef,
  targetLine,
  targetSide,
  scrollTick,
  hoveredCodeLine,
  hoveredCodeSide,
}: UseCodeDiffScrollParams): {
  syncVerticalScroll: (source: HTMLDivElement | null, target: HTMLDivElement | null) => void;
  handleOldScroll: () => void;
  handleNewScroll: () => void;
} => {
  const syncingScrollRef = useRef(false);
  const prevHoveredCodeLineRef = useRef(0);

  const syncVerticalScroll = useCallback((source: HTMLDivElement | null, target: HTMLDivElement | null) => {
    if (!source || !target) return;
    if (syncingScrollRef.current) return;
    syncingScrollRef.current = true;
    target.scrollTop = source.scrollTop;
    requestAnimationFrame(() => {
      syncingScrollRef.current = false;
    });
  }, []);

  const handleOldScroll = useCallback(() => {
    syncVerticalScroll(oldCodeScrollRef.current, newCodeScrollRef.current);
  }, [syncVerticalScroll, oldCodeScrollRef, newCodeScrollRef]);

  const handleNewScroll = useCallback(() => {
    syncVerticalScroll(newCodeScrollRef.current, oldCodeScrollRef.current);
  }, [syncVerticalScroll, oldCodeScrollRef, newCodeScrollRef]);

  useEffect(() => {
    if (targetLine <= 0) return;
    const timerId = window.setTimeout(() => {
      scrollToSourceLine(newCodeScrollRef.current, targetLine, targetSide);
      scrollToSourceLine(oldCodeScrollRef.current, targetLine, targetSide);
    }, 100);
    return () => window.clearTimeout(timerId);
  }, [targetLine, targetSide, scrollTick, oldCodeScrollRef, newCodeScrollRef]);

  useEffect(() => {
    const prevHovered = prevHoveredCodeLineRef.current;
    if (hoveredCodeLine > 0) {
      scrollToPreviewSourceLine(newCodeScrollRef.current, hoveredCodeLine, hoveredCodeSide);
      scrollToPreviewSourceLine(oldCodeScrollRef.current, hoveredCodeLine, hoveredCodeSide);
      prevHoveredCodeLineRef.current = hoveredCodeLine;
      return;
    }
    clearPreviewSourceLine(newCodeScrollRef.current);
    clearPreviewSourceLine(oldCodeScrollRef.current);
    if (prevHovered > 0 && targetLine > 0) {
      scrollToSourceLine(newCodeScrollRef.current, targetLine, targetSide);
      scrollToSourceLine(oldCodeScrollRef.current, targetLine, targetSide);
    }
    prevHoveredCodeLineRef.current = hoveredCodeLine;
  }, [hoveredCodeLine, hoveredCodeSide, targetLine, targetSide, oldCodeScrollRef, newCodeScrollRef]);

  return { syncVerticalScroll, handleOldScroll, handleNewScroll };
};
