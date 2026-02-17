import { describe, expect, it } from "vitest";
import { buildCrossGraphNodeMatchKey } from "#/lib/nodeIdentity";
import type { ViewGraphNode } from "#/types/graph";
import {
  commandOpenCodeLogicTree,
  commandSetHoveredNode,
} from "./commands";
import { ViewBaseStore } from "./store";

const createContext = (store: ViewBaseStore) => ({
  store,
  runInteractiveUpdate: (update: () => void) => update(),
});

const createNode = (node: Partial<ViewGraphNode>): ViewGraphNode => ({
  id: node.id ?? "n1",
  kind: node.kind ?? "Function",
  label: node.label ?? "fn",
  diffStatus: node.diffStatus ?? "modified",
  filePath: node.filePath ?? "src/file.ts",
  fileName: node.fileName,
  className: node.className,
  startLine: node.startLine,
  endLine: node.endLine,
  parentId: node.parentId,
  branchType: node.branchType,
  functionParams: node.functionParams,
  returnType: node.returnType,
  documentation: node.documentation,
});

describe("viewBase commands", () => {
  it("sanitizes and sorts logic-tree line requests", () => {
    const store = new ViewBaseStore();
    store.oldGraph = { nodes: [createNode({ id: "node-1", startLine: 10 })], edges: [] };
    store.newGraph = { nodes: [], edges: [] };

    commandOpenCodeLogicTree(
      createContext(store),
      "node-1",
      "old",
      [12, 12, 3.9, 0, -3, Number.NaN],
    );

    expect(store.selectedNodeId).toBe("node-1");
    expect(store.selectedFilePath).toBe("src/file.ts");
    expect(store.targetSide).toBe("old");
    expect(store.targetLine).toBe(3);
    expect(store.codeLogicTreeRequestSide).toBe("old");
    expect(store.codeLogicTreeRequestLines).toEqual([3, 12]);
  });

  it("falls back to node start line when no valid request lines are provided", () => {
    const store = new ViewBaseStore();
    store.oldGraph = { nodes: [createNode({ id: "node-2", startLine: 27 })], edges: [] };
    store.newGraph = { nodes: [], edges: [] };

    commandOpenCodeLogicTree(createContext(store), "node-2", "old", [-2, 0, Number.NaN]);

    expect(store.targetLine).toBe(27);
    expect(store.codeLogicTreeRequestLines).toEqual([27]);
  });

  it("derives hover match key from source node when none is supplied", () => {
    const store = new ViewBaseStore();
    const node = createNode({
      id: "node-3",
      kind: "Branch",
      label: "[old] check @9 line 11",
      branchType: "TRUE",
      startLine: 11,
      filePath: "src/flow.ts",
    });
    store.oldGraph = { nodes: [node], edges: [] };
    store.newGraph = { nodes: [], edges: [] };

    commandSetHoveredNode(createContext(store), "old", "node-3", "");

    expect(store.hoveredNodeSide).toBe("old");
    expect(store.hoveredNodeId).toBe("node-3");
    expect(store.hoveredNodeMatchKey).toBe(buildCrossGraphNodeMatchKey(node));
    expect(store.hoveredCodeLine).toBe(11);
    expect(store.hoveredCodeSide).toBe("old");
  });
});
