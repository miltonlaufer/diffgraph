import { describe, expect, it } from "vitest";
import { buildGraphDelta } from "../src/core/diff/graphDelta.js";

describe("buildGraphDelta", () => {
  it("marks modified and added nodes", () => {
    const oldGraph = {
      repoId: "repo",
      snapshotId: "old",
      ref: "HEAD",
      nodes: [
        {
          id: "a1",
          kind: "Function" as const,
          name: "alpha",
          qualifiedName: "alpha",
          filePath: "a.ts",
          language: "ts" as const,
          signatureHash: "old-hash",
          snapshotId: "old",
          ref: "HEAD",
        },
      ],
      edges: [],
    };
    const newGraph = {
      repoId: "repo",
      snapshotId: "new",
      ref: "WORKTREE",
      nodes: [
        {
          id: "a2",
          kind: "Function" as const,
          name: "alpha",
          qualifiedName: "alpha",
          filePath: "a.ts",
          language: "ts" as const,
          signatureHash: "new-hash",
          snapshotId: "new",
          ref: "WORKTREE",
        },
        {
          id: "b1",
          kind: "Function" as const,
          name: "beta",
          qualifiedName: "beta",
          filePath: "b.ts",
          language: "ts" as const,
          signatureHash: "beta",
          snapshotId: "new",
          ref: "WORKTREE",
        },
      ],
      edges: [],
    };

    const delta = buildGraphDelta(oldGraph, newGraph);
    expect(delta.nodeStatus.get("a1")).toBe("modified");
    expect(delta.nodeStatus.get("a2")).toBe("modified");
    expect(delta.nodeStatus.get("b1")).toBe("added");
  });
});
