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

const deepCallbackLineSuffix = /@\d+$/;

const normalizeDeepQualifiedName = (qualifiedName: string): string => {
  if (qualifiedName.includes(".deep.")) {
    return qualifiedName.replace(deepCallbackLineSuffix, "");
  }
  return qualifiedName;
};

const normalizedQualifiedName = (node: GraphNode): string => {
  if (node.kind === "Function") {
    return normalizeDeepQualifiedName(node.qualifiedName);
  }
  return node.qualifiedName;
};

const nodeKey = (node: GraphNode): string => {
  if (node.kind === "Branch") {
    const branchType = (node.metadata?.branchType as string | undefined) ?? "";
    const branchSig = node.signatureHash
      ?? normalizeSignatureText((node.metadata?.codeSnippet as string | undefined) ?? "");
    const owner = normalizeDeepQualifiedName(branchOwnerFromQualifiedName(node.qualifiedName));
    return `Branch:${owner}:${branchType}:${branchSig}`;
  }
  return `${normalizedQualifiedName(node)}:${node.kind}`;
};

const edgeKey = (edge: GraphEdge): string => {
  const flowType = (edge.metadata?.flowType as string | undefined) ?? "";
  return `${edge.kind}:${edge.source}:${edge.target}:${flowType}`;
};

const sortNodesForMatch = (nodes: GraphNode[]): GraphNode[] =>
  [...nodes].sort(
    (a, b) =>
      (a.startLine ?? Number.MAX_SAFE_INTEGER) - (b.startLine ?? Number.MAX_SAFE_INTEGER) ||
      (a.endLine ?? Number.MAX_SAFE_INTEGER) - (b.endLine ?? Number.MAX_SAFE_INTEGER) ||
      a.id.localeCompare(b.id),
  );

const signatureKey = (node: GraphNode): string => node.signatureHash ?? "__missing_signature__";

const groupByNodeKey = (nodes: GraphNode[]): Map<string, GraphNode[]> => {
  const grouped = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const key = nodeKey(node);
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(node);
    } else {
      grouped.set(key, [node]);
    }
  }
  return grouped;
};

export const buildGraphDelta = (oldGraph: SnapshotGraph, newGraph: SnapshotGraph): GraphDelta => {
  const nodeStatus = new Map<string, "added" | "removed" | "modified" | "unchanged">();
  const edgeStatus = new Map<string, "added" | "removed" | "modified" | "unchanged">();
  const oldByKey = groupByNodeKey(oldGraph.nodes);
  const newByKey = groupByNodeKey(newGraph.nodes);
  const allNodeKeys = new Set<string>([...oldByKey.keys(), ...newByKey.keys()]);

  for (const key of allNodeKeys) {
    const oldNodes = sortNodesForMatch(oldByKey.get(key) ?? []);
    const newNodes = sortNodesForMatch(newByKey.get(key) ?? []);

    if (oldNodes.length === 0) {
      for (const node of newNodes) {
        nodeStatus.set(node.id, "added");
      }
      continue;
    }
    if (newNodes.length === 0) {
      for (const node of oldNodes) {
        nodeStatus.set(node.id, "removed");
      }
      continue;
    }

    const matchedOld = new Set<string>();
    const matchedNew = new Set<string>();
    const newBySignature = new Map<string, GraphNode[]>();
    for (const node of newNodes) {
      const sig = signatureKey(node);
      const bucket = newBySignature.get(sig);
      if (bucket) {
        bucket.push(node);
      } else {
        newBySignature.set(sig, [node]);
      }
    }

    /* Prefer matching by position (startLine/endLine) so that when multiple nodes share
     * the same signature (e.g. branches from two useEffects with the same name), we pair
     * nodes at the same location instead of by iteration order (which can differ across
     * snapshots because node ids contain snapshotId and affect sort tiebreaker). */
    const pickMatch = (bucket: GraphNode[], oldNode: GraphNode): GraphNode | undefined => {
      const samePosition = bucket.find(
        (n) =>
          (n.startLine ?? -1) === (oldNode.startLine ?? -1) &&
          (n.endLine ?? -1) === (oldNode.endLine ?? -1),
      );
      if (samePosition) {
        const idx = bucket.indexOf(samePosition);
        bucket.splice(idx, 1);
        return samePosition;
      }
      return bucket.shift();
    };

    for (const oldNode of oldNodes) {
      const sig = signatureKey(oldNode);
      const bucket = newBySignature.get(sig);
      const match = bucket ? pickMatch(bucket, oldNode) : undefined;
      if (!match) continue;
      matchedOld.add(oldNode.id);
      matchedNew.add(match.id);
      nodeStatus.set(oldNode.id, "unchanged");
      nodeStatus.set(match.id, "unchanged");
    }

    const unmatchedOld = oldNodes.filter((node) => !matchedOld.has(node.id));
    const unmatchedNew = newNodes.filter((node) => !matchedNew.has(node.id));
    const modifiedPairs = Math.min(unmatchedOld.length, unmatchedNew.length);

    for (let idx = 0; idx < modifiedPairs; idx += 1) {
      const oldNode = unmatchedOld[idx];
      const newNode = unmatchedNew[idx];
      nodeStatus.set(oldNode.id, "modified");
      nodeStatus.set(newNode.id, "modified");
    }

    for (const node of unmatchedOld.slice(modifiedPairs)) {
      nodeStatus.set(node.id, "removed");
    }
    for (const node of unmatchedNew.slice(modifiedPairs)) {
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
