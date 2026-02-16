import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import parseGitDiff from "parse-git-diff";

const execFileAsync = promisify(execFile);

export type DiffMode =
  | { type: "staged"; includeUnstaged?: boolean }
  | { type: "files"; oldFile: string; newFile: string }
  | { type: "branches"; baseBranch: string; targetBranch: string }
  | { type: "refs"; oldRef: string; newRef: string }
  | { type: "pullRequest"; prNumber: string };

export type DiffFileStatus = "added" | "deleted" | "modified" | "renamed" | "copied" | "type-changed" | "unknown";

export interface DiffFilePair {
  path: string;
  oldPath: string;
  newPath: string;
  status: DiffFileStatus;
}

export interface DiffPayload {
  oldRef: string;
  newRef: string;
  files: string[];
  filePairs: DiffFilePair[];
  oldFiles: Array<{ path: string; content: string }>;
  newFiles: Array<{ path: string; content: string }>;
  hunksByPath: Map<string, string[]>;
  pullRequest?: {
    number: string;
    description?: string;
  };
}

interface PullRequestMetadata {
  description?: string;
  baseRefName?: string;
}

const textFromGit = async (args: string[], cwd: string): Promise<string> => {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 1024 * 1024 * 50 });
  return stdout;
};

const textFromGh = async (args: string[], cwd: string): Promise<string> => {
  const { stdout } = await execFileAsync("gh", args, { cwd, maxBuffer: 1024 * 1024 * 10 });
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

    if (mode.type === "refs") {
      return this.fromRefs(mode.oldRef, mode.newRef, repoPath);
    }

    if (mode.type === "pullRequest") {
      return this.fromPullRequest(mode.prNumber, repoPath);
    }

    return this.fromStaged(repoPath, Boolean(mode.includeUnstaged));
  }

  private async fromFiles(oldFile: string, newFile: string): Promise<DiffPayload> {
    const [oldContent, newContent] = await Promise.all([readFile(oldFile, "utf8"), readFile(newFile, "utf8")]);
    const path = newFile;
    const filePairs: DiffFilePair[] = [
      {
        path,
        oldPath: oldFile,
        newPath: newFile,
        status: oldFile === newFile ? "modified" : "renamed",
      },
    ];
    return {
      oldRef: oldFile,
      newRef: newFile,
      files: [path],
      filePairs,
      oldFiles: [{ path, content: oldContent }],
      newFiles: [{ path, content: newContent }],
      hunksByPath: new Map([[path, [`--- ${oldFile}`, `+++ ${newFile}`]]]),
    };
  }

  private async fromBranches(baseBranch: string, targetBranch: string, repoPath: string): Promise<DiffPayload> {
    const diffRange = `${baseBranch}...${targetBranch}`;
    const diffText = await textFromGit(["diff", "-M", diffRange], repoPath);
    const nameStatus = await textFromGit(["diff", "--name-status", "-M", diffRange], repoPath);
    const filePairs = this.parseFilePairs(nameStatus);
    const files = filePairs.map((pair) => pair.path);

    const oldFiles = await Promise.all(
      filePairs.map(async (pair) => ({
        path: pair.path,
        content: pair.status === "added" ? "" : await safeGitShow(repoPath, `${baseBranch}:${pair.oldPath}`),
      })),
    );
    const newFiles = await Promise.all(
      filePairs.map(async (pair) => ({
        path: pair.path,
        content: pair.status === "deleted" ? "" : await safeGitShow(repoPath, `${targetBranch}:${pair.newPath}`),
      })),
    );

    return {
      oldRef: baseBranch,
      newRef: targetBranch,
      files,
      filePairs,
      oldFiles,
      newFiles,
      hunksByPath: this.extractHunks(diffText),
    };
  }

  private async fromRefs(oldRef: string, newRef: string, repoPath: string): Promise<DiffPayload> {
    const diffText = await textFromGit(["diff", "-M", oldRef, newRef], repoPath);
    const nameStatus = await textFromGit(["diff", "--name-status", "-M", oldRef, newRef], repoPath);
    const filePairs = this.parseFilePairs(nameStatus);
    const files = filePairs.map((pair) => pair.path);

    const oldFiles = await Promise.all(
      filePairs.map(async (pair) => ({
        path: pair.path,
        content: pair.status === "added" ? "" : await safeGitShow(repoPath, `${oldRef}:${pair.oldPath}`),
      })),
    );
    const newFiles = await Promise.all(
      filePairs.map(async (pair) => ({
        path: pair.path,
        content: pair.status === "deleted" ? "" : await safeGitShow(repoPath, `${newRef}:${pair.newPath}`),
      })),
    );

    return {
      oldRef,
      newRef,
      files,
      filePairs,
      oldFiles,
      newFiles,
      hunksByPath: this.extractHunks(diffText),
    };
  }

  private async fromPullRequest(prNumber: string, repoPath: string): Promise<DiffPayload> {
    const normalizedPr = prNumber.trim();
    if (!/^\d+$/.test(normalizedPr)) {
      throw new Error(`Invalid PR number '${prNumber}'. Expected a numeric value.`);
    }

    const prRef = `refs/diffgraph/pr-${normalizedPr}`;
    try {
      await textFromGit(["fetch", "--quiet", "origin", `pull/${normalizedPr}/head:${prRef}`], repoPath);
    } catch {
      throw new Error(
        `Failed to fetch PR #${normalizedPr} from origin. Ensure this is a GitHub repo and PR exists.`,
      );
    }

    const prMetadata = await this.readPullRequestMetadata(repoPath, normalizedPr);
    const preferredBase = await this.resolvePreferredBaseRef(repoPath, prMetadata.baseRefName);
    const mergeBase = (await textFromGit(["merge-base", preferredBase, prRef], repoPath)).trim();
    if (!mergeBase) {
      throw new Error(`Unable to compute merge-base between '${preferredBase}' and PR #${normalizedPr}.`);
    }

    const payload = await this.fromRefs(mergeBase, prRef, repoPath);
    return {
      ...payload,
      pullRequest: {
        number: normalizedPr,
        description: prMetadata.description,
      },
    };
  }

  private async readPullRequestMetadata(repoPath: string, prNumber: string): Promise<PullRequestMetadata> {
    try {
      const raw = await textFromGh(["pr", "view", prNumber, "--json", "body,baseRefName"], repoPath);
      const parsed = JSON.parse(raw) as { body?: unknown; baseRefName?: unknown };
      const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
      const baseRefName = typeof parsed.baseRefName === "string" ? parsed.baseRefName.trim() : "";
      return {
        description: body.length > 0 ? body : undefined,
        baseRefName: baseRefName.length > 0 ? baseRefName : undefined,
      };
    } catch {
      return {};
    }
  }

  private async resolvePreferredBaseRef(repoPath: string, prBaseRefName?: string): Promise<string> {
    const candidates: string[] = [];
    if (prBaseRefName && prBaseRefName.length > 0) {
      candidates.push(`origin/${prBaseRefName}`, prBaseRefName);
    }
    try {
      const upstreamDefault = (await textFromGit(
        ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
        repoPath,
      )).trim();
      if (upstreamDefault) {
        candidates.push(upstreamDefault);
      }
    } catch {
      // ignore and fall back to common defaults
    }
    candidates.push("origin/main", "origin/master", "main", "master", "HEAD");

    for (const ref of candidates) {
      if (await this.refExists(repoPath, ref)) {
        return ref;
      }
    }
    return "HEAD";
  }

  private async refExists(repoPath: string, ref: string): Promise<boolean> {
    try {
      await textFromGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], repoPath);
      return true;
    } catch {
      return false;
    }
  }

  private async fromStaged(repoPath: string, includeUnstaged: boolean): Promise<DiffPayload> {
    const diffArgs = includeUnstaged ? ["diff", "-M", "HEAD"] : ["diff", "-M", "--staged"];
    const statusArgs = includeUnstaged
      ? ["diff", "--name-status", "-M", "HEAD"]
      : ["diff", "--name-status", "-M", "--staged"];
    const diffText = await textFromGit(diffArgs, repoPath);
    const nameStatus = await textFromGit(statusArgs, repoPath);
    const filePairs = this.parseFilePairs(nameStatus);
    const files = filePairs.map((pair) => pair.path);
    if (files.length === 0) {
      throw new Error(
        includeUnstaged
          ? "No staged or unstaged changes found in repository."
          : "No staged changes found in repository.",
      );
    }

    const oldFiles = await Promise.all(
      filePairs.map(async (pair) => ({
        path: pair.path,
        content: pair.status === "added" ? "" : await safeGitShow(repoPath, `HEAD:${pair.oldPath}`),
      })),
    );
    const newFiles = await Promise.all(
      filePairs.map(async (pair) => ({
        path: pair.path,
        content: await this.readNewContentFromStagedMode(pair, repoPath, includeUnstaged),
      })),
    );

    return {
      oldRef: "HEAD",
      newRef: includeUnstaged ? "WORKTREE" : "INDEX",
      files,
      filePairs,
      oldFiles,
      newFiles,
      hunksByPath: this.extractHunks(diffText),
    };
  }

  private async readNewContentFromStagedMode(
    pair: DiffFilePair,
    repoPath: string,
    includeUnstaged: boolean,
  ): Promise<string> {
    if (pair.status === "deleted") {
      return "";
    }
    if (includeUnstaged) {
      return readFile(join(repoPath, pair.newPath), "utf8").catch(() => "");
    }
    return safeGitShow(repoPath, `:${pair.newPath}`);
  }

  private parseFilePairs(nameStatusText: string): DiffFilePair[] {
    const pairs: DiffFilePair[] = [];
    const seen = new Set<string>();
    for (const rawLine of nameStatusText.split("\n")) {
      const line = rawLine.trim();
      if (line.length === 0) {
        continue;
      }
      const parts = line.split("\t");
      const statusToken = parts[0] ?? "";
      const status = this.mapStatus(statusToken);
      let oldPath = "";
      let newPath = "";
      if ((statusToken.startsWith("R") || statusToken.startsWith("C")) && parts.length >= 3) {
        oldPath = parts[1] ?? "";
        newPath = parts[2] ?? "";
      } else {
        oldPath = parts[1] ?? "";
        newPath = parts[1] ?? "";
      }
      const displayPath = status === "deleted" ? oldPath : newPath;
      if (!displayPath) {
        continue;
      }
      const key = `${displayPath}:${oldPath}:${newPath}:${status}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      pairs.push({
        path: displayPath,
        oldPath: oldPath || displayPath,
        newPath: newPath || displayPath,
        status,
      });
    }
    return pairs;
  }

  private mapStatus(token: string): DiffFileStatus {
    if (token.startsWith("A")) return "added";
    if (token.startsWith("D")) return "deleted";
    if (token.startsWith("M")) return "modified";
    if (token.startsWith("R")) return "renamed";
    if (token.startsWith("C")) return "copied";
    if (token.startsWith("T")) return "type-changed";
    return "unknown";
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
