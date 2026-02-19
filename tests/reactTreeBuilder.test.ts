import { describe, expect, it } from "vitest";
import type { GraphDelta } from "../src/core/diff/graphDelta.js";
import type { GraphEdge, GraphNode, SnapshotGraph } from "../src/core/graph/schema.js";
import { buildReactView } from "../src/core/views/reactTreeBuilder.js";

const snapshotGraph = (nodes: GraphNode[], edges: GraphEdge[]): SnapshotGraph => ({
  repoId: "repo",
  snapshotId: "snap",
  ref: "HEAD",
  nodes,
  edges,
});

describe("buildReactView", () => {
  it("includes hook/jsx branches and derives JSX render edges for React view", () => {
    const nodes: GraphNode[] = [
      {
        id: "cmp-panel",
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
        id: "cmp-header",
        kind: "ReactComponent",
        name: "Header",
        qualifiedName: "sample.Header",
        filePath: "sample.tsx",
        language: "ts",
        signatureHash: "header",
        snapshotId: "snap",
        ref: "HEAD",
      },
      {
        id: "branch-hook",
        kind: "Branch",
        name: "call@10",
        qualifiedName: "sample.Panel::call#0",
        filePath: "sample.tsx",
        language: "ts",
        signatureHash: "hook-branch",
        metadata: {
          branchType: "call",
          codeSnippet: "useEffect(..., [count])",
          hookName: "useEffect",
          hookDependencies: "[count]",
        },
        snapshotId: "snap",
        ref: "HEAD",
      },
      {
        id: "branch-jsx",
        kind: "Branch",
        name: "return@20",
        qualifiedName: "sample.Panel::return#0",
        filePath: "sample.tsx",
        language: "ts",
        signatureHash: "jsx-branch",
        metadata: {
          branchType: "return",
          codeSnippet: "return JSX <Header>",
          containsJsx: true,
          jsxTagNames: "Header",
        },
        snapshotId: "snap",
        ref: "HEAD",
      },
    ];

    const edges: GraphEdge[] = [
      {
        id: "declares-hook",
        source: "cmp-panel",
        target: "branch-hook",
        kind: "DECLARES",
        snapshotId: "snap",
        ref: "HEAD",
      },
      {
        id: "declares-jsx",
        source: "cmp-panel",
        target: "branch-jsx",
        kind: "DECLARES",
        snapshotId: "snap",
        ref: "HEAD",
      },
      {
        id: "flow-panel-hook",
        source: "cmp-panel",
        target: "branch-hook",
        kind: "CALLS",
        metadata: { flowType: "next" },
        snapshotId: "snap",
        ref: "HEAD",
      },
      {
        id: "flow-hook-jsx",
        source: "branch-hook",
        target: "branch-jsx",
        kind: "CALLS",
        metadata: { flowType: "next" },
        snapshotId: "snap",
        ref: "HEAD",
      },
      {
        id: "render-panel-header",
        source: "cmp-panel",
        target: "cmp-header",
        kind: "RENDERS",
        snapshotId: "snap",
        ref: "HEAD",
      },
    ];

    const graph = snapshotGraph(nodes, edges);
    const nodeStatus = new Map(nodes.map((node) => [node.id, "unchanged" as const]));
    const edgeStatus = new Map(edges.map((edge) => [edge.id, "unchanged" as const]));
    const delta: GraphDelta = { oldGraph: graph, newGraph: graph, nodeStatus, edgeStatus };

    const reactView = buildReactView(delta);
    const labels = reactView.newGraph.nodes.map((node) => node.label);

    expect(labels.some((label) => label.includes("Hook: useEffect deps: [count]"))).toBe(true);
    expect(labels.some((label) => label.includes("JSX: <Header>"))).toBe(true);

    expect(
      reactView.newGraph.edges.some(
        (edge) => edge.kind === "RENDERS" && edge.source === "branch-jsx" && edge.target === "cmp-header",
      ),
    ).toBe(true);
  });
});
