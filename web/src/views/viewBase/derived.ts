import { createCachedComputation } from "#/lib/cachedComputation";
import { hashBoolean, hashFinalize, hashInit, hashNumber, hashString } from "#/lib/memoHash";
import type { ViewGraph } from "#/types/graph";
import type { ViewType } from "./types";
import {
  computeChangedNodeCount,
  computeDiffStats,
  computeDisplayGraphByFilePaths,
  computeFilteredNewGraph,
  computeFilteredOldGraph,
  computeVisibleGraph,
} from "./selectors";

export interface ViewBaseDerivedInput {
  oldGraph: ViewGraph;
  newGraph: ViewGraph;
  selectedFilePathsForGraph: string[];
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

const VIEW_BASE_DERIVED_CACHE_MAX_ENTRIES = 12;

const hashGraphForSignature = (
  hash: number,
  graph: ViewBaseDerivedInput["oldGraph"],
): number => {
  let next = hashNumber(hash, graph.nodes.length);
  for (const node of graph.nodes) {
    next = hashString(next, node.id);
    next = hashString(next, node.kind);
    next = hashString(next, node.label);
    next = hashString(next, node.filePath);
    next = hashString(next, node.diffStatus);
    next = hashString(next, node.parentId ?? "");
    next = hashString(next, node.branchType ?? "");
    next = hashNumber(next, node.startLine ?? -1);
    next = hashNumber(next, node.endLine ?? -1);
  }
  next = hashNumber(next, graph.edges.length);
  for (const edge of graph.edges) {
    next = hashString(next, edge.id);
    next = hashString(next, edge.source);
    next = hashString(next, edge.target);
    next = hashString(next, edge.kind);
    next = hashString(next, edge.relation ?? "");
    next = hashString(next, edge.flowType ?? "");
    next = hashString(next, edge.diffStatus);
  }
  return next;
};

export const buildViewBaseDerivedInputSignature = (input: ViewBaseDerivedInput): string => {
  let hash = hashInit();
  hash = hashGraphForSignature(hash, input.oldGraph);
  hash = hashGraphForSignature(hash, input.newGraph);
  for (const p of [...input.selectedFilePathsForGraph].sort()) {
    hash = hashString(hash, p);
  }
  hash = hashBoolean(hash, input.showChangesOnly);
  hash = hashString(hash, input.viewType);
  return `${hashFinalize(hash)}:${input.oldGraph.nodes.length}:${input.newGraph.nodes.length}`;
};

const computeViewBaseDerivedUncached = ({
  oldGraph,
  newGraph,
  selectedFilePathsForGraph,
  showChangesOnly,
  viewType,
}: ViewBaseDerivedInput): ViewBaseDerivedResult => {
  const filteredOldGraph = computeFilteredOldGraph(oldGraph);
  const filteredNewGraph = computeFilteredNewGraph(newGraph);
  const visibleOldGraph = computeVisibleGraph(filteredOldGraph, filteredNewGraph, showChangesOnly, viewType);
  const visibleNewGraph = computeVisibleGraph(filteredNewGraph, filteredOldGraph, showChangesOnly, viewType);
  const displayOldGraph = computeDisplayGraphByFilePaths(visibleOldGraph, selectedFilePathsForGraph, viewType);
  const displayNewGraph = computeDisplayGraphByFilePaths(visibleNewGraph, selectedFilePathsForGraph, viewType);
  const selectedFilePath = selectedFilePathsForGraph.length === 1 ? selectedFilePathsForGraph[0] ?? "" : "";
  return {
    displayOldGraph,
    displayNewGraph,
    diffStats: computeDiffStats(oldGraph, newGraph, selectedFilePath),
    displayOldChangedCount: computeChangedNodeCount(displayOldGraph),
    displayNewChangedCount: computeChangedNodeCount(displayNewGraph),
  };
};

const viewBaseDerivedCache = createCachedComputation<ViewBaseDerivedInput, ViewBaseDerivedResult>({
  maxEntries: VIEW_BASE_DERIVED_CACHE_MAX_ENTRIES,
  buildSignature: buildViewBaseDerivedInputSignature,
  compute: computeViewBaseDerivedUncached,
});

export const computeViewBaseDerived = (input: ViewBaseDerivedInput): ViewBaseDerivedResult =>
  viewBaseDerivedCache.run(input);
