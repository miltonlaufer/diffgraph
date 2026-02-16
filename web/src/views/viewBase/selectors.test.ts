import { describe, expect, it } from "vitest";
import type { ViewGraph } from "#/types/graph";
import { computeVisibleGraph } from "./selectors";

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

