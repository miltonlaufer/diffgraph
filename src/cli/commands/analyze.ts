import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { DiffEngine } from "../../core/diff/diffEngine.js";
import { Neo4jStore } from "../../core/graph/neo4jStore.js";

const collectFiles = async (root: string, start = root): Promise<string[]> => {
  const entries = await readdir(start, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
      continue;
    }
    const fullPath = join(start, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(root, fullPath)));
      continue;
    }
    if (fullPath.endsWith(".ts") || fullPath.endsWith(".tsx") || fullPath.endsWith(".js") || fullPath.endsWith(".jsx") || fullPath.endsWith(".py")) {
      files.push(fullPath);
    }
  }
  return files;
};

export const runAnalyze = async (repoPath: string, ref: string): Promise<{ snapshotId: string; count: number }> => {
  const resolvedRepo = resolve(repoPath);
  const allFiles = await collectFiles(resolvedRepo);
  const fileContent = await Promise.all(
    allFiles.map(async (absolutePath) => ({
      path: relative(resolvedRepo, absolutePath),
      content: await readFile(absolutePath, "utf8"),
    })),
  );

  const engine = new DiffEngine();
  const diffResult = await engine.run(
    resolvedRepo.split("/").pop() ?? "repo",
    {
      oldRef: ref,
      newRef: ref,
      files: fileContent.map((item) => item.path),
      oldFiles: fileContent,
      newFiles: fileContent,
      hunksByPath: new Map(),
    },
  );

  const store = new Neo4jStore(process.env.NEO4J_URI, process.env.NEO4J_USER, process.env.NEO4J_PASSWORD);
  await store.connect();
  await store.saveSnapshot(diffResult.newGraph);
  await store.close();
  return { snapshotId: diffResult.newGraph.snapshotId, count: diffResult.newGraph.nodes.length };
};
