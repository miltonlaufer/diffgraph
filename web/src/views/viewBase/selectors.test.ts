import { describe, expect, it } from "vitest";
import type { ViewGraph } from "#/types/graph";
import { computeVisibleGraph, resolveAdjacentLogicTreeNodeId } from "./selectors";

describe("computeVisibleGraph", () => {
  it("keeps unchanged flow neighbors for changed logic nodes in changes-only mode", () => {
    const baseGraph: ViewGraph = {
      nodes: [
        { id: "if1", label: "if@10\nif clip:", kind: "Branch", filePath: "a.py", diffStatus: "modified", branchType: "if" },
        { id: "if2", label: "if@20\nif not is_success:", kind: "Branch", filePath: "a.py", diffStatus: "unchanged", branchType: "if" },
      ],
      edges: [
        { id: "e1", source: "if1", target: "if2", kind: "CALLS", relation: "flow", flowType: "next", diffStatus: "unchanged" },
      ],
    };

    const visible = computeVisibleGraph(baseGraph, baseGraph, true, "logic");
    const ids = new Set(visible.nodes.map((node) => node.id));

    expect(ids.has("if1")).toBe(true);
    expect(ids.has("if2")).toBe(true);
    expect(visible.edges).toHaveLength(1);
    expect(visible.edges[0]?.id).toBe("e1");
  });
});

describe("resolveAdjacentLogicTreeNodeId", () => {
  it("follows flow edges instead of source line order", () => {
    const graph: ViewGraph = {
      nodes: [
        { id: "n200", label: "call@200", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", startLine: 200 },
        { id: "n202", label: "call@202", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", startLine: 202 },
        { id: "n209", label: "if@209", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", startLine: 209 },
      ],
      edges: [
        { id: "e-200-209", source: "n200", target: "n209", kind: "CALLS", relation: "flow", flowType: "next", diffStatus: "unchanged" },
      ],
    };

    expect(resolveAdjacentLogicTreeNodeId(graph, "n200", "next")).toBe("n209");
  });

  it("prefers `next` flow over true/false alternatives", () => {
    const graph: ViewGraph = {
      nodes: [
        { id: "if-1", label: "if@10", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", startLine: 10 },
        { id: "then-1", label: "then@11", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", startLine: 11 },
        { id: "else-1", label: "else@12", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", startLine: 12 },
        { id: "after-if", label: "call@20", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", startLine: 20 },
      ],
      edges: [
        { id: "e-if-true", source: "if-1", target: "then-1", kind: "CALLS", relation: "flow", flowType: "true", diffStatus: "unchanged" },
        { id: "e-if-false", source: "if-1", target: "else-1", kind: "CALLS", relation: "flow", flowType: "false", diffStatus: "unchanged" },
        { id: "e-if-next", source: "if-1", target: "after-if", kind: "CALLS", relation: "flow", flowType: "next", diffStatus: "unchanged" },
      ],
    };

    expect(resolveAdjacentLogicTreeNodeId(graph, "if-1", "next")).toBe("after-if");
  });
});
