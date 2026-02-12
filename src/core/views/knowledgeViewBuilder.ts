import type { GraphDelta } from "../diff/graphDelta.js";
import type { ViewGraph } from "../graph/schema.js";

export const buildKnowledgeView = (delta: GraphDelta): { oldGraph: ViewGraph; newGraph: ViewGraph } => ({
  oldGraph: {
    nodes: delta.oldGraph.nodes.filter((node) => node.kind !== "Branch").map((node) => ({
      id: node.id,
      label: `${node.kind}: ${node.name}`,
      kind: node.kind,
      filePath: node.filePath,
      startLine: node.startLine,
      diffStatus: delta.nodeStatus.get(node.id) ?? "unchanged",
    })),
    edges: delta.oldGraph.edges
      .filter((edge) => {
        const sourceNode = delta.oldGraph.nodes.find((node) => node.id === edge.source);
        const targetNode = delta.oldGraph.nodes.find((node) => node.id === edge.target);
        return sourceNode?.kind !== "Branch" && targetNode?.kind !== "Branch";
      })
      .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      diffStatus: delta.edgeStatus.get(edge.id) ?? "unchanged",
      })),
  },
  newGraph: {
    nodes: delta.newGraph.nodes.filter((node) => node.kind !== "Branch").map((node) => ({
      id: node.id,
      label: `${node.kind}: ${node.name}`,
      kind: node.kind,
      filePath: node.filePath,
      startLine: node.startLine,
      diffStatus: delta.nodeStatus.get(node.id) ?? "unchanged",
    })),
    edges: delta.newGraph.edges
      .filter((edge) => {
        const sourceNode = delta.newGraph.nodes.find((node) => node.id === edge.source);
        const targetNode = delta.newGraph.nodes.find((node) => node.id === edge.target);
        return sourceNode?.kind !== "Branch" && targetNode?.kind !== "Branch";
      })
      .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      diffStatus: delta.edgeStatus.get(edge.id) ?? "unchanged",
      })),
  },
});
