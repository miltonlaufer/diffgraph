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

  it("emits per-parameter diff states for function group nodes", () => {
    const oldNodes: GraphNode[] = [
      {
        id: "fn-old",
        kind: "Function",
        name: "processData",
        qualifiedName: "sample.processData",
        filePath: "sample.ts",
        language: "ts",
        signatureHash: "old-signature",
        metadata: {
          params: "(a, b)",
          paramsFull: "(a: string, b: boolean)",
        },
        snapshotId: "snap-old",
        ref: "old",
      },
    ];
    const newNodes: GraphNode[] = [
      {
        id: "fn-new",
        kind: "Function",
        name: "processData",
        qualifiedName: "sample.processData",
        filePath: "sample.ts",
        language: "ts",
        signatureHash: "new-signature",
        metadata: {
          params: "(a, c)",
          paramsFull: "(a: number, c: boolean)",
        },
        snapshotId: "snap-new",
        ref: "new",
      },
    ];
    const nodeStatus = new Map([
      ["fn-old", "modified" as const],
      ["fn-new", "modified" as const],
    ]);
    const delta: GraphDelta = {
      oldGraph: graph(oldNodes, []),
      newGraph: graph(newNodes, []),
      nodeStatus,
      edgeStatus: new Map(),
    };

    const view = buildLogicView(delta);
    const oldGroup = view.oldGraph.nodes.find((node) => node.id === "fn-old");
    const newGroup = view.newGraph.nodes.find((node) => node.id === "fn-new");

    expect(oldGroup?.functionParamDiff).toEqual([
      { text: "a: string", status: "modified" },
      { text: "b: boolean", status: "removed" },
    ]);
    expect(newGroup?.functionParamDiff).toEqual([
      { text: "a: number", status: "modified" },
      { text: "c: boolean", status: "added" },
    ]);
  });

  it("emits per-dependency diff states for hook callback group nodes", () => {
    const oldNodes: GraphNode[] = [
      {
        id: "effect-old",
        kind: "Function",
        name: "effectBody",
        qualifiedName: "sample.deep.effectBody",
        filePath: "sample.tsx",
        language: "ts",
        signatureHash: "effect-old",
        metadata: {
          params: "()",
          hookDependencies: "[count, mode]",
          wrappedBy: "useEffect",
        },
        snapshotId: "snap-old",
        ref: "old",
      },
    ];
    const newNodes: GraphNode[] = [
      {
        id: "effect-new",
        kind: "Function",
        name: "effectBody",
        qualifiedName: "sample.deep.effectBody",
        filePath: "sample.tsx",
        language: "ts",
        signatureHash: "effect-new",
        metadata: {
          params: "()",
          hookDependencies: "[count, modeId, status]",
          wrappedBy: "useEffect",
        },
        snapshotId: "snap-new",
        ref: "new",
      },
    ];
    const nodeStatus = new Map([
      ["effect-old", "modified" as const],
      ["effect-new", "modified" as const],
    ]);
    const delta: GraphDelta = {
      oldGraph: graph(oldNodes, []),
      newGraph: graph(newNodes, []),
      nodeStatus,
      edgeStatus: new Map(),
    };

    const view = buildLogicView(delta);
    const oldGroup = view.oldGraph.nodes.find((node) => node.id === "effect-old");
    const newGroup = view.newGraph.nodes.find((node) => node.id === "effect-new");

    expect(oldGroup?.hookDependencyDiff).toEqual([
      { text: "count", status: "unchanged" },
      { text: "mode", status: "modified" },
    ]);
    expect(newGroup?.hookDependencyDiff).toEqual([
      { text: "count", status: "unchanged" },
      { text: "modeId", status: "modified" },
      { text: "status", status: "added" },
    ]);
  });

  it("treats branch-to-function calls as invoke edges", () => {
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
        id: "branch-return",
        kind: "Branch",
        name: "return@2",
        qualifiedName: "sample.Panel::return#0",
        filePath: "sample.tsx",
        language: "ts",
        signatureHash: "return",
        metadata: { branchType: "return", codeSnippet: "return JSX <section>" },
        snapshotId: "snap",
        ref: "HEAD",
      },
      {
        id: "deep-callback",
        kind: "Function",
        name: "anonymous",
        qualifiedName: "sample.deep.anonymous",
        filePath: "sample.tsx",
        language: "ts",
        signatureHash: "callback",
        metadata: { params: "(e)" },
        snapshotId: "snap",
        ref: "HEAD",
      },
    ];

    const edges: GraphEdge[] = [
      {
        id: "declares-branch",
        source: "component-panel",
        target: "branch-return",
        kind: "DECLARES",
        snapshotId: "snap",
        ref: "HEAD",
      },
      {
        id: "declares-callback",
        source: "component-panel",
        target: "deep-callback",
        kind: "DECLARES",
        snapshotId: "snap",
        ref: "HEAD",
      },
      {
        id: "call-return-callback",
        source: "branch-return",
        target: "deep-callback",
        kind: "CALLS",
        snapshotId: "snap",
        ref: "HEAD",
      },
    ];

    const snapshot = graph(nodes, edges);
    const nodeStatus = new Map(nodes.map((node) => [node.id, "unchanged" as const]));
    const edgeStatus = new Map(edges.map((edge) => [edge.id, "unchanged" as const]));
    const delta: GraphDelta = { oldGraph: snapshot, newGraph: snapshot, nodeStatus, edgeStatus };

    const view = buildLogicView(delta);
    const invokeEdge = view.newGraph.edges.find((edge) => edge.id === "call-return-callback");
    expect(invokeEdge?.relation).toBe("invoke");
  });
});
