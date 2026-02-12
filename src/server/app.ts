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
    res.json({
      diffId: result.diffId,
      oldRef: result.oldGraph.ref,
      newRef: result.newGraph.ref,
      oldSnapshotId: result.oldGraph.snapshotId,
      newSnapshotId: result.newGraph.snapshotId,
    });
  });

  app.get("/api/diff/:diffId/files", (req, res) => {
    const result = context.results.get(req.params.diffId);
    if (!result) {
      res.status(404).json({ error: "diff not found" });
      return;
    }

    const entries = Array.from(result.hunksByPath.entries()).map(([filePath, hunks]) => {
      const normalizedFilePath = normalizePath(filePath);
      const oldNode = result.oldGraph.nodes.find(
        (node) => node.kind === "File" && normalizePath(node.filePath) === normalizedFilePath,
      );
      const newNode = result.newGraph.nodes.find(
        (node) => node.kind === "File" && normalizePath(node.filePath) === normalizedFilePath,
      );
      return {
        path: filePath,
        hunks,
        oldContent: oldNode ? (result.oldFileContents?.get(normalizedFilePath) ?? "") : "",
        newContent: newNode ? (result.newFileContents?.get(normalizedFilePath) ?? "") : "",
      };
    });
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
