import { buildAncestorTraversal } from "./ancestorTraversal";
import type { NeighborhoodStrategy } from "./types";

export const buildGroupNeighborhoodPlan: NeighborhoodStrategy = ({
  nodeId,
  neighborNodeIdsByNode,
  nodeMatchKeyById,
  collectGroupDescendants,
  scopeKeyForNode,
}) => {
  const directNodeIds = new Set<string>([nodeId]);
  for (const neighborId of neighborNodeIdsByNode.get(nodeId) ?? []) {
    if (nodeMatchKeyById.has(neighborId)) {
      directNodeIds.add(neighborId);
    }
  }

  const descendants = collectGroupDescendants(nodeId);
  const blockNodeIds = new Set<string>([nodeId]);
  for (const descendantId of descendants) {
    blockNodeIds.add(descendantId);
    directNodeIds.add(descendantId);
  }

  const ancestorSeedIds = [...blockNodeIds];
  const canTraverseAncestor = buildAncestorTraversal({
    scopeKeyForNode,
    allowedNodeIds: blockNodeIds,
  });
  return {
    directNodeIds,
    ancestorSeedIds,
    canTraverseAncestor,
  };
};
