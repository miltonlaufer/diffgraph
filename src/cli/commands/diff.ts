import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { basename, resolve } from "node:path";
import open from "open";
import { DiffProvider, type DiffMode } from "../../core/git/diffProvider.js";
import { DiffEngine } from "../../core/diff/diffEngine.js";
import { Neo4jStore } from "../../core/graph/neo4jStore.js";
import { createApp } from "../../server/app.js";

const isPortFree = (port: number): Promise<boolean> =>
  new Promise((res) => {
    const tester = createNetServer();
    tester.once("error", () => res(false));
    tester.listen(port, () => {
      tester.close(() => res(true));
    });
  });

const findFreePort = async (startPort: number, maxAttempts = 20): Promise<number> => {
  for (let offset = 0; offset < maxAttempts; offset++) {
    const candidate = startPort + offset;
    if (await isPortFree(candidate)) {
      return candidate;
    }
  }
  throw new Error(`No free port found in range ${startPort}-${startPort + maxAttempts - 1}`);
};

export interface RunDiffOptions {
  mode: DiffMode;
  repoPath: string;
  openBrowser: boolean;
  port?: number;
}

export const runDiff = async (
  options: RunDiffOptions,
): Promise<{ diffId: string; url: string; close: () => Promise<void> }> => {
  const repoPath = resolve(options.repoPath);
  const repoId = basename(repoPath);
  const provider = new DiffProvider();
  const engine = new DiffEngine();
  const store = new Neo4jStore(process.env.NEO4J_URI, process.env.NEO4J_USER, process.env.NEO4J_PASSWORD);
  await store.connect();

  console.log("Collecting diff...");
  const payload = await provider.collect(options.mode, repoPath);
  console.log(`Analyzing ${payload.files.length} files...`);
  const result = await engine.run(repoId, payload);
  const totalNodes = result.oldGraph.nodes.length + result.newGraph.nodes.length;
  console.log(`Graph built: ${totalNodes} total nodes across old+new snapshots`);
  if (totalNodes > 2000) {
    console.log("Large graph detected. Use Changes Only mode (enabled by default) for best performance.");
  }
  await store.saveSnapshot(result.oldGraph);
  await store.saveSnapshot(result.newGraph);

  const context = { store, results: new Map([[result.diffId, result]]) };
  const app = createApp(context);
  const preferredPort = options.port ?? 4177;
  const port = await findFreePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} busy, using ${port}`);
  }
  const server = createServer(app);
  await new Promise<void>((resolveServer) => {
    server.listen(port, resolveServer);
  });
  const url = `http://localhost:${port}/?diffId=${result.diffId}`;

  if (options.openBrowser) {
    await open(url);
  }

  const close = async (): Promise<void> => {
    await new Promise<void>((resolveServer, rejectServer) => {
      server.close((error) => {
        if (error) {
          rejectServer(error);
          return;
        }
        resolveServer();
      });
    });
    await store.close();
  };

  return { diffId: result.diffId, url, close };
};
