import type { DiffPayload } from "../git/diffProvider.js";
import { buildGraphDelta, type GraphDelta } from "./graphDelta.js";
import type { GraphNode, SnapshotGraph, SymbolDiffDetail, ViewGraph } from "../graph/schema.js";
import { TsAnalyzer } from "../parsing/tsAnalyzer.js";
import { PyAnalyzer } from "../parsing/pyAnalyzer.js";
import { stableHash } from "../utils/hash.js";
import { buildKnowledgeView } from "../views/knowledgeViewBuilder.js";
import { buildLogicView } from "../views/logicFlowBuilder.js";
import { buildReactView } from "../views/reactTreeBuilder.js";

export interface DiffResult {
  diffId: string;
  oldGraph: SnapshotGraph;
  newGraph: SnapshotGraph;
  delta: GraphDelta;
  views: {
    logic: { oldGraph: ViewGraph; newGraph: ViewGraph };
    knowledge: { oldGraph: ViewGraph; newGraph: ViewGraph };
    react: { oldGraph: ViewGraph; newGraph: ViewGraph };
  };
  hunksByPath: Map<string, string[]>;
  oldFileContents: Map<string, string>;
  newFileContents: Map<string, string>;
}

const normalizePath = (value: string): string =>
  value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");

const hasFileNode = (nodes: GraphNode[], filePath: string): boolean => {
  const normalizedTarget = normalizePath(filePath);
  return nodes.some((node) => node.kind === "File" && normalizePath(node.filePath) === normalizedTarget);
};

export class DiffEngine {
  private readonly tsAnalyzer = new TsAnalyzer();

  private readonly pyAnalyzer = new PyAnalyzer();

  public async run(repoId: string, payload: DiffPayload): Promise<DiffResult> {
    const oldSnapshotId = stableHash(`${repoId}:${payload.oldRef}`);
    const newSnapshotId = stableHash(`${repoId}:${payload.newRef}`);

    const [oldTs, newTs, oldPy, newPy] = await Promise.all([
      this.tsAnalyzer.analyze(repoId, oldSnapshotId, payload.oldRef, payload.oldFiles),
      this.tsAnalyzer.analyze(repoId, newSnapshotId, payload.newRef, payload.newFiles),
      this.pyAnalyzer.analyze(repoId, oldSnapshotId, payload.oldRef, payload.oldFiles),
      this.pyAnalyzer.analyze(repoId, newSnapshotId, payload.newRef, payload.newFiles),
    ]);

    const oldGraph: SnapshotGraph = {
      repoId,
      snapshotId: oldSnapshotId,
      ref: payload.oldRef,
      nodes: [...oldTs.nodes, ...oldPy.nodes],
      edges: [...oldTs.edges, ...oldPy.edges],
    };

    const newGraph: SnapshotGraph = {
      repoId,
      snapshotId: newSnapshotId,
      ref: payload.newRef,
      nodes: [...newTs.nodes, ...newPy.nodes],
      edges: [...newTs.edges, ...newPy.edges],
    };
    this.addMissingFileNodes(oldGraph, newGraph, payload);

    const delta = buildGraphDelta(oldGraph, newGraph);
    const views = {
      logic: buildLogicView(delta),
      knowledge: buildKnowledgeView(delta),
      react: buildReactView(delta),
    };

    const oldFileContents = new Map<string, string>();
    const newFileContents = new Map<string, string>();
    for (const file of payload.oldFiles) {
      oldFileContents.set(normalizePath(file.path), file.content);
    }
    for (const file of payload.newFiles) {
      newFileContents.set(normalizePath(file.path), file.content);
    }

    return {
      diffId: stableHash(`${repoId}:${payload.oldRef}:${payload.newRef}:${Date.now()}`),
      oldGraph,
      newGraph,
      delta,
      views,
      hunksByPath: payload.hunksByPath,
      oldFileContents,
      newFileContents,
    };
  }

  private addMissingFileNodes(oldGraph: SnapshotGraph, newGraph: SnapshotGraph, payload: DiffPayload): void {
    for (const path of payload.files) {
      const oldFile = payload.oldFiles.find((item) => normalizePath(item.path) === normalizePath(path));
      const newFile = payload.newFiles.find((item) => normalizePath(item.path) === normalizePath(path));
      const normalized = normalizePath(path);

      if ((oldFile?.content ?? "").length > 0 && !hasFileNode(oldGraph.nodes, normalized)) {
        oldGraph.nodes.push({
          id: stableHash(`${oldGraph.snapshotId}:file:${normalized}`),
          kind: "File",
          name: normalized.split("/").pop() ?? normalized,
          qualifiedName: normalized,
          filePath: normalized,
          language: "unknown",
          signatureHash: stableHash(oldFile?.content ?? ""),
          snapshotId: oldGraph.snapshotId,
          ref: oldGraph.ref,
        });
      }

      if ((newFile?.content ?? "").length > 0 && !hasFileNode(newGraph.nodes, normalized)) {
        newGraph.nodes.push({
          id: stableHash(`${newGraph.snapshotId}:file:${normalized}`),
          kind: "File",
          name: normalized.split("/").pop() ?? normalized,
          qualifiedName: normalized,
          filePath: normalized,
          language: "unknown",
          signatureHash: stableHash(newFile?.content ?? ""),
          snapshotId: newGraph.snapshotId,
          ref: newGraph.ref,
        });
      }
    }
  }

  public getSymbolDetail(result: DiffResult, symbolId: string): SymbolDiffDetail {
    const oldNode = result.oldGraph.nodes.find((node) => node.id === symbolId);
    const newNode = result.newGraph.nodes.find((node) => node.id === symbolId);
    const path = normalizePath(newNode?.filePath ?? oldNode?.filePath ?? "");
    const hunks = Array.from(result.hunksByPath.entries()).find(
      ([candidatePath]) => normalizePath(candidatePath) === path,
    )?.[1];

    return {
      symbolId,
      oldNode,
      newNode,
      hunks: hunks ?? [],
    };
  }
}
