import { useEffect } from "react";
import type { ViewBaseStoreInstance } from "./store";
import { resolveAdjacentLogicTreeNodeId } from "./selectors";
import { commandResetToInitialState, commandSelectNode } from "./commands";
import type { InteractiveUpdateContext } from "./useInteractiveUpdate";
import type { ViewGraph } from "#/types/graph";

interface UseViewBaseKeyboardShortcutsParams {
  store: ViewBaseStoreInstance;
  commandContext: InteractiveUpdateContext;
  displayOldGraph: ViewGraph;
  displayNewGraph: ViewGraph;
  graphDiffTargetsLength: number;
  goToPrevGraphDiff: () => void;
  goToNextGraphDiff: () => void;
}

export const useViewBaseKeyboardShortcuts = ({
  store,
  commandContext,
  displayOldGraph,
  displayNewGraph,
  graphDiffTargetsLength,
  goToPrevGraphDiff,
  goToNextGraphDiff,
}: UseViewBaseKeyboardShortcutsParams): void => {
  useEffect(() => {
    const selectAdjacentLogicNode = (direction: "next" | "prev"): boolean => {
      if (store.viewType !== "logic") return false;
      const selectedNodeId = store.selectedNodeId;
      if (!selectedNodeId) return false;

      const resolveTarget = (side: "old" | "new"): { nodeId: string; side: "old" | "new" } | null => {
        const graph = side === "old" ? displayOldGraph : displayNewGraph;
        const adjacentNodeId = resolveAdjacentLogicTreeNodeId(graph, selectedNodeId, direction);
        if (!adjacentNodeId) return null;
        return { nodeId: adjacentNodeId, side };
      };

      const preferredSide = store.focusSourceSide as "old" | "new";
      const fallbackSide: "old" | "new" = preferredSide === "old" ? "new" : "old";
      const target = resolveTarget(preferredSide) ?? resolveTarget(fallbackSide);
      if (!target) return false;

      commandSelectNode(commandContext, target.nodeId, target.side);
      return true;
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        const hasOpenModal = typeof document !== "undefined" && document.querySelector('[aria-modal="true"]') !== null;
        if (!hasOpenModal) {
          if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
            const el = document.activeElement;
            if (
              el instanceof HTMLInputElement ||
              el instanceof HTMLTextAreaElement ||
              el instanceof HTMLSelectElement ||
              (el instanceof HTMLElement && el.isContentEditable)
            ) {
              el.blur();
            }
          }
          commandResetToInitialState(commandContext);
          event.preventDefault();
        }
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const isVerticalArrow = event.key === "ArrowDown" || event.key === "ArrowUp";
      const isHorizontalArrow = event.key === "ArrowLeft" || event.key === "ArrowRight";
      if (!isVerticalArrow && !isHorizontalArrow) return;

      if (isHorizontalArrow) {
        const target = event.target;
        const isEditableTarget =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement ||
          (target instanceof HTMLElement && target.isContentEditable);
        if (isEditableTarget) return;
        const direction: "next" | "prev" = event.key === "ArrowRight" ? "next" : "prev";
        if (!selectAdjacentLogicNode(direction)) return;
        event.preventDefault();
        return;
      }

      const direction: "next" | "prev" = event.key === "ArrowDown" ? "next" : "prev";
      if (store.codeSearchActive) {
        store.requestCodeSearchNavigate(direction);
        event.preventDefault();
        return;
      }
      const hasGraphSearchActive = store.oldGraphSearchActive || store.newGraphSearchActive;
      if (hasGraphSearchActive) {
        const side: "old" | "new" = store.newGraphSearchActive ? "new" : "old";
        store.requestGraphSearchNavigate(side, direction);
        event.preventDefault();
        return;
      }

      if (store.viewType !== "logic" || graphDiffTargetsLength === 0) return;
      if (direction === "next") {
        goToNextGraphDiff();
      } else {
        goToPrevGraphDiff();
      }
      event.preventDefault();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    commandContext,
    displayNewGraph,
    displayOldGraph,
    goToNextGraphDiff,
    goToPrevGraphDiff,
    graphDiffTargetsLength,
    store,
  ]);
};
