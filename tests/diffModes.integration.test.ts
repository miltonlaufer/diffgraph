import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { DiffProvider } from "../src/core/git/diffProvider.js";
import { runDiff } from "../src/cli/commands/diff.js";

const execFileAsync = promisify(execFile);

const git = async (cwd: string, ...args: string[]): Promise<void> => {
  await execFileAsync("git", args, { cwd });
};

const gitOut = async (cwd: string, ...args: string[]): Promise<string> => {
  const result = await execFileAsync("git", args, { cwd });
  return result.stdout;
};

const gitCommit = async (cwd: string, message: string): Promise<void> => {
  await execFileAsync(
    "git",
    ["-c", "user.name=DiffGraph", "-c", "user.email=diffgraph@example.com", "commit", "-m", message],
    { cwd },
  );
};

describe("diff modes integration", () => {
  let repoDir = "";

  beforeAll(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "diffgraph-repo-"));
    await mkdir(join(repoDir, "src"), { recursive: true });
    await git(repoDir, "init", "-b", "main");
    await writeFile(join(repoDir, "src/app.ts"), "export const value = 1;\n", "utf8");
    await git(repoDir, "add", ".");
    await gitCommit(repoDir, "init");
    await git(repoDir, "checkout", "-b", "feature");
    await writeFile(join(repoDir, "src/app.ts"), "export const value = 2;\nexport const next = 3;\n", "utf8");
    await git(repoDir, "add", ".");
    await gitCommit(repoDir, "feature change");
    await git(repoDir, "checkout", "main");
  });

  it("collects staged diff", async () => {
    await writeFile(join(repoDir, "src/app.ts"), "export const value = 11;\n", "utf8");
    await git(repoDir, "add", "src/app.ts");
    const provider = new DiffProvider();
    const result = await provider.collect({ type: "staged" }, repoDir);
    expect(result.files).toContain("src/app.ts");
    expect(result.newFiles[0]?.content).toContain("11");
  });

  it("collects branch diff", async () => {
    const provider = new DiffProvider();
    const result = await provider.collect({ type: "branches", baseBranch: "main", targetBranch: "feature" }, repoDir);
    expect(result.files).toContain("src/app.ts");
    const diffText = await gitOut(repoDir, "diff", "main...feature");
    expect(diffText.length).toBeGreaterThan(0);
  });

  it("serves api for file-to-file mode", async () => {
    const oldFile = join(repoDir, "old.ts");
    const newFile = join(repoDir, "new.ts");
    await writeFile(oldFile, "export function alpha() { return 1; }\n", "utf8");
    await writeFile(newFile, "export function alpha() { return 2; }\n", "utf8");

    const port = 4177;
    const runner = await runDiff({
      mode: { type: "files", oldFile, newFile },
      repoPath: repoDir,
      openBrowser: false,
      port,
    });
    const apiBase = new URL(runner.url).origin;
    const viewResponse = await fetch(`${apiBase}/api/views/${runner.diffId}/knowledge`);
    expect(viewResponse.ok).toBe(true);
    const viewPayload = (await viewResponse.json()) as { oldGraph: { nodes: unknown[] }; newGraph: { nodes: unknown[] } };
    expect(viewPayload.oldGraph.nodes.length).toBeGreaterThan(0);
    expect(viewPayload.newGraph.nodes.length).toBeGreaterThan(0);

    const filesResponse = await fetch(`${apiBase}/api/diff/${runner.diffId}/files`);
    expect(filesResponse.ok).toBe(true);
    const filesPayload = (await filesResponse.json()) as Array<{
      path: string;
      riskScore: number;
      symbols: Array<{ riskScore: number }>;
    }>;
    expect(filesPayload.length).toBeGreaterThan(0);
    expect(filesPayload[0].riskScore).toBeGreaterThanOrEqual(0);
    if (filesPayload.length > 1) {
      expect(filesPayload[0].riskScore).toBeGreaterThanOrEqual(filesPayload[1].riskScore);
    }
    const firstFileSymbols = filesPayload[0]?.symbols ?? [];
    if (firstFileSymbols.length > 1) {
      expect(firstFileSymbols[0].riskScore).toBeGreaterThanOrEqual(firstFileSymbols[1].riskScore);
    }
    await runner.close();
  });
});
