export interface NeighborhoodStrategyPlan {
  directNodeIds: Set<string>;
  ancestorSeedIds: string[];
  canTraverseAncestor: (sourceId: string, targetId: string) => boolean;
}

export interface NeighborhoodStrategyInput {
  nodeId: string;
  neighborNodeIdsByNode: Map<string, Set<string>>;
  nodeMatchKeyById: Map<string, string>;
  scopeKeyForNode: (nodeId: string) => string;
  collectGroupDescendants: (groupId: string) => Set<string>;
}

export type NeighborhoodStrategy = (input: NeighborhoodStrategyInput) => NeighborhoodStrategyPlan;
