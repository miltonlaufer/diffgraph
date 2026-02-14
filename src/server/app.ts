import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DiffResult } from "../core/diff/diffEngine.js";
import type { Neo4jStore } from "../core/graph/neo4jStore.js";

export interface AppContext {
  store: Neo4jStore;
  results: Map<string, DiffResult>;
}

const normalizePath = (value: string): string =>
  value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");

const symbolKinds = new Set(["Function", "Method", "Class", "ReactComponent", "Hook"]);
const invokeEdgeKinds = new Set(["CALLS", "RENDERS", "USES_HOOK", "EXPOSES_ENDPOINT"]);

type SymbolDiffStatus = "added" | "removed" | "modified" | "unchanged";

interface NodeEdgeStats {
  incomingCalls: number;
  outgoingCalls: number;
  incomingDeclares: number;
  outgoingDeclares: number;
}

const ensureStats = (map: Map<string, NodeEdgeStats>, nodeId: string): NodeEdgeStats => {
  const existing = map.get(nodeId);
  if (existing) {
    return existing;
  }
  const stats: NodeEdgeStats = {
    incomingCalls: 0,
    outgoingCalls: 0,
    incomingDeclares: 0,
    outgoingDeclares: 0,
  };
  map.set(nodeId, stats);
  return stats;
};

const buildNodeEdgeStats = (result: DiffResult): { oldStats: Map<string, NodeEdgeStats>; newStats: Map<string, NodeEdgeStats> } => {
  const oldStats = new Map<string, NodeEdgeStats>();
  const newStats = new Map<string, NodeEdgeStats>();
  for (const edge of result.oldGraph.edges) {
    const source = ensureStats(oldStats, edge.source);
    const target = ensureStats(oldStats, edge.target);
    if (invokeEdgeKinds.has(edge.kind)) {
      source.outgoingCalls += 1;
      target.incomingCalls += 1;
    } else if (edge.kind === "DECLARES") {
      source.outgoingDeclares += 1;
      target.incomingDeclares += 1;
    }
  }
  for (const edge of result.newGraph.edges) {
    const source = ensureStats(newStats, edge.source);
    const target = ensureStats(newStats, edge.target);
    if (invokeEdgeKinds.has(edge.kind)) {
      source.outgoingCalls += 1;
      target.incomingCalls += 1;
    } else if (edge.kind === "DECLARES") {
      source.outgoingDeclares += 1;
      target.incomingDeclares += 1;
    }
  }
  return { oldStats, newStats };
};

const lineSpan = (startLine?: number, endLine?: number): number => {
  if (!startLine || !endLine) {
    return 0;
  }
  return Math.max(1, endLine - startLine + 1);
};

const isLikelyPublicSymbol = (kind: string, name: string): boolean => {
  if (name.startsWith("_")) {
    return false;
  }
  if (kind === "Method") {
    return !name.startsWith("#");
  }
  return true;
};

const computeSymbolRiskScore = (
  diffStatus: SymbolDiffStatus,
  kind: string,
  callFanIn: number,
  callFanOut: number,
  declaresOwned: number,
  spanLines: number,
  name: string,
): number => {
  if (diffStatus === "unchanged") {
    return 0;
  }
  const statusWeight: Record<Exclude<SymbolDiffStatus, "unchanged">, number> = {
    added: 3,
    removed: 3,
    modified: 4,
  };
  const kindWeight: Record<string, number> = {
    Class: 4,
    Function: 3,
    Method: 2,
    ReactComponent: 3,
    Hook: 3,
  };
  const spanWeight = spanLines >= 200 ? 3 : spanLines >= 80 ? 2 : spanLines >= 25 ? 1 : 0;
  const fanInWeight = Math.min(5, Math.floor(callFanIn / 2));
  const fanOutWeight = Math.min(3, Math.floor(callFanOut / 3));
  const ownershipWeight = Math.min(2, Math.floor(declaresOwned / 4));
  const publicWeight = isLikelyPublicSymbol(kind, name) ? 1 : 0;
  return Math.max(
    1,
    statusWeight[diffStatus] + (kindWeight[kind] ?? 2) + spanWeight + fanInWeight + fanOutWeight + ownershipWeight + publicWeight,
  );
};

const countLineChurn = (hunks: string[]): number => {
  let churn = 0;
  for (const hunk of hunks) {
    for (const line of hunk.split("\n")) {
      if ((line.startsWith("+") && !line.startsWith("+++")) || (line.startsWith("-") && !line.startsWith("---"))) {
        churn += 1;
      }
    }
  }
  return churn;
};

const riskLevel = (score: number): "low" | "medium" | "high" => {
  if (score >= 25) return "high";
  if (score >= 12) return "medium";
  return "low";
};

export const createApp = (context: AppContext): express.Express => {
  const app = express();
  app.use(express.json({ limit: "5mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/views/:diffId/:viewType", (req, res) => {
    const result = context.results.get(req.params.diffId);
    if (!result) {
      res.status(404).json({ error: "diff not found" });
      return;
    }

    const viewType = req.params.viewType as "logic" | "knowledge" | "react";
    const view = result.views[viewType];
    if (!view) {
      res.status(404).json({ error: "view not found" });
      return;
    }

    res.json(view);
  });

  app.get("/api/diff/:diffId/symbol/:symbolId", (req, res) => {
    const result = context.results.get(req.params.diffId);
    if (!result) {
      res.status(404).json({ error: "diff not found" });
      return;
    }

    const oldNode = result.oldGraph.nodes.find((node) => node.id === req.params.symbolId);
    const newNode = result.newGraph.nodes.find((node) => node.id === req.params.symbolId);
    const pathKey = normalizePath(newNode?.filePath ?? oldNode?.filePath ?? "");
    const hunks = Array.from(result.hunksByPath.entries()).find(
      ([candidate]) => normalizePath(candidate) === pathKey,
    )?.[1];
    res.json({
      symbolId: req.params.symbolId,
      oldNode,
      newNode,
      hunks: hunks ?? [],
    });
  });

  app.get("/api/diff/:diffId/meta", (req, res) => {
    const result = context.results.get(req.params.diffId);
    if (!result) {
      res.status(404).json({ error: "diff not found" });
      return;
    }
    const allNodes = [...result.oldGraph.nodes, ...result.newGraph.nodes];
    const hasReactView = allNodes.some((node) =>
      node.kind === "ReactComponent"
      || node.kind === "Hook"
      || ((node.kind === "File") && (node.language === "ts" || node.language === "js"))
    );
    res.json({
      diffId: result.diffId,
      oldRef: result.oldGraph.ref,
      newRef: result.newGraph.ref,
      oldSnapshotId: result.oldGraph.snapshotId,
      newSnapshotId: result.newGraph.snapshotId,
      hasReactView,
    });
  });

  app.get("/api/diff/:diffId/files", (req, res) => {
    const result = context.results.get(req.params.diffId);
    if (!result) {
      res.status(404).json({ error: "diff not found" });
      return;
    }

    const { oldStats, newStats } = buildNodeEdgeStats(result);
    const oldNodesByPath = new Map<string, DiffResult["oldGraph"]["nodes"]>();
    const newNodesByPath = new Map<string, DiffResult["newGraph"]["nodes"]>();
    const oldFileNodeByPath = new Map<string, DiffResult["oldGraph"]["nodes"][number]>();
    const newFileNodeByPath = new Map<string, DiffResult["newGraph"]["nodes"][number]>();
    for (const node of result.oldGraph.nodes) {
      const normalized = normalizePath(node.filePath);
      if (!oldNodesByPath.has(normalized)) {
        oldNodesByPath.set(normalized, []);
      }
      oldNodesByPath.get(normalized)?.push(node);
      if (node.kind === "File") {
        oldFileNodeByPath.set(normalized, node);
      }
    }
    for (const node of result.newGraph.nodes) {
      const normalized = normalizePath(node.filePath);
      if (!newNodesByPath.has(normalized)) {
        newNodesByPath.set(normalized, []);
      }
      newNodesByPath.get(normalized)?.push(node);
      if (node.kind === "File") {
        newFileNodeByPath.set(normalized, node);
      }
    }
    const hunksByPath = new Map<string, string[]>();
    for (const [candidatePath, hunks] of result.hunksByPath.entries()) {
      hunksByPath.set(normalizePath(candidatePath), hunks);
    }
    const fallbackPairs = Array.from(result.hunksByPath.keys()).map((pathValue) => ({
      path: pathValue,
      oldPath: pathValue,
      newPath: pathValue,
      status: "modified" as const,
    }));
    const pairs = result.filePairs.length > 0 ? result.filePairs : fallbackPairs;

    const entries = pairs.map((pair) => {
      const normalizedFilePath = normalizePath(pair.path);
      const normalizedOldPath = normalizePath(pair.oldPath);
      const normalizedNewPath = normalizePath(pair.newPath);
      const oldNode = oldFileNodeByPath.get(normalizedFilePath) ?? oldFileNodeByPath.get(normalizedOldPath);
      const newNode = newFileNodeByPath.get(normalizedFilePath) ?? newFileNodeByPath.get(normalizedNewPath);
      let hunks = hunksByPath.get(normalizedFilePath) ?? [];
      if (hunks.length === 0) {
        hunks = hunksByPath.get(normalizedNewPath) ?? hunksByPath.get(normalizedOldPath) ?? [];
      }

      const oldSymbols = (oldNodesByPath.get(normalizedFilePath) ?? oldNodesByPath.get(normalizedOldPath) ?? []).filter(
        (n) => symbolKinds.has(n.kind),
      );
      const newSymbols = (newNodesByPath.get(normalizedFilePath) ?? newNodesByPath.get(normalizedNewPath) ?? []).filter(
        (n) => symbolKinds.has(n.kind),
      );
      const oldByKey = new Map(oldSymbols.map((n) => [`${n.kind}:${n.qualifiedName}`, n]));
      const newByKey = new Map(newSymbols.map((n) => [`${n.kind}:${n.qualifiedName}`, n]));
      const allKeys = new Set([...oldByKey.keys(), ...newByKey.keys()]);
      const symbols = [...allKeys].map((key) => {
        const oldSym = oldByKey.get(key);
        const newSym = newByKey.get(key);
        const sym = newSym ?? oldSym;
        let diffStatus: SymbolDiffStatus = "unchanged";
        if (!oldSym) diffStatus = "added";
        else if (!newSym) diffStatus = "removed";
        else if (oldSym.signatureHash !== newSym.signatureHash) diffStatus = "modified";
        const oldSymStats = oldSym ? oldStats.get(oldSym.id) : undefined;
        const newSymStats = newSym ? newStats.get(newSym.id) : undefined;
        const callFanIn = Math.max(oldSymStats?.incomingCalls ?? 0, newSymStats?.incomingCalls ?? 0);
        const callFanOut = Math.max(oldSymStats?.outgoingCalls ?? 0, newSymStats?.outgoingCalls ?? 0);
        const declaresOwned = Math.max(oldSymStats?.outgoingDeclares ?? 0, newSymStats?.outgoingDeclares ?? 0);
        const spanLines = Math.max(
          lineSpan(oldSym?.startLine, oldSym?.endLine),
          lineSpan(newSym?.startLine, newSym?.endLine),
        );
        const riskScore = computeSymbolRiskScore(
          diffStatus,
          sym?.kind ?? "",
          callFanIn,
          callFanOut,
          declaresOwned,
          spanLines,
          sym?.name ?? "",
        );
        return {
          name: sym?.name ?? "",
          kind: sym?.kind ?? "",
          startLine: (newSym ?? oldSym)?.startLine ?? 0,
          diffStatus,
          riskScore,
          callFanIn,
          callFanOut,
        };
      }).sort((a, b) => (b.riskScore - a.riskScore) || (a.startLine - b.startLine) || a.name.localeCompare(b.name));

      const changedSymbols = symbols.filter((sym) => sym.diffStatus !== "unchanged");
      const churn = countLineChurn(hunks);
      const symbolRisk = changedSymbols.slice(0, 8).reduce((sum, sym) => sum + sym.riskScore, 0);
      const hotspotFanIn = changedSymbols.reduce((max, sym) => Math.max(max, sym.callFanIn), 0);
      const churnScore = Math.min(10, Math.floor(churn / 15));
      const connectivityScore = Math.min(6, Math.floor(hotspotFanIn / 2));
      const statusBoost =
        pair.status === "renamed" ? 2 : pair.status === "deleted" || pair.status === "added" ? 2 : pair.status === "type-changed" ? 3 : 0;
      const riskScore = symbolRisk + churnScore + connectivityScore + statusBoost;

      return {
        path: pair.path,
        oldPath: pair.oldPath,
        newPath: pair.newPath,
        changeType: pair.status,
        hunks,
        oldContent: oldNode ? (result.oldFileContents?.get(normalizedFilePath) ?? result.oldFileContents?.get(normalizedOldPath) ?? "") : "",
        newContent: newNode ? (result.newFileContents?.get(normalizedFilePath) ?? result.newFileContents?.get(normalizedNewPath) ?? "") : "",
        symbols,
        riskScore,
        riskLevel: riskLevel(riskScore),
      };
    }).sort((a, b) => (b.riskScore - a.riskScore) || a.path.localeCompare(b.path));
    res.json(entries);
  });

  const currentFilePath = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(currentFilePath), "../../..");
  const distPath = path.join(packageRoot, "web", "dist");
  if (existsSync(distPath)) {
    app.use(express.static(distPath));
    app.use((_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    app.get("/", (_req, res) => {
      res.type("text/html").send("<h1>Web build missing</h1><p>Run npm run build first.</p>");
    });
  }

  return app;
};
