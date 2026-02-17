import { buildCrossGraphNodeMatchKey } from "#/lib/nodeIdentity";
import { createCachedComputation } from "#/lib/cachedComputation";
import { hashBoolean, hashFinalize, hashInit, hashNumber, hashString } from "#/lib/memoHash";
import type { ViewGraphNode } from "#/types/graph";
import { buildNeighborhoodPlan } from "./neighborhood/strategyRegistry";

interface SplitGraphEdge {
  id: string;
  source: string;
  target: string;
  relation?: "flow" | "invoke" | "hierarchy";
}

export interface SplitGraphDerivedInput {
  graphNodes: ViewGraphNode[];
  positionedNodeIds: string[];
  positionedEdges: SplitGraphEdge[];
  searchQuery: string;
  searchExclude: boolean;
}

export interface SplitGraphDerivedNeighborhood {
  nodeId: string;
  keepNodeIds: string[];
  keepEdgeIds: string[];
  directNodeIds: string[];
  directEdgeIds: string[];
  ancestorNodeIds: string[];
  ancestorEdgeIds: string[];
}

export interface SplitGraphDerivedResult {
  nodeMatchKeyByIdEntries: Array<[string, string]>;
  nodeIdsByMatchKeyEntries: Array<[string, string[]]>;
  hoverNeighborhoodByNodeIdEntries: SplitGraphDerivedNeighborhood[];
  searchMatchIds: string[];
}

const SPLIT_GRAPH_DERIVED_CACHE_MAX_ENTRIES = 24;

export const buildSplitGraphDerivedInputSignature = (input: SplitGraphDerivedInput): string => {
  let hash = hashInit();
  hash = hashString(hash, input.searchQuery);
  hash = hashBoolean(hash, input.searchExclude);
  hash = hashNumber(hash, input.positionedNodeIds.length);
  for (const nodeId of input.positionedNodeIds) {
    hash = hashString(hash, nodeId);
  }
  hash = hashNumber(hash, input.positionedEdges.length);
  for (const edge of input.positionedEdges) {
    hash = hashString(hash, edge.id);
    hash = hashString(hash, edge.source);
    hash = hashString(hash, edge.target);
    hash = hashString(hash, edge.relation ?? "-");
  }
  return `${hashFinalize(hash)}:${input.positionedNodeIds.length}:${input.positionedEdges.length}`;
};

const computeSplitGraphDerivedUncached = ({
  graphNodes,
  positionedNodeIds,
  positionedEdges,
  searchQuery,
  searchExclude,
}: SplitGraphDerivedInput): SplitGraphDerivedResult => {
  const graphNodeById = new Map(graphNodes.map((node) => [node.id, node]));
  const scopeKeyForNode = (nodeId: string): string => {
    const node = graphNodeById.get(nodeId);
    return node?.parentId ?? "__root__";
  };

  const baseMatchKeyById = new Map<string, string>();
  for (const node of graphNodes) {
    baseMatchKeyById.set(node.id, buildCrossGraphNodeMatchKey(node));
  }

  const baseKeyNodeIds = new Map<string, string[]>();
  for (const node of graphNodes) {
    const baseKey = baseMatchKeyById.get(node.id);
    if (!baseKey) continue;
    const list = baseKeyNodeIds.get(baseKey) ?? [];
    list.push(node.id);
    baseKeyNodeIds.set(baseKey, list);
  }

  const nodeMatchKeyById = new Map<string, string>();
  for (const [baseKey, nodeIds] of baseKeyNodeIds.entries()) {
    const sortedNodeIds = nodeIds.slice().sort((a, b) => {
      const nodeA = graphNodeById.get(a);
      const nodeB = graphNodeById.get(b);
      const startA = nodeA?.startLine ?? Number.MAX_SAFE_INTEGER;
      const startB = nodeB?.startLine ?? Number.MAX_SAFE_INTEGER;
      if (startA !== startB) return startA - startB;
      const endA = nodeA?.endLine ?? startA;
      const endB = nodeB?.endLine ?? startB;
      if (endA !== endB) return endA - endB;
      return a.localeCompare(b);
    });
    for (const [idx, nodeId] of sortedNodeIds.entries()) {
      nodeMatchKeyById.set(nodeId, `${baseKey}#${idx + 1}`);
    }
  }

  const nodeIdsByMatchKey = new Map<string, string[]>();
  const appendMatchKeyNode = (matchKey: string, nodeId: string): void => {
    const list = nodeIdsByMatchKey.get(matchKey) ?? [];
    list.push(nodeId);
    nodeIdsByMatchKey.set(matchKey, list);
  };
  for (const nodeId of positionedNodeIds) {
    const matchKey = nodeMatchKeyById.get(nodeId);
    if (matchKey) {
      appendMatchKeyNode(matchKey, nodeId);
    }
    const baseKey = baseMatchKeyById.get(nodeId);
    if (baseKey) {
      appendMatchKeyNode(baseKey, nodeId);
    }
  }

  const neighborNodeIdsByNode = new Map<string, Set<string>>();
  for (const nodeId of positionedNodeIds) {
    if (!nodeMatchKeyById.has(nodeId)) continue;
    neighborNodeIdsByNode.set(nodeId, new Set());
  }

  for (const edge of positionedEdges) {
    if (neighborNodeIdsByNode.has(edge.source)) {
      neighborNodeIdsByNode.get(edge.source)?.add(edge.target);
    }
    if (neighborNodeIdsByNode.has(edge.target)) {
      neighborNodeIdsByNode.get(edge.target)?.add(edge.source);
    }
  }

  const incomingFlowEdgeByTarget = new Map<string, SplitGraphEdge[]>();
  for (const edge of positionedEdges) {
    if (edge.relation !== "flow") continue;
    const list = incomingFlowEdgeByTarget.get(edge.target) ?? [];
    list.push(edge);
    incomingFlowEdgeByTarget.set(edge.target, list);
  }

  const childrenByParent = new Map<string, string[]>();
  for (const nodeId of positionedNodeIds) {
    const node = graphNodeById.get(nodeId);
    const parentId = node?.parentId;
    if (!parentId) continue;
    const list = childrenByParent.get(parentId) ?? [];
    list.push(nodeId);
    childrenByParent.set(parentId, list);
  }

  const descendantsByGroupId = new Map<string, Set<string>>();
  const collectGroupDescendants = (groupId: string): Set<string> => {
    const cached = descendantsByGroupId.get(groupId);
    if (cached) return cached;
    const descendants = new Set<string>();
    const queue: string[] = [groupId];
    while (queue.length > 0) {
      const currentParentId = queue.shift();
      if (!currentParentId) continue;
      for (const childId of childrenByParent.get(currentParentId) ?? []) {
        if (descendants.has(childId)) continue;
        descendants.add(childId);
        const childNode = graphNodeById.get(childId);
        if (childNode?.kind === "group") {
          queue.push(childId);
        }
      }
    }
    descendantsByGroupId.set(groupId, descendants);
    return descendants;
  };

  const hoverNeighborhoodByNodeIdEntries: SplitGraphDerivedNeighborhood[] = [];
  for (const nodeId of neighborNodeIdsByNode.keys()) {
    const graphNode = graphNodeById.get(nodeId);
    const plan = buildNeighborhoodPlan(graphNode?.kind, {
      nodeId,
      neighborNodeIdsByNode,
      nodeMatchKeyById,
      scopeKeyForNode,
      collectGroupDescendants,
    });
    const keepNodeIds = new Set(plan.directNodeIds);
    const ancestorNodeIds = new Set<string>();
    const ancestorEdgeIds = new Set<string>();
    const ancestorQueue = [...plan.ancestorSeedIds];
    const seenAncestorIds = new Set<string>(plan.ancestorSeedIds);
    while (ancestorQueue.length > 0) {
      const currentId = ancestorQueue.shift();
      if (!currentId) continue;
      for (const edge of incomingFlowEdgeByTarget.get(currentId) ?? []) {
        const sourceId = edge.source;
        if (!nodeMatchKeyById.has(sourceId)) continue;
        if (!plan.canTraverseAncestor(sourceId, currentId)) continue;
        keepNodeIds.add(sourceId);
        ancestorNodeIds.add(sourceId);
        ancestorEdgeIds.add(edge.id);
        if (seenAncestorIds.has(sourceId)) continue;
        seenAncestorIds.add(sourceId);
        ancestorQueue.push(sourceId);
      }
    }

    const directEdgeIds = new Set<string>();
    for (const edge of positionedEdges) {
      if (plan.directNodeIds.has(edge.source) && plan.directNodeIds.has(edge.target)) {
        directEdgeIds.add(edge.id);
      }
    }
    const keepEdgeIds = new Set<string>([...directEdgeIds, ...ancestorEdgeIds]);

    hoverNeighborhoodByNodeIdEntries.push({
      nodeId,
      keepNodeIds: [...keepNodeIds],
      keepEdgeIds: [...keepEdgeIds],
      directNodeIds: [...plan.directNodeIds],
      directEdgeIds: [...directEdgeIds],
      ancestorNodeIds: [...ancestorNodeIds],
      ancestorEdgeIds: [...ancestorEdgeIds],
    });
  }

  const searchMatchIds: string[] = [];
  if (searchQuery && searchQuery.length >= 2) {
    const q = searchQuery.toLowerCase();
    const matchesByNodeId = new Map<string, boolean>();
    for (const nodeId of positionedNodeIds) {
      const node = graphNodeById.get(nodeId);
      const text = `${node?.label ?? ""} ${node?.filePath ?? ""} ${node?.kind ?? ""}`.toLowerCase();
      matchesByNodeId.set(nodeId, text.includes(q));
    }

    if (!searchExclude) {
      for (const nodeId of positionedNodeIds) {
        if (matchesByNodeId.get(nodeId)) {
          searchMatchIds.push(nodeId);
        }
      }
    } else {
      const keepIds = new Set<string>();
      for (const nodeId of positionedNodeIds) {
        if (!matchesByNodeId.get(nodeId)) {
          keepIds.add(nodeId);
        }
      }

      const excludedGroupQueue: string[] = [];
      const seenExcludedIds = new Set<string>();
      for (const nodeId of positionedNodeIds) {
        if (!matchesByNodeId.get(nodeId)) continue;
        const node = graphNodeById.get(nodeId);
        if (node?.kind !== "group") continue;
        excludedGroupQueue.push(nodeId);
        seenExcludedIds.add(nodeId);
      }

      while (excludedGroupQueue.length > 0) {
        const excludedGroupId = excludedGroupQueue.shift();
        if (!excludedGroupId) continue;
        for (const childId of childrenByParent.get(excludedGroupId) ?? []) {
          keepIds.delete(childId);
          if (seenExcludedIds.has(childId)) continue;
          seenExcludedIds.add(childId);
          excludedGroupQueue.push(childId);
        }
      }

      for (const nodeId of positionedNodeIds) {
        if (keepIds.has(nodeId)) {
          searchMatchIds.push(nodeId);
        }
      }
    }
  }

  return {
    nodeMatchKeyByIdEntries: [...nodeMatchKeyById.entries()],
    nodeIdsByMatchKeyEntries: [...nodeIdsByMatchKey.entries()],
    hoverNeighborhoodByNodeIdEntries,
    searchMatchIds,
  };
};

const splitGraphDerivedCache = createCachedComputation<SplitGraphDerivedInput, SplitGraphDerivedResult>({
  maxEntries: SPLIT_GRAPH_DERIVED_CACHE_MAX_ENTRIES,
  buildSignature: buildSplitGraphDerivedInputSignature,
  compute: computeSplitGraphDerivedUncached,
});

export const computeSplitGraphDerived = (input: SplitGraphDerivedInput): SplitGraphDerivedResult =>
  splitGraphDerivedCache.run(input);
