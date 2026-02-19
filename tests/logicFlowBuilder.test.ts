import { describe, expect, it } from "vitest";
import type { GraphDelta } from "../src/core/diff/graphDelta.js";
import type { GraphEdge, GraphNode, SnapshotGraph } from "../src/core/graph/schema.js";
import { buildLogicView } from "../src/core/views/logicFlowBuilder.js";

const graph = (nodes: GraphNode[], edges: GraphEdge[]): SnapshotGraph => ({
  repoId: "repo",
  snapshotId: "snap",
  ref: "HEAD",
  nodes,
  edges,
});

describe("buildLogicView", () => {
  it("shows hook dependency arrays in wrapped callback labels", () => {
    const nodes: GraphNode[] = [
      {
        id: "component-panel",
        kind: "ReactComponent",
        name: "Panel",
        qualifiedName: "sample.Panel",
        filePath: "sample.tsx",
        language: "ts",
        signatureHash: "panel",
        snapshotId: "snap",
        ref: "HEAD",
      },
      {
        id: "deep-effect",
        kind: "Function",
        name: "effectBody",
        qualifiedName: "sample.deep.effectBody",
        filePath: "sample.tsx",
        language: "ts",
        signatureHash: "effect",
        metadata: {
          params: "()",
          wrappedBy: "useEffect",
          hookDependencies: "[count, mode]",
        },
        snapshotId: "snap",
        ref: "HEAD",
      },
    ];

    const edges: GraphEdge[] = [
      {
        id: "declares-effect",
        source: "component-panel",
        target: "deep-effect",
        kind: "DECLARES",
        snapshotId: "snap",
        ref: "HEAD",
      },
    ];

    const snapshot = graph(nodes, edges);
    const nodeStatus = new Map(nodes.map((node) => [node.id, "unchanged" as const]));
    const edgeStatus = new Map(edges.map((edge) => [edge.id, "unchanged" as const]));
    const delta: GraphDelta = { oldGraph: snapshot, newGraph: snapshot, nodeStatus, edgeStatus };

    const view = buildLogicView(delta);
    const effectGroup = view.newGraph.nodes.find((node) => node.id === "deep-effect");
    expect(effectGroup?.label).toContain("[useEffect deps: [count, mode]]");
  });
});
