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
        { id: "d", label: "d", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", parentId: "fn", branchType: "call" },
        { id: "otherUp", label: "otherUp", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", parentId: "otherFn", branchType: "call" },
        { id: "other", label: "other", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", parentId: "otherFn", branchType: "call" },
      ],
      positionedNodeIds: ["fn", "a", "b", "c", "d", "otherUp", "other"],
      positionedEdges: [
        { id: "e-ab", source: "a", target: "b", relation: "flow" },
        { id: "e-bc", source: "b", target: "c", relation: "flow" },
        { id: "e-bd", source: "b", target: "d", relation: "flow" },
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
    expect(cNeighborhood?.keepNodeIds).not.toContain("d");
  });

  it("applies full ancestry expansion for group nodes within block boundaries", () => {
    const result = computeSplitGraphDerived({
      graphNodes: [
        { id: "g1", label: "Main block", kind: "group", filePath: "a.ts", diffStatus: "unchanged" },
        { id: "nested", label: "Nested block", kind: "group", filePath: "a.ts", diffStatus: "unchanged", parentId: "g1" },
        { id: "a", label: "a", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", parentId: "g1", branchType: "if" },
        { id: "b", label: "b", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", parentId: "g1", branchType: "call" },
        { id: "g2", label: "Other block", kind: "group", filePath: "a.ts", diffStatus: "unchanged" },
        { id: "x", label: "x", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", parentId: "nested", branchType: "call" },
        { id: "y", label: "y", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", parentId: "nested", branchType: "call" },
        { id: "z", label: "z", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", parentId: "g2", branchType: "call" },
      ],
      positionedNodeIds: ["g1", "nested", "a", "b", "g2", "x", "y", "z"],
      positionedEdges: [
        { id: "e-ab", source: "a", target: "b", relation: "flow" },
        { id: "e-xa", source: "x", target: "a", relation: "flow" },
        { id: "e-yx", source: "y", target: "x", relation: "flow" },
        { id: "e-az", source: "a", target: "z", relation: "flow" },
      ],
      searchQuery: "",
      searchExclude: false,
    });

    const byNodeId = new Map(result.hoverNeighborhoodByNodeIdEntries.map((entry) => [entry.nodeId, entry]));
    const groupNeighborhood = byNodeId.get("g1");

    expect(groupNeighborhood).toBeTruthy();
    expect(groupNeighborhood?.keepNodeIds).toContain("g1");
    expect(groupNeighborhood?.keepNodeIds).toContain("nested");
    expect(groupNeighborhood?.keepNodeIds).toContain("a");
    expect(groupNeighborhood?.keepNodeIds).toContain("b");
    expect(groupNeighborhood?.keepNodeIds).toContain("x");
    expect(groupNeighborhood?.keepNodeIds).toContain("y");
    expect(groupNeighborhood?.keepNodeIds).not.toContain("z");
  });

  it("removes descendants when excluded search matches a group", () => {
    const result = computeSplitGraphDerived({
      graphNodes: [
        { id: "g1", label: "watchdog", kind: "group", filePath: "a.ts", diffStatus: "unchanged" },
        { id: "c1", label: "child call", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", parentId: "g1", branchType: "call" },
        { id: "c2", label: "other child", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", parentId: "g1", branchType: "if" },
        { id: "g2", label: "safe group", kind: "group", filePath: "a.ts", diffStatus: "unchanged" },
        { id: "c3", label: "safe child", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", parentId: "g2", branchType: "call" },
      ],
      positionedNodeIds: ["g1", "c1", "c2", "g2", "c3"],
      positionedEdges: [],
      searchQuery: "watchdog",
      searchExclude: true,
    });

    expect(result.searchMatchIds).not.toContain("g1");
    expect(result.searchMatchIds).not.toContain("c1");
    expect(result.searchMatchIds).not.toContain("c2");
    expect(result.searchMatchIds).toContain("g2");
    expect(result.searchMatchIds).toContain("c3");
  });
});
