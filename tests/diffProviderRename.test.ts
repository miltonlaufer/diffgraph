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

const gitCommit = async (cwd: string, message: string): Promise<void> => {
  await execFileAsync(
    "git",
    ["-c", "user.name=DiffGraph", "-c", "user.email=diffgraph@example.com", "commit", "-m", message],
    { cwd },
  );
};

describe("DiffProvider rename support", () => {
  it("tracks renamed staged files and loads old/new content correctly", async () => {
    const repoDir = await mkdtemp(join(tmpdir(), "diffgraph-rename-"));
    await git(repoDir, "init", "-b", "main");
    await writeFile(
      join(repoDir, "old-name.ts"),
      [
        "export const alpha = 1;",
        "export const beta = 2;",
        "export const gamma = 3;",
        "",
      ].join("\n"),
      "utf8",
    );
    await git(repoDir, "add", ".");
    await gitCommit(repoDir, "initial");

    await git(repoDir, "mv", "old-name.ts", "new-name.ts");
    await writeFile(
      join(repoDir, "new-name.ts"),
      [
        "export const alpha = 1;",
        "export const beta = 22;",
        "export const gamma = 3;",
        "",
      ].join("\n"),
      "utf8",
    );
    await git(repoDir, "add", "-A");

    const provider = new DiffProvider();
    const result = await provider.collect({ type: "staged" }, repoDir);
    const renamed = result.filePairs.find((pair) => pair.status === "renamed");

    expect(renamed).toBeDefined();
    expect(renamed?.oldPath).toBe("old-name.ts");
    expect(renamed?.newPath).toBe("new-name.ts");
    const oldEntry = result.oldFiles.find((entry) => entry.path === renamed?.path);
    const newEntry = result.newFiles.find((entry) => entry.path === renamed?.path);
    expect(oldEntry?.content).toContain("beta = 2");
    expect(newEntry?.content).toContain("beta = 22");
  });
});
