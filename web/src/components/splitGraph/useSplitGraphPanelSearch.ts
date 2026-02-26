import { useCallback, useRef } from "react";
import type { Node } from "@xyflow/react";
import type { SplitGraphPanelStoreInstance } from "./store";

const SEARCH_FLASH_MS = 5000;

interface UseSplitGraphPanelSearchParams {
  store: SplitGraphPanelStoreInstance;
  searchMatches: Node[];
  viewportForNode: (node: Node) => { x: number; y: number; zoom: number };
  onViewportChange: (viewport: { x: number; y: number; zoom: number }) => void;
  onInteractionClick?: () => void;
}

export const useSplitGraphPanelSearch = ({
  store,
  searchMatches,
  viewportForNode,
  onViewportChange,
  onInteractionClick,
}: UseSplitGraphPanelSearchParams): {
  flashSearchTarget: (nodeId: string) => void;
  handleSearch: (query: string, exclude: boolean) => void;
  handleSearchNext: () => void;
  handleSearchPrev: () => void;
  searchHighlightTimerRef: React.MutableRefObject<number | null>;
} => {
  const searchHighlightTimerRef = useRef<number | null>(null);

  const flashSearchTarget = useCallback(
    (nodeId: string) => {
      store.setSearchHighlightedNodeId(nodeId);
      if (searchHighlightTimerRef.current !== null) {
        window.clearTimeout(searchHighlightTimerRef.current);
      }
      searchHighlightTimerRef.current = window.setTimeout(() => {
        store.clearSearchHighlight();
        searchHighlightTimerRef.current = null;
      }, SEARCH_FLASH_MS);
    },
    [store],
  );

  const handleSearch = useCallback(
    (query: string, exclude: boolean) => {
      store.setSearch(query, exclude);
    },
    [store],
  );

  const handleSearchNext = useCallback(() => {
    onInteractionClick?.();
    if (searchMatches.length === 0) return;
    const next = (store.searchIdx + 1) % searchMatches.length;
    store.setSearchIdx(next);
    const target = searchMatches[next];
    if (target) {
      flashSearchTarget(target.id);
      onViewportChange(viewportForNode(target));
    }
  }, [
    searchMatches,
    store,
    flashSearchTarget,
    onInteractionClick,
    onViewportChange,
    viewportForNode,
  ]);

  const handleSearchPrev = useCallback(() => {
    onInteractionClick?.();
    if (searchMatches.length === 0) return;
    const prev = (store.searchIdx - 1 + searchMatches.length) % searchMatches.length;
    store.setSearchIdx(prev);
    const target = searchMatches[prev];
    if (target) {
      flashSearchTarget(target.id);
      onViewportChange(viewportForNode(target));
    }
  }, [
    searchMatches,
    store,
    flashSearchTarget,
    onInteractionClick,
    onViewportChange,
    viewportForNode,
  ]);

  return {
    flashSearchTarget,
    handleSearch,
    handleSearchNext,
    handleSearchPrev,
    searchHighlightTimerRef,
  };
};
