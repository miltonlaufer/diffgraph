import type { ViewGraph, ViewportState } from "../../types/graph";

export interface DiffStats {
  added: number;
  removed: number;
  modified: number;
}

export interface GraphDiffTarget {
  id: string;
  side: "old" | "new";
  x: number;
  y: number;
  viewportX: number;
  viewportY: number;
  viewportZoom: number;
  diffStatus: "added" | "removed" | "modified";
  kind?: string;
}

export interface TopLevelAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SplitGraphPanelProps {
  title: string;
  side: "old" | "new";
  graph: ViewGraph;
  viewType: "logic" | "knowledge" | "react";
  showCalls?: boolean;
  onNodeSelect: (nodeId: string, side: "old" | "new") => void;
  viewport: ViewportState;
  onViewportChange: (viewport: ViewportState) => void;
  selectedNodeId: string;
  highlightedNodeId?: string;
  focusNodeId?: string;
  focusNodeTick?: number;
  focusFilePath: string;
  focusFileTick?: number;
  diffStats?: DiffStats;
  fileContentMap: Map<string, string>;
  onDiffTargetsChange?: (side: "old" | "new", targets: GraphDiffTarget[]) => void;
  alignmentOffset?: { x: number; y: number };
  alignmentAnchors?: Record<string, TopLevelAnchor>;
  onTopLevelAnchorsChange?: (side: "old" | "new", anchors: Record<string, TopLevelAnchor>) => void;
}
