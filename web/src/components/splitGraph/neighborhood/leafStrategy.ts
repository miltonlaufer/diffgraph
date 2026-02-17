import { buildAncestorTraversal } from "./ancestorTraversal";
import type { NeighborhoodStrategy } from "./types";

export const buildLeafNeighborhoodPlan: NeighborhoodStrategy = ({
  nodeId,
  neighborNodeIdsByNode,
  nodeMatchKeyById,
  scopeKeyForNode,
}) => {
  const directNodeIds = new Set<string>([nodeId]);
  for (const neighborId of neighborNodeIdsByNode.get(nodeId) ?? []) {
    if (nodeMatchKeyById.has(neighborId)) {
      directNodeIds.add(neighborId);
    }
  }
  const canTraverseAncestor = buildAncestorTraversal({
    scopeKeyForNode,
    anchorScopeKey: scopeKeyForNode(nodeId),
  });
  return {
    directNodeIds,
    ancestorSeedIds: [nodeId],
    canTraverseAncestor,
  };
};
