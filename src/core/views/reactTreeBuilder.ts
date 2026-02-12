import type { GraphDelta } from "../diff/graphDelta.js";
import type { ViewGraph } from "../graph/schema.js";

const reactKinds = new Set(["ReactComponent", "Hook"]);
const reactEdgeKinds = new Set(["RENDERS", "USES_HOOK", "CALLS"]);

export const buildReactView = (delta: GraphDelta): { oldGraph: ViewGraph; newGraph: ViewGraph } => {
  const oldNodes = delta.oldGraph.nodes.filter((node) => reactKinds.has(node.kind));
  const newNodes = delta.newGraph.nodes.filter((node) => reactKinds.has(node.kind));
  const oldIds = new Set(oldNodes.map((node) => node.id));
  const newIds = new Set(newNodes.map((node) => node.id));

  return {
    oldGraph: {
      nodes: oldNodes.map((node) => ({
        id: node.id,
        label: node.name,
        kind: node.kind,
        filePath: node.filePath,
        diffStatus: delta.nodeStatus.get(node.id) ?? "unchanged",
      })),
      edges: delta.oldGraph.edges
        .filter((edge) => reactEdgeKinds.has(edge.kind) && oldIds.has(edge.source) && oldIds.has(edge.target))
        .map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          kind: edge.kind,
          diffStatus: delta.edgeStatus.get(edge.id) ?? "unchanged",
        })),
    },
    newGraph: {
      nodes: newNodes.map((node) => ({
        id: node.id,
        label: node.name,
        kind: node.kind,
        filePath: node.filePath,
        diffStatus: delta.nodeStatus.get(node.id) ?? "unchanged",
      })),
      edges: delta.newGraph.edges
        .filter((edge) => reactEdgeKinds.has(edge.kind) && newIds.has(edge.source) && newIds.has(edge.target))
        .map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          kind: edge.kind,
          diffStatus: delta.edgeStatus.get(edge.id) ?? "unchanged",
        })),
    },
  };
};
