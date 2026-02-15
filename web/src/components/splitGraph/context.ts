import { createContext, useContext } from "react";
import type { ViewportState } from "#/types/graph";
import type { GraphDiffTarget, TopLevelAnchor } from "./types";

interface SplitGraphRuntimeState {
  viewport: ViewportState;
  selectedNodeId: string;
  highlightedNodeId: string;
  focusNodeId: string;
  focusNodeTick: number;
  focusSourceSide: "old" | "new";
  focusFilePath: string;
  focusFileTick: number;
}

interface SplitGraphRuntimeActions {
  onNodeSelect: (nodeId: string, side: "old" | "new") => void;
  onViewportChange: (viewport: ViewportState) => void;
  onDiffTargetsChange?: (side: "old" | "new", targets: GraphDiffTarget[]) => void;
  onTopLevelAnchorsChange?: (side: "old" | "new", anchors: Record<string, TopLevelAnchor>) => void;
  onLayoutPendingChange?: (side: "old" | "new", pending: boolean) => void;
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
