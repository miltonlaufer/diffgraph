import type { AlignmentBreakpoint, InternalNodeAnchor, TopLevelAnchor } from "#/components/splitGraph/types";
import type { ViewGraph } from "#/types/graph";
import type { ViewType } from "./types";
import {
  computeAlignedTopAnchors,
  computeAlignmentBreakpoints,
  computeChangedNodeCount,
  computeDiffStats,
  computeDisplayGraph,
  computeFilteredNewGraph,
  computeFilteredOldGraph,
  computeNewAlignmentOffset,
  computeVisibleGraph,
} from "./selectors";

export interface ViewBaseDerivedInput {
  oldGraph: ViewGraph;
  newGraph: ViewGraph;
  selectedFilePath: string;
  showChangesOnly: boolean;
  viewType: ViewType;
  oldTopAnchors: Record<string, TopLevelAnchor>;
  newTopAnchors: Record<string, TopLevelAnchor>;
  oldNodeAnchors: Record<string, InternalNodeAnchor>;
  newNodeAnchors: Record<string, InternalNodeAnchor>;
}

export interface ViewBaseDerivedResult {
  displayOldGraph: ViewGraph;
  displayNewGraph: ViewGraph;
  diffStats: { added: number; removed: number; modified: number };
  displayOldChangedCount: number;
  displayNewChangedCount: number;
  newAlignmentOffset?: { x: number; y: number };
  alignedTopAnchors: {
    old: Record<string, TopLevelAnchor> | undefined;
    new: Record<string, TopLevelAnchor> | undefined;
  };
  alignmentBreakpoints: Record<string, AlignmentBreakpoint[]>;
}

export const computeViewBaseDerived = ({
  oldGraph,
  newGraph,
  selectedFilePath,
  showChangesOnly,
  viewType,
  oldTopAnchors,
  newTopAnchors,
  oldNodeAnchors,
  newNodeAnchors,
}: ViewBaseDerivedInput): ViewBaseDerivedResult => {
  const filteredOldGraph = computeFilteredOldGraph(oldGraph);
  const filteredNewGraph = computeFilteredNewGraph(newGraph);
  const visibleOldGraph = computeVisibleGraph(filteredOldGraph, filteredNewGraph, showChangesOnly, viewType);
  const visibleNewGraph = computeVisibleGraph(filteredNewGraph, filteredOldGraph, showChangesOnly, viewType);
  const displayOldGraph = computeDisplayGraph(visibleOldGraph, selectedFilePath, viewType);
  const displayNewGraph = computeDisplayGraph(visibleNewGraph, selectedFilePath, viewType);

  return {
    displayOldGraph,
    displayNewGraph,
    diffStats: computeDiffStats(oldGraph, newGraph, selectedFilePath),
    displayOldChangedCount: computeChangedNodeCount(displayOldGraph),
    displayNewChangedCount: computeChangedNodeCount(displayNewGraph),
    newAlignmentOffset: computeNewAlignmentOffset(viewType, oldTopAnchors, newTopAnchors),
    alignedTopAnchors: computeAlignedTopAnchors(viewType, oldTopAnchors, newTopAnchors),
    alignmentBreakpoints: computeAlignmentBreakpoints(viewType, oldNodeAnchors, newNodeAnchors),
  };
};

