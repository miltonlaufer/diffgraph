import { buildGroupNeighborhoodPlan } from "./groupStrategy";
import { buildLeafNeighborhoodPlan } from "./leafStrategy";
import type { NeighborhoodStrategy, NeighborhoodStrategyInput, NeighborhoodStrategyPlan } from "./types";

const strategiesByKind: Record<string, NeighborhoodStrategy> = {
  group: buildGroupNeighborhoodPlan,
};

export const buildNeighborhoodPlan = (
  kind: string | undefined,
  input: NeighborhoodStrategyInput,
): NeighborhoodStrategyPlan => {
  const strategy = (kind && strategiesByKind[kind]) ? strategiesByKind[kind] : buildLeafNeighborhoodPlan;
  return strategy(input);
};
