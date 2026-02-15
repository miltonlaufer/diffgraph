import { buildCrossGraphNodeMatchKey } from "#/lib/nodeIdentity";
import type { ViewGraphNode } from "#/types/graph";

interface SplitGraphEdge {
  id: string;
  source: string;
  target: string;
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
}

export interface SplitGraphDerivedResult {
  nodeMatchKeyByIdEntries: Array<[string, string]>;
  nodeIdsByMatchKeyEntries: Array<[string, string[]]>;
  hoverNeighborhoodByNodeIdEntries: SplitGraphDerivedNeighborhood[];
  searchMatchIds: string[];
}

export const computeSplitGraphDerived = ({
  graphNodes,
  positionedNodeIds,
  positionedEdges,
  searchQuery,
  searchExclude,
}: SplitGraphDerivedInput): SplitGraphDerivedResult => {
  const graphNodeById = new Map(graphNodes.map((node) => [node.id, node]));

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
  const incidentEdgeIdsByNode = new Map<string, Set<string>>();
  for (const nodeId of positionedNodeIds) {
    if (!nodeMatchKeyById.has(nodeId)) continue;
    neighborNodeIdsByNode.set(nodeId, new Set());
    incidentEdgeIdsByNode.set(nodeId, new Set());
  }

  for (const edge of positionedEdges) {
    if (neighborNodeIdsByNode.has(edge.source)) {
      neighborNodeIdsByNode.get(edge.source)?.add(edge.target);
      incidentEdgeIdsByNode.get(edge.source)?.add(edge.id);
    }
    if (neighborNodeIdsByNode.has(edge.target)) {
      neighborNodeIdsByNode.get(edge.target)?.add(edge.source);
      incidentEdgeIdsByNode.get(edge.target)?.add(edge.id);
    }
  }

  const hoverNeighborhoodByNodeIdEntries: SplitGraphDerivedNeighborhood[] = [];
  for (const nodeId of neighborNodeIdsByNode.keys()) {
    const graphNode = graphNodeById.get(nodeId);
    if (graphNode?.kind === "group") {
      hoverNeighborhoodByNodeIdEntries.push({
        nodeId,
        keepNodeIds: [nodeId],
        keepEdgeIds: [...(incidentEdgeIdsByNode.get(nodeId) ?? [])],
      });
      continue;
    }

    const keepNodeIds = new Set<string>([nodeId]);
    for (const neighborId of neighborNodeIdsByNode.get(nodeId) ?? []) {
      if (nodeMatchKeyById.has(neighborId)) {
        keepNodeIds.add(neighborId);
      }
    }

    const keepEdgeIds = new Set<string>();
    for (const edge of positionedEdges) {
      if (keepNodeIds.has(edge.source) && keepNodeIds.has(edge.target)) {
        keepEdgeIds.add(edge.id);
      }
    }

    hoverNeighborhoodByNodeIdEntries.push({
      nodeId,
      keepNodeIds: [...keepNodeIds],
      keepEdgeIds: [...keepEdgeIds],
    });
  }

  const searchMatchIds: string[] = [];
  if (searchQuery && searchQuery.length >= 2) {
    const q = searchQuery.toLowerCase();
    for (const nodeId of positionedNodeIds) {
      const node = graphNodeById.get(nodeId);
      const text = `${node?.label ?? ""} ${node?.filePath ?? ""} ${node?.kind ?? ""}`.toLowerCase();
      const matches = text.includes(q);
      if (searchExclude ? !matches : matches) {
        searchMatchIds.push(nodeId);
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
