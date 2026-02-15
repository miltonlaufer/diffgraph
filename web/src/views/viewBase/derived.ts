import type { ViewGraph } from "#/types/graph";
import type { ViewType } from "./types";
import {
  computeChangedNodeCount,
  computeDiffStats,
  computeDisplayGraph,
  computeFilteredNewGraph,
  computeFilteredOldGraph,
  computeVisibleGraph,
} from "./selectors";

export interface ViewBaseDerivedInput {
  oldGraph: ViewGraph;
  newGraph: ViewGraph;
  selectedFilePath: string;
  showChangesOnly: boolean;
  viewType: ViewType;
}

export interface ViewBaseDerivedResult {
  displayOldGraph: ViewGraph;
  displayNewGraph: ViewGraph;
  diffStats: { added: number; removed: number; modified: number };
  displayOldChangedCount: number;
  displayNewChangedCount: number;
}

export const computeViewBaseDerived = ({
  oldGraph,
  newGraph,
  selectedFilePath,
  showChangesOnly,
  viewType,
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
  };
};
