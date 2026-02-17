import { describe, expect, it } from "vitest";
import { computeSplitGraphDerived } from "./derived";

describe("computeSplitGraphDerived", () => {
  it("adds same-block upstream flow ancestors to hover neighborhood", () => {
    const result = computeSplitGraphDerived({
      graphNodes: [
        { id: "fn", label: "fn", kind: "group", filePath: "a.ts", diffStatus: "unchanged" },
        { id: "a", label: "a", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", parentId: "fn", branchType: "if" },
        { id: "b", label: "b", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", parentId: "fn", branchType: "call" },
        { id: "c", label: "c", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", parentId: "fn", branchType: "call" },
        { id: "otherUp", label: "otherUp", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", parentId: "otherFn", branchType: "call" },
        { id: "other", label: "other", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", parentId: "otherFn", branchType: "call" },
      ],
      positionedNodeIds: ["fn", "a", "b", "c", "otherUp", "other"],
      positionedEdges: [
        { id: "e-ab", source: "a", target: "b", relation: "flow" },
        { id: "e-bc", source: "b", target: "c", relation: "flow" },
        { id: "e-oc", source: "other", target: "c", relation: "flow" },
        { id: "e-ou-o", source: "otherUp", target: "other", relation: "flow" },
      ],
      searchQuery: "",
      searchExclude: false,
    });

    const byNodeId = new Map(result.hoverNeighborhoodByNodeIdEntries.map((entry) => [entry.nodeId, entry]));
    const cNeighborhood = byNodeId.get("c");

    expect(cNeighborhood).toBeTruthy();
    expect(cNeighborhood?.keepNodeIds).toContain("c");
    expect(cNeighborhood?.keepNodeIds).toContain("b");
    expect(cNeighborhood?.keepNodeIds).toContain("a");
    expect(cNeighborhood?.keepNodeIds).toContain("other");
    expect(cNeighborhood?.keepNodeIds).not.toContain("otherUp");
  });
});
