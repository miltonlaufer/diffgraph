import type { FileDiffEntry, ViewGraph } from "../../types/graph";
import type { TopLevelAnchor } from "../../components/SplitGraphPanel";
import type { ViewType } from "./types";

export const normalizePath = (value: string): string =>
  value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");

const functionIdentityFromLabel = (label: string): string => {
  const noBadge = label.replace(/^\[[^\]]+\]\s*/, "").trim();
  const idx = noBadge.indexOf("(");
  return (idx >= 0 ? noBadge.slice(0, idx) : noBadge).trim().toLowerCase();
};

const viewNodeKey = (node: ViewGraph["nodes"][number]): string =>
  `${node.kind}:${normalizePath(node.filePath)}:${(node.className ?? "").trim().toLowerCase()}:${functionIdentityFromLabel(node.label)}`;

const includeHierarchyAncestors = (graph: ViewGraph, seedIds: Set<string>): Set<string> => {
  const keepIds = new Set(seedIds);
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const id of [...seedIds]) {
    let current = nodeById.get(id);
    while (current?.parentId) {
      if (keepIds.has(current.parentId)) break;
      keepIds.add(current.parentId);
      current = nodeById.get(current.parentId);
    }
  }
  return keepIds;
};

const includeInvokeNeighbors = (graph: ViewGraph, seedIds: Set<string>): Set<string> => {
  const keepIds = new Set(seedIds);
  for (const edge of graph.edges) {
    if (edge.relation !== "invoke") continue;
    if (keepIds.has(edge.source) || keepIds.has(edge.target)) {
      keepIds.add(edge.source);
      keepIds.add(edge.target);
    }
  }
  return keepIds;
};

const includeHierarchyDescendants = (graph: ViewGraph, seedIds: Set<string>): Set<string> => {
  const keepIds = new Set(seedIds);
  const childrenByParent = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (!node.parentId) continue;
    if (!childrenByParent.has(node.parentId)) {
      childrenByParent.set(node.parentId, []);
    }
    childrenByParent.get(node.parentId)!.push(node.id);
  }
  const queue = [...seedIds];
  while (queue.length > 0) {
    const parentId = queue.shift();
    if (!parentId) continue;
    const children = childrenByParent.get(parentId) ?? [];
    for (const childId of children) {
      if (keepIds.has(childId)) continue;
      keepIds.add(childId);
      queue.push(childId);
    }
  }
  return keepIds;
};

const filterEdgeByNodeIds = (graph: ViewGraph, nodeIds: Set<string>): ViewGraph => ({
  nodes: graph.nodes.filter((n) => nodeIds.has(n.id)),
  edges: graph.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)),
});

export const computeFilteredOldGraph = (oldGraph: ViewGraph): ViewGraph => {
  const nodes = oldGraph.nodes.filter((n) => n.diffStatus !== "added");
  const nodeIds = new Set(nodes.map((n) => n.id));
  return filterEdgeByNodeIds({ nodes, edges: oldGraph.edges }, nodeIds);
};

export const computeFilteredNewGraph = (newGraph: ViewGraph): ViewGraph => {
  const nodes = newGraph.nodes.filter((n) => n.diffStatus !== "removed");
  const nodeIds = new Set(nodes.map((n) => n.id));
  return filterEdgeByNodeIds({ nodes, edges: newGraph.edges }, nodeIds);
};

const applyLogicNeighborExpansion = (graph: ViewGraph, keepIds: Set<string>): Set<string> => {
  const groupSeedIds = new Set(
    graph.nodes
      .filter((n) => keepIds.has(n.id) && n.kind === "group")
      .map((n) => n.id),
  );
  let expanded = includeHierarchyDescendants(graph, groupSeedIds);
  expanded = includeHierarchyAncestors(graph, expanded);
  expanded = includeInvokeNeighbors(graph, expanded);
  expanded = includeHierarchyAncestors(graph, expanded);
  return expanded;
};

type VisibilityExpansionStrategy = (graph: ViewGraph, keepIds: Set<string>) => Set<string>;

const passthroughExpansion: VisibilityExpansionStrategy = (_graph, keepIds) => keepIds;

const visibilityExpansionStrategies: Record<ViewType, VisibilityExpansionStrategy> = {
  logic: applyLogicNeighborExpansion,
  knowledge: passthroughExpansion,
  react: passthroughExpansion,
};

export const computeVisibleGraph = (
  baseGraph: ViewGraph,
  counterpartGraph: ViewGraph,
  showChangesOnly: boolean,
  viewType: ViewType,
): ViewGraph => {
  if (!showChangesOnly) return baseGraph;

  const changedIds = new Set(baseGraph.nodes.filter((n) => n.diffStatus !== "unchanged").map((n) => n.id));
  const otherChangedKeys = new Set(
    counterpartGraph.nodes
      .filter((n) => n.diffStatus === "modified")
      .map((n) => viewNodeKey(n)),
  );
  const counterpartIds = new Set(
    baseGraph.nodes
      .filter((n) => otherChangedKeys.has(viewNodeKey(n)))
      .map((n) => n.id),
  );
  let keepIds = new Set([...changedIds, ...counterpartIds]);
  keepIds = includeHierarchyAncestors(baseGraph, keepIds);
  keepIds = visibilityExpansionStrategies[viewType](baseGraph, keepIds);
  return filterEdgeByNodeIds(baseGraph, keepIds);
};

type FileSelectionExpansionStrategy = (visibleGraph: ViewGraph, nodeIds: Set<string>) => Set<string>;

const logicFileSelectionExpansion: FileSelectionExpansionStrategy = (visibleGraph, nodeIds) => {
  return includeHierarchyAncestors(visibleGraph, nodeIds);
};

const passthroughFileSelectionExpansion: FileSelectionExpansionStrategy = (_visibleGraph, nodeIds) => nodeIds;

const fileSelectionExpansionStrategies: Record<ViewType, FileSelectionExpansionStrategy> = {
  logic: logicFileSelectionExpansion,
  knowledge: passthroughFileSelectionExpansion,
  react: passthroughFileSelectionExpansion,
};

export const computeDisplayGraph = (
  visibleGraph: ViewGraph,
  selectedFilePath: string,
  viewType: ViewType,
): ViewGraph => {
  if (!selectedFilePath) return visibleGraph;

  const normalizedTarget = normalizePath(selectedFilePath);
  let nodeIds = new Set(
    visibleGraph.nodes
      .filter((n) => normalizePath(n.filePath) === normalizedTarget)
      .map((n) => n.id),
  );

  nodeIds = fileSelectionExpansionStrategies[viewType](visibleGraph, nodeIds);

  return filterEdgeByNodeIds(visibleGraph, nodeIds);
};

export const computeDiffStats = (
  oldGraph: ViewGraph,
  newGraph: ViewGraph,
  selectedFilePath: string,
): { added: number; removed: number; modified: number } => {
  let oldNodes = oldGraph.nodes;
  let newNodes = newGraph.nodes;
  if (selectedFilePath) {
    const target = normalizePath(selectedFilePath);
    oldNodes = oldNodes.filter((n) => normalizePath(n.filePath) === target);
    newNodes = newNodes.filter((n) => normalizePath(n.filePath) === target);
  }

  const allNodes = [...oldNodes, ...newNodes];
  return {
    added: allNodes.filter((n) => n.diffStatus === "added").length,
    removed: allNodes.filter((n) => n.diffStatus === "removed").length,
    modified: new Set(allNodes.filter((n) => n.diffStatus === "modified").map((n) => n.label)).size,
  };
};

export const computeChangedNodeCount = (graph: ViewGraph): number =>
  graph.nodes.filter((node) => node.diffStatus !== "unchanged").length;

export const computeNewAlignmentOffset = (
  viewType: ViewType,
  oldTopAnchors: Record<string, TopLevelAnchor>,
  newTopAnchors: Record<string, TopLevelAnchor>,
): { x: number; y: number } | undefined => {
  if (viewType !== "logic") return undefined;
  const keys = Object.keys(oldTopAnchors).filter((key) => newTopAnchors[key] !== undefined);
  if (keys.length === 0) return undefined;

  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const key of keys) {
    const oldPt = oldTopAnchors[key];
    const newPt = newTopAnchors[key];
    if (!oldPt || !newPt) continue;
    sumX += oldPt.x - newPt.x;
    sumY += oldPt.y - newPt.y;
    count += 1;
  }
  if (count === 0) return undefined;

  return { x: sumX / count, y: sumY / count };
};

export const computeAlignedTopAnchors = (
  viewType: ViewType,
  oldTopAnchors: Record<string, TopLevelAnchor>,
  newTopAnchors: Record<string, TopLevelAnchor>,
): { old: Record<string, TopLevelAnchor> | undefined; new: Record<string, TopLevelAnchor> | undefined } => {
  if (viewType !== "logic") {
    return { old: undefined, new: undefined };
  }

  const sharedKeys = Object.keys(oldTopAnchors).filter((key) => newTopAnchors[key] !== undefined);
  if (sharedKeys.length === 0) {
    return { old: undefined, new: undefined };
  }

  const sortedKeys = [...sharedKeys].sort((a, b) => {
    const oldA = oldTopAnchors[a];
    const oldB = oldTopAnchors[b];
    const yDelta = (oldA?.y ?? 0) - (oldB?.y ?? 0);
    if (yDelta !== 0) return yDelta;
    return (oldA?.x ?? 0) - (oldB?.x ?? 0);
  });

  const canonicalY = new Map<string, number>();
  const rowGap = 28;
  for (let idx = 0; idx < sortedKeys.length; idx += 1) {
    const key = sortedKeys[idx];
    const oldAnchor = oldTopAnchors[key];
    const newAnchor = newTopAnchors[key];
    if (!oldAnchor || !newAnchor) continue;

    const naturalY = Math.max(oldAnchor.y, newAnchor.y);
    if (idx === 0) {
      canonicalY.set(key, naturalY);
      continue;
    }

    const prevKey = sortedKeys[idx - 1];
    const prevOld = oldTopAnchors[prevKey];
    const prevNew = newTopAnchors[prevKey];
    const prevY = canonicalY.get(prevKey);
    if (!prevOld || !prevNew || prevY === undefined) {
      canonicalY.set(key, naturalY);
      continue;
    }

    const prevRowHeight = Math.max(prevOld.height, prevNew.height);
    const minY = prevY + prevRowHeight + rowGap;
    canonicalY.set(key, Math.max(naturalY, minY));
  }

  const oldAligned: Record<string, TopLevelAnchor> = {};
  const newAligned: Record<string, TopLevelAnchor> = {};
  for (const key of sortedKeys) {
    const oldAnchor = oldTopAnchors[key];
    const newAnchor = newTopAnchors[key];
    const y = canonicalY.get(key);
    if (!oldAnchor || !newAnchor || y === undefined) continue;
    oldAligned[key] = { ...oldAnchor, y };
    newAligned[key] = { ...newAnchor, x: oldAnchor.x, y };
  }

  return { old: oldAligned, new: newAligned };
};

export const buildFileContentMap = (
  fileDiffs: FileDiffEntry[],
  side: "old" | "new",
): Map<string, string> => {
  const map = new Map<string, string>();
  for (const fileDiff of fileDiffs) {
    map.set(normalizePath(fileDiff.path), side === "old" ? fileDiff.oldContent : fileDiff.newContent);
  }
  return map;
};
