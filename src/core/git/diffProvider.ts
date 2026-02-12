import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import parseGitDiff from "parse-git-diff";

const execFileAsync = promisify(execFile);

export type DiffMode =
  | { type: "staged"; includeUnstaged?: boolean }
  | { type: "files"; oldFile: string; newFile: string }
  | { type: "branches"; baseBranch: string; targetBranch: string };

export interface DiffPayload {
  oldRef: string;
  newRef: string;
  files: string[];
  oldFiles: Array<{ path: string; content: string }>;
  newFiles: Array<{ path: string; content: string }>;
  hunksByPath: Map<string, string[]>;
}

const textFromGit = async (args: string[], cwd: string): Promise<string> => {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 1024 * 1024 * 50 });
  return stdout;
};

const safeGitShow = async (cwd: string, spec: string): Promise<string> => {
  try {
    return await textFromGit(["show", spec], cwd);
  } catch {
    return "";
  }
};

export class DiffProvider {
  public async collect(mode: DiffMode, repoPath: string): Promise<DiffPayload> {
    if (mode.type === "files") {
      return this.fromFiles(mode.oldFile, mode.newFile);
    }

    if (mode.type === "branches") {
      return this.fromBranches(mode.baseBranch, mode.targetBranch, repoPath);
    }

    return this.fromStaged(repoPath, Boolean(mode.includeUnstaged));
  }

  private async fromFiles(oldFile: string, newFile: string): Promise<DiffPayload> {
    const [oldContent, newContent] = await Promise.all([readFile(oldFile, "utf8"), readFile(newFile, "utf8")]);
    const path = newFile;
    return {
      oldRef: oldFile,
      newRef: newFile,
      files: [path],
      oldFiles: [{ path, content: oldContent }],
      newFiles: [{ path, content: newContent }],
      hunksByPath: new Map([[path, [`--- ${oldFile}`, `+++ ${newFile}`]]]),
    };
  }

  private async fromBranches(baseBranch: string, targetBranch: string, repoPath: string): Promise<DiffPayload> {
    const diffText = await textFromGit(["diff", `${baseBranch}...${targetBranch}`], repoPath);
    const nameOnly = await textFromGit(["diff", "--name-only", `${baseBranch}...${targetBranch}`], repoPath);
    const files = nameOnly
      .split("\n")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    const oldFiles = await Promise.all(
      files.map(async (path) => ({
        path,
        content: await safeGitShow(repoPath, `${baseBranch}:${path}`),
      })),
    );
    const newFiles = await Promise.all(
      files.map(async (path) => ({
        path,
        content: await safeGitShow(repoPath, `${targetBranch}:${path}`),
      })),
    );

    return {
      oldRef: baseBranch,
      newRef: targetBranch,
      files,
      oldFiles,
      newFiles,
      hunksByPath: this.extractHunks(diffText),
    };
  }

  private async fromStaged(repoPath: string, includeUnstaged: boolean): Promise<DiffPayload> {
    const stagedDiff = await textFromGit(["diff", "--staged"], repoPath);
    const stagedNames = await textFromGit(["diff", "--name-only", "--staged"], repoPath);
    const unstagedNames = includeUnstaged ? await textFromGit(["diff", "--name-only"], repoPath) : "";
    const stagedFiles = stagedNames
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const extraFiles = unstagedNames
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const files = [...new Set([...stagedFiles, ...extraFiles])];
    if (files.length === 0) {
      throw new Error(
        includeUnstaged
          ? "No staged or unstaged changes found in repository."
          : "No staged changes found in repository.",
      );
    }

    const oldFiles = await Promise.all(
      files.map(async (path) => ({
        path,
        content: await safeGitShow(repoPath, `HEAD:${path}`),
      })),
    );
    const newFiles = await Promise.all(
      files.map(async (path) => ({
        path,
        content: await readFile(`${repoPath}/${path}`, "utf8").catch(() => ""),
      })),
    );

    const combinedDiff = includeUnstaged ? `${stagedDiff}\n${await textFromGit(["diff"], repoPath)}` : stagedDiff;
    return {
      oldRef: "HEAD",
      newRef: includeUnstaged ? "WORKTREE" : "INDEX",
      files,
      oldFiles,
      newFiles,
      hunksByPath: this.extractHunks(combinedDiff),
    };
  }

  private extractHunks(diffText: string): Map<string, string[]> {
    const parsed = parseGitDiff(diffText);
    const hunksByPath = new Map<string, string[]>();
    for (const file of parsed.files) {
      const path = "path" in file ? file.path : file.pathAfter;
      const hunks = file.chunks.map((chunk) => {
        if (!("changes" in chunk)) {
          return `${path} (binary change)`;
        }
        return chunk.changes.map((change) => change.content).join("\n");
      });
      hunksByPath.set(path, hunks);
    }
    return hunksByPath;
  }
}
