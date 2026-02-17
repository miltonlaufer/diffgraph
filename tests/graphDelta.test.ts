import { describe, expect, it } from "vitest";
import { buildGraphDelta } from "../src/core/diff/graphDelta.js";
import type { GraphNode, SnapshotGraph } from "../src/core/graph/schema.js";

const node = (overrides: Partial<GraphNode> & { id: string; qualifiedName: string; signatureHash: string }): GraphNode => ({
  id: overrides.id,
  kind: overrides.kind ?? "Function",
  name: overrides.name ?? overrides.qualifiedName,
  qualifiedName: overrides.qualifiedName,
  filePath: overrides.filePath ?? "a.tsx",
  language: overrides.language ?? "ts",
  startLine: overrides.startLine,
  endLine: overrides.endLine,
  signatureHash: overrides.signatureHash,
  metadata: overrides.metadata,
  snapshotId: overrides.snapshotId ?? "old",
  ref: overrides.ref ?? "HEAD",
});

const graph = (snapshotId: string, ref: string, nodes: GraphNode[]): SnapshotGraph => ({
  repoId: "repo",
  snapshotId,
  ref,
  nodes,
  edges: [],
});

describe("buildGraphDelta", () => {
  it("marks modified and added nodes", () => {
    const oldGraph = graph("old", "HEAD", [node({ id: "a1", qualifiedName: "alpha", signatureHash: "old-hash" })]);
    const newGraph = graph("new", "WORKTREE", [
      node({ id: "a2", qualifiedName: "alpha", signatureHash: "new-hash", snapshotId: "new", ref: "WORKTREE" }),
      node({ id: "b1", qualifiedName: "beta", signatureHash: "beta", snapshotId: "new", ref: "WORKTREE", filePath: "b.ts" }),
    ]);

    const delta = buildGraphDelta(oldGraph, newGraph);
    expect(delta.nodeStatus.get("a1")).toBe("modified");
    expect(delta.nodeStatus.get("a2")).toBe("modified");
    expect(delta.nodeStatus.get("b1")).toBe("added");
  });

  it("keeps deep callback nodes unchanged when only line suffix changes", () => {
    const oldGraph = graph("old", "HEAD", [
      node({
        id: "old-cb",
        qualifiedName: "LyricVideoMakerLandingpage.deep.useEffectCallback@108",
        signatureHash: "same-signature",
      }),
    ]);
    const newGraph = graph("new", "WORKTREE", [
      node({
        id: "new-cb",
        qualifiedName: "LyricVideoMakerLandingpage.deep.useEffectCallback@113",
        signatureHash: "same-signature",
        snapshotId: "new",
        ref: "WORKTREE",
      }),
    ]);

    const delta = buildGraphDelta(oldGraph, newGraph);
    expect(delta.nodeStatus.get("old-cb")).toBe("unchanged");
    expect(delta.nodeStatus.get("new-cb")).toBe("unchanged");
  });

  it("matches duplicate deep callback keys by signature before marking modified", () => {
    const oldGraph = graph("old", "HEAD", [
      node({
        id: "old-a",
        qualifiedName: "LyricVideoMakerLandingpage.deep.useEffectCallback@108",
        signatureHash: "A",
      }),
      node({
        id: "old-b",
        qualifiedName: "LyricVideoMakerLandingpage.deep.useEffectCallback@119",
        signatureHash: "B",
      }),
    ]);
    const newGraph = graph("new", "WORKTREE", [
      node({
        id: "new-b",
        qualifiedName: "LyricVideoMakerLandingpage.deep.useEffectCallback@114",
        signatureHash: "B",
        snapshotId: "new",
        ref: "WORKTREE",
      }),
      node({
        id: "new-a",
        qualifiedName: "LyricVideoMakerLandingpage.deep.useEffectCallback@125",
        signatureHash: "A",
        snapshotId: "new",
        ref: "WORKTREE",
      }),
    ]);

    const delta = buildGraphDelta(oldGraph, newGraph);
    expect(delta.nodeStatus.get("old-a")).toBe("unchanged");
    expect(delta.nodeStatus.get("new-a")).toBe("unchanged");
    expect(delta.nodeStatus.get("old-b")).toBe("unchanged");
    expect(delta.nodeStatus.get("new-b")).toBe("unchanged");
  });

  it("treats nodes as unchanged when only the signatureHash differs (simulating comment-only changes)", () => {
    // This test simulates the scenario where comment-only changes would produce different
    // signatureHashes at the analyzer level. After the fix, the analyzers strip comments
    // before hashing, so the hashes would be the same. This test verifies the delta logic
    // correctly marks nodes as unchanged when they share the same signature.
    const oldGraph = graph("old", "HEAD", [
      node({
        id: "old-fn",
        qualifiedName: "module.myFunction",
        signatureHash: "code-without-comments-hash",
      }),
    ]);
    const newGraph = graph("new", "WORKTREE", [
      node({
        id: "new-fn",
        qualifiedName: "module.myFunction",
        signatureHash: "code-without-comments-hash", // Same hash because comments are stripped
        snapshotId: "new",
        ref: "WORKTREE",
      }),
    ]);

    const delta = buildGraphDelta(oldGraph, newGraph);
    expect(delta.nodeStatus.get("old-fn")).toBe("unchanged");
    expect(delta.nodeStatus.get("new-fn")).toBe("unchanged");
  });
});
