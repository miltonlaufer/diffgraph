import type { NeighborhoodStrategyInput } from "./types";

interface AncestorTraversalOptions {
  scopeKeyForNode: NeighborhoodStrategyInput["scopeKeyForNode"];
  anchorScopeKey?: string;
  allowedNodeIds?: ReadonlySet<string>;
}

export const buildAncestorTraversal = ({
  scopeKeyForNode,
  anchorScopeKey,
  allowedNodeIds,
}: AncestorTraversalOptions): ((sourceId: string, targetId: string) => boolean) => {
  if (allowedNodeIds) {
    return (sourceId: string, targetId: string): boolean =>
      allowedNodeIds.has(sourceId) && allowedNodeIds.has(targetId);
  }
  return (sourceId: string, targetId: string): boolean => {
    const scopeKey = anchorScopeKey ?? scopeKeyForNode(targetId);
    return scopeKeyForNode(sourceId) === scopeKey;
  };
};
