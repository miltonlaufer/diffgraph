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

  it("wraps class methods under a class group container", () => {
    const nodes: GraphNode[] = [
      {
        id: "class-controller",
        kind: "Class",
        name: "Controller",
        qualifiedName: "sample.Controller",
        filePath: "sample.ts",
        language: "ts",
        startLine: 1,
        endLine: 50,
        signatureHash: "class",
        snapshotId: "snap",
        ref: "HEAD",
      },
      {
        id: "method-init",
        kind: "Method",
        name: "init",
        qualifiedName: "sample.Controller.init",
        filePath: "sample.ts",
        language: "ts",
        startLine: 5,
        endLine: 12,
        signatureHash: "init",
        metadata: {
          params: "(req)",
          paramsFull: "(req: Request)",
        },
        snapshotId: "snap",
        ref: "HEAD",
      },
      {
        id: "method-run",
        kind: "Method",
        name: "run",
        qualifiedName: "sample.Controller.run",
        filePath: "sample.ts",
        language: "ts",
        startLine: 14,
        endLine: 24,
        signatureHash: "run",
        metadata: {
          params: "()",
          paramsFull: "()",
        },
        snapshotId: "snap",
        ref: "HEAD",
      },
    ];

    const edges: GraphEdge[] = [
      {
        id: "declares-method-init",
        source: "class-controller",
        target: "method-init",
        kind: "DECLARES",
        snapshotId: "snap",
        ref: "HEAD",
      },
      {
        id: "declares-method-run",
        source: "class-controller",
        target: "method-run",
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
    const classGroup = view.newGraph.nodes.find((node) => node.id === "class-controller");
    const initGroup = view.newGraph.nodes.find((node) => node.id === "method-init");
    const runGroup = view.newGraph.nodes.find((node) => node.id === "method-run");

    expect(classGroup?.kind).toBe("group");
    expect(classGroup?.label).toBe("[Class] Controller");
    expect(initGroup?.parentId).toBe("class-controller");
    expect(runGroup?.parentId).toBe("class-controller");
    expect(initGroup?.className).toBe("Controller");
    expect(runGroup?.className).toBe("Controller");
  });

  it("infers python class containers for class-qualified functions", () => {
    const nodes: GraphNode[] = [
      {
        id: "py-class",
        kind: "Class",
        name: "AudioController",
        qualifiedName: "audio.py:AudioController",
        filePath: "audio.py",
        language: "py",
        startLine: 1,
        endLine: 40,
        signatureHash: "py-class",
        snapshotId: "snap",
        ref: "HEAD",
      },
      {
        id: "py-init",
        kind: "Function",
        name: "__init__",
        qualifiedName: "audio.py:AudioController.__init__",
        filePath: "audio.py",
        language: "py",
        startLine: 2,
        endLine: 8,
        signatureHash: "py-init",
        metadata: {
          params: "(self)",
          paramsFull: "(self)",
        },
        snapshotId: "snap",
        ref: "HEAD",
      },
      {
        id: "py-run",
        kind: "Function",
        name: "run",
        qualifiedName: "audio.py:AudioController.run",
        filePath: "audio.py",
        language: "py",
        startLine: 10,
        endLine: 18,
        signatureHash: "py-run",
        metadata: {
          params: "(self)",
          paramsFull: "(self)",
        },
        snapshotId: "snap",
        ref: "HEAD",
      },
    ];

    const edges: GraphEdge[] = [
      {
        id: "declares-file-class",
        source: "file-audio",
        target: "py-class",
        kind: "DECLARES",
        snapshotId: "snap",
        ref: "HEAD",
      },
      {
        id: "declares-file-init",
        source: "file-audio",
        target: "py-init",
        kind: "DECLARES",
        snapshotId: "snap",
        ref: "HEAD",
      },
      {
        id: "declares-file-run",
        source: "file-audio",
        target: "py-run",
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
    const classGroup = view.newGraph.nodes.find((node) => node.id === "py-class");
    const initGroup = view.newGraph.nodes.find((node) => node.id === "py-init");
    const runGroup = view.newGraph.nodes.find((node) => node.id === "py-run");

    expect(classGroup?.kind).toBe("group");
    expect(classGroup?.label).toBe("[Class] AudioController");
    expect(initGroup?.parentId).toBe("py-class");
    expect(runGroup?.parentId).toBe("py-class");
    expect(initGroup?.className).toBe("AudioController");
    expect(runGroup?.className).toBe("AudioController");
  });
});
