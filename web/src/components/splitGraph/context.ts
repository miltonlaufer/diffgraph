import { createContext, useContext } from "react";
import type { ViewportState } from "#/types/graph";
import type { GraphDiffTarget, InternalNodeAnchor, TopLevelAnchor } from "./types";

interface SplitGraphRuntimeState {
  viewport: ViewportState;
  selectedNodeId: string;
  highlightedNodeId: string;
  focusNodeId: string;
  focusNodeTick: number;
  focusSourceSide: "old" | "new";
  graphSearchSide: "old" | "new";
  graphSearchQuery: string;
  graphSearchTick: number;
  graphSearchNavSide: "old" | "new";
  graphSearchNavDirection: "next" | "prev";
  graphSearchNavTick: number;
  focusFilePath: string;
  focusFileTick: number;
  hoveredNodeId: string;
  hoveredNodeMatchKey: string;
}

interface SplitGraphRuntimeActions {
  onInteractionClick?: () => void;
  onGraphNodeFocus?: (nodeId: string, side: "old" | "new") => void;
  onNodeSelect: (nodeId: string, side: "old" | "new") => void;
  onNodeHoverChange: (side: "old" | "new", nodeId: string, matchKey: string) => void;
  onViewportChange: (viewport: ViewportState) => void;
  onDiffTargetsChange?: (side: "old" | "new", targets: GraphDiffTarget[]) => void;
  onTopLevelAnchorsChange?: (side: "old" | "new", anchors: Record<string, TopLevelAnchor>) => void;
  onNodeAnchorsChange?: (side: "old" | "new", anchors: Record<string, InternalNodeAnchor>) => void;
  onLayoutPendingChange?: (side: "old" | "new", pending: boolean) => void;
  onSearchStateChange?: (side: "old" | "new", active: boolean) => void;
}

export interface SplitGraphRuntimeContextValue {
  state: SplitGraphRuntimeState;
  actions: SplitGraphRuntimeActions;
}

const SplitGraphRuntimeContext = createContext<SplitGraphRuntimeContextValue | null>(null);

export const SplitGraphRuntimeProvider = SplitGraphRuntimeContext.Provider;

export const useSplitGraphRuntime = (): SplitGraphRuntimeContextValue => {
  const value = useContext(SplitGraphRuntimeContext);
  if (!value) {
    throw new Error("useSplitGraphRuntime must be used inside SplitGraphRuntimeProvider");
  }
  return value;
};
