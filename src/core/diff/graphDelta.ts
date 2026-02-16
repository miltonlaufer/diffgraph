import type { GraphEdge, GraphNode, SnapshotGraph } from "../graph/schema.js";

export interface GraphDelta {
  oldGraph: SnapshotGraph;
  newGraph: SnapshotGraph;
  nodeStatus: Map<string, "added" | "removed" | "modified" | "unchanged">;
  edgeStatus: Map<string, "added" | "removed" | "modified" | "unchanged">;
}

const branchOwnerFromQualifiedName = (qualifiedName: string): string =>
  qualifiedName.replace(/::[^:]+#\d+$/, "");

const normalizeSignatureText = (value: string): string =>
  value.replace(/\s+/g, "");

const nodeKey = (node: GraphNode): string => {
  if (node.kind === "Branch") {
    const branchType = (node.metadata?.branchType as string | undefined) ?? "";
    const snippet = normalizeSignatureText((node.metadata?.codeSnippet as string | undefined) ?? "");
    const owner = branchOwnerFromQualifiedName(node.qualifiedName);
    return `Branch:${owner}:${branchType}:${snippet}`;
  }
  return `${node.qualifiedName}:${node.kind}`;
};
const edgeKey = (edge: GraphEdge): string => {
  const flowType = (edge.metadata?.flowType as string | undefined) ?? "";
  return `${edge.kind}:${edge.source}:${edge.target}:${flowType}`;
};

export const buildGraphDelta = (oldGraph: SnapshotGraph, newGraph: SnapshotGraph): GraphDelta => {
  const nodeStatus = new Map<string, "added" | "removed" | "modified" | "unchanged">();
  const edgeStatus = new Map<string, "added" | "removed" | "modified" | "unchanged">();
  const oldByKey = new Map(oldGraph.nodes.map((node) => [nodeKey(node), node]));
  const newByKey = new Map(newGraph.nodes.map((node) => [nodeKey(node), node]));

  for (const [key, oldNode] of oldByKey.entries()) {
    const newer = newByKey.get(key);
    if (!newer) {
      nodeStatus.set(oldNode.id, "removed");
      continue;
    }
    nodeStatus.set(
      oldNode.id,
      oldNode.signatureHash === newer.signatureHash ? "unchanged" : "modified",
    );
    nodeStatus.set(newer.id, oldNode.signatureHash === newer.signatureHash ? "unchanged" : "modified");
  }

  for (const node of newGraph.nodes) {
    if (!oldByKey.has(nodeKey(node))) {
      nodeStatus.set(node.id, "added");
    }
  }

  const oldEdgeByKey = new Map(oldGraph.edges.map((edge) => [edgeKey(edge), edge]));
  const newEdgeByKey = new Map(newGraph.edges.map((edge) => [edgeKey(edge), edge]));

  for (const [key, oldEdge] of oldEdgeByKey.entries()) {
    const newEdge = newEdgeByKey.get(key);
    if (!newEdge) {
      edgeStatus.set(oldEdge.id, "removed");
      continue;
    }
    edgeStatus.set(oldEdge.id, "unchanged");
    edgeStatus.set(newEdge.id, "unchanged");
  }

  for (const edge of newGraph.edges) {
    if (!oldEdgeByKey.has(edgeKey(edge))) {
      edgeStatus.set(edge.id, "added");
    }
  }

  return { oldGraph, newGraph, nodeStatus, edgeStatus };
};
