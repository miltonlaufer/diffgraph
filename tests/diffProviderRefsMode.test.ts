import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { DiffProvider } from "../src/core/git/diffProvider.js";

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

describe("DiffProvider refs mode", () => {
  it("loads old/new content from two commit refs", async () => {
    const repoDir = await mkdtemp(join(tmpdir(), "diffgraph-refs-"));
    await git(repoDir, "init", "-b", "main");
    await writeFile(join(repoDir, "src.ts"), "export const value = 1;\n", "utf8");
    await git(repoDir, "add", ".");
    await gitCommit(repoDir, "init");
    const firstCommit = (await gitOut(repoDir, "rev-parse", "HEAD")).trim();

    await writeFile(join(repoDir, "src.ts"), "export const value = 2;\n", "utf8");
    await git(repoDir, "add", ".");
    await gitCommit(repoDir, "update");
    const secondCommit = (await gitOut(repoDir, "rev-parse", "HEAD")).trim();

    const provider = new DiffProvider();
    const result = await provider.collect({ type: "refs", oldRef: firstCommit, newRef: secondCommit }, repoDir);

    expect(result.oldRef).toBe(firstCommit);
    expect(result.newRef).toBe(secondCommit);
    expect(result.files).toContain("src.ts");
    expect(result.oldFiles.find((entry) => entry.path === "src.ts")?.content).toContain("value = 1");
    expect(result.newFiles.find((entry) => entry.path === "src.ts")?.content).toContain("value = 2");
  });
});
