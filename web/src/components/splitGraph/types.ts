import type { ViewGraph } from "#/types/graph";

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

export interface InternalNodeAnchor {
  topKey: string;
  y: number;
}

export interface AlignmentBreakpoint {
  sourceY: number;
  deltaY: number;
}

export interface SplitGraphPanelProps {
  title: string;
  side: "old" | "new";
  graph: ViewGraph;
  viewType: "logic" | "knowledge" | "react";
  showCalls?: boolean;
  diffStats?: DiffStats;
  fileContentMap: Map<string, string>;
  alignmentOffset?: { x: number; y: number };
  alignmentAnchors?: Record<string, TopLevelAnchor>;
  alignmentBreakpoints?: Record<string, AlignmentBreakpoint[]>;
  isViewportPrimary?: boolean;
}
