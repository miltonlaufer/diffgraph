import { describe, expect, it } from "vitest";
import type { ViewGraph } from "#/types/graph";
import { computeLayoutByView } from "./layout";

describe("computeLayoutByView", () => {
  it("keeps decision branch handle mapping for true/false/next flow", () => {
    const graph: ViewGraph = {
      nodes: [
        { id: "if1", label: "if@10\nif (cond)", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", branchType: "if" },
        { id: "then1", label: "call@11\nthen()", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", branchType: "call" },
        { id: "else1", label: "call@12\nelse()", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", branchType: "call" },
      ],
      edges: [
        { id: "e-if-true", source: "if1", target: "then1", kind: "CALLS", relation: "flow", flowType: "true", diffStatus: "unchanged" },
        { id: "e-if-false", source: "if1", target: "else1", kind: "CALLS", relation: "flow", flowType: "false", diffStatus: "unchanged" },
        { id: "e-if-next", source: "if1", target: "else1", kind: "CALLS", relation: "flow", flowType: "next", diffStatus: "unchanged" },
      ],
    };

    const layout = computeLayoutByView("logic", graph, "", new Map(), true);
    const edgeById = new Map(layout.edges.map((edge) => [edge.id, edge]));

    expect(edgeById.get("e-if-true")?.sourceHandle).toBe("yes");
    expect(edgeById.get("e-if-false")?.sourceHandle).toBe("no");
    expect(edgeById.get("e-if-next")?.sourceHandle).toBe("next");
  });

  it("does not assign decision handles for try/catch flow edges", () => {
    const graph: ViewGraph = {
      nodes: [
        { id: "try1", label: "try@20\ntry", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", branchType: "try" },
        { id: "call1", label: "call@21\ndoWork()", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", branchType: "call" },
        { id: "catch1", label: "catch@22\ncatch (err)", kind: "Branch", filePath: "a.ts", diffStatus: "unchanged", branchType: "catch" },
      ],
      edges: [
        { id: "e-try-next", source: "try1", target: "call1", kind: "CALLS", relation: "flow", flowType: "next", diffStatus: "unchanged" },
        { id: "e-try-catch", source: "try1", target: "catch1", kind: "CALLS", relation: "flow", flowType: "false", diffStatus: "unchanged" },
      ],
    };

    const layout = computeLayoutByView("logic", graph, "", new Map(), true);
    const edgeById = new Map(layout.edges.map((edge) => [edge.id, edge]));
    const tryCatch = edgeById.get("e-try-catch");

    expect(tryCatch).toBeTruthy();
    expect(tryCatch?.sourceHandle).toBeUndefined();
    expect(tryCatch?.targetHandle).toBeUndefined();
  });
});
