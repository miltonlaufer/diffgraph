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

export type PullRequestThreadSide = "old" | "new" | "";

export interface PullRequestReviewCommentAuthor {
  login: string;
  avatarUrl?: string;
  profileUrl?: string;
}

export interface PullRequestReviewComment {
  id: string;
  body: string;
  createdAt: string;
  updatedAt?: string;
  url?: string;
  author: PullRequestReviewCommentAuthor;
}

export interface PullRequestReviewThread {
  id: string;
  kind?: "review" | "discussion";
  filePath: string;
  side: PullRequestThreadSide;
  startSide: PullRequestThreadSide;
  line?: number;
  startLine?: number;
  originalLine?: number;
  originalStartLine?: number;
  resolved: boolean;
  outdated: boolean;
  comments: PullRequestReviewComment[];
  url?: string;
}

export interface PullRequestReviewThreadsDiagnostics {
  repoSlug?: string;
  selectedReviewSource: "restThreads" | "graphqlThreads" | "restReviewComments" | "none";
  reviewThreadCount: number;
  discussionThreadCount: number;
  totalThreadCount: number;
  restThreadsError?: string;
  graphqlThreadsError?: string;
  restReviewCommentsError?: string;
  discussionCommentsError?: string;
}

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
    url?: string;
    description?: string;
    reviewThreads?: PullRequestReviewThread[];
    reviewThreadsDiagnostics?: PullRequestReviewThreadsDiagnostics;
  };
}

interface PullRequestMetadata {
  description?: string;
  baseRefName?: string;
  url?: string;
}

interface GhReviewThreadUser {
  login?: unknown;
  avatar_url?: unknown;
  html_url?: unknown;
}

interface GhReviewThreadComment {
  id?: unknown;
  body?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  html_url?: unknown;
  user?: GhReviewThreadUser | null;
}

interface GhReviewThread {
  id?: unknown;
  path?: unknown;
  line?: unknown;
  start_line?: unknown;
  original_line?: unknown;
  original_start_line?: unknown;
  side?: unknown;
  start_side?: unknown;
  resolved?: unknown;
  outdated?: unknown;
  is_resolved?: unknown;
  is_outdated?: unknown;
  comments?: unknown;
}

interface GhPullRequestReviewComment extends GhReviewThreadComment {
  path?: unknown;
  line?: unknown;
  start_line?: unknown;
  original_line?: unknown;
  original_start_line?: unknown;
  side?: unknown;
  start_side?: unknown;
  in_reply_to_id?: unknown;
}

interface GhIssueComment extends GhReviewThreadComment {}

interface GhGraphQlAuthor {
  login?: unknown;
  avatarUrl?: unknown;
  url?: unknown;
}

interface GhGraphQlReviewComment {
  id?: unknown;
  body?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  url?: unknown;
  author?: GhGraphQlAuthor | null;
}

interface GhGraphQlReviewThread {
  id?: unknown;
  path?: unknown;
  line?: unknown;
  startLine?: unknown;
  originalLine?: unknown;
  originalStartLine?: unknown;
  diffSide?: unknown;
  startDiffSide?: unknown;
  isResolved?: unknown;
  isOutdated?: unknown;
  comments?: {
    nodes?: unknown;
  } | null;
}

interface PullRequestReviewThreadsReadResult {
  threads: PullRequestReviewThread[];
  diagnostics: PullRequestReviewThreadsDiagnostics;
}

const textFromGit = async (args: string[], cwd: string): Promise<string> => {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 1024 * 1024 * 50 });
  return stdout;
};

const textFromGh = async (args: string[], cwd: string): Promise<string> => {
  const { stdout } = await execFileAsync("gh", args, { cwd, maxBuffer: 1024 * 1024 * 50 });
  return stdout;
};

const safeGitShow = async (cwd: string, spec: string): Promise<string> => {
  try {
    return await textFromGit(["show", spec], cwd);
  } catch {
    return "";
  }
};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const asId = (value: unknown): string | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.floor(value));
  }
  return asString(value);
};

const asNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const asBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    const firstLine = error.message.split("\n")[0]?.trim() ?? error.message;
    return firstLine.slice(0, 300);
  }
  return String(error).slice(0, 300);
};

const normalizePath = (value: string): string =>
  value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");

const toThreadSide = (value: unknown): PullRequestThreadSide => {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  if (normalized === "left" || normalized === "old") return "old";
  if (normalized === "right" || normalized === "new") return "new";
  return "";
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
    const pullRequestUrl = await this.resolvePullRequestUrl(repoPath, normalizedPr, prMetadata.url);
    const reviewThreadsResult = await this.readPullRequestReviewThreads(repoPath, normalizedPr);
    return {
      ...payload,
      pullRequest: {
        number: normalizedPr,
        url: pullRequestUrl,
        description: prMetadata.description,
        reviewThreads: reviewThreadsResult.threads,
        reviewThreadsDiagnostics: reviewThreadsResult.diagnostics,
      },
    };
  }

  private async readPullRequestMetadata(repoPath: string, prNumber: string): Promise<PullRequestMetadata> {
    try {
      const raw = await textFromGh(["pr", "view", prNumber, "--json", "body,baseRefName,url"], repoPath);
      const parsed = JSON.parse(raw) as { body?: unknown; baseRefName?: unknown; url?: unknown };
      const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
      const baseRefName = typeof parsed.baseRefName === "string" ? parsed.baseRefName.trim() : "";
      const url = typeof parsed.url === "string" ? parsed.url.trim() : "";
      return {
        description: body.length > 0 ? body : undefined,
        baseRefName: baseRefName.length > 0 ? baseRefName : undefined,
        url: url.length > 0 ? url : undefined,
      };
    } catch {
      return {};
    }
  }

  private async resolvePullRequestUrl(repoPath: string, prNumber: string, prUrl?: string): Promise<string | undefined> {
    if (prUrl && prUrl.length > 0) {
      return prUrl;
    }
    try {
      const originUrl = (await textFromGit(["remote", "get-url", "origin"], repoPath)).trim();
      const githubRepoUrl = this.toGithubRepoUrl(originUrl);
      if (!githubRepoUrl) {
        return undefined;
      }
      return `${githubRepoUrl}/pull/${prNumber}`;
    } catch {
      return undefined;
    }
  }

  private async readPullRequestReviewThreads(
    repoPath: string,
    prNumber: string,
  ): Promise<PullRequestReviewThreadsReadResult> {
    const repoSlug = await this.resolveGithubRepoSlug(repoPath);
    const diagnostics: PullRequestReviewThreadsDiagnostics = {
      repoSlug,
      selectedReviewSource: "none",
      reviewThreadCount: 0,
      discussionThreadCount: 0,
      totalThreadCount: 0,
    };
    if (!repoSlug) {
      diagnostics.restThreadsError = "Could not resolve GitHub repo slug from origin remote URL.";
      return { threads: [], diagnostics };
    }

    const threadEndpoint = `repos/${repoSlug}/pulls/${prNumber}/threads?per_page=100`;
    const reviewCommentEndpoint = `repos/${repoSlug}/pulls/${prNumber}/comments?per_page=100`;
    const issueCommentEndpoint = `repos/${repoSlug}/issues/${prNumber}/comments?per_page=100`;
    let reviewThreads: PullRequestReviewThread[] = [];

    try {
      const threadPages = await this.readPaginatedGhList<GhReviewThread>(repoPath, threadEndpoint);
      const rawThreads = threadPages.flatMap((page) => page);
      const normalizedThreads = rawThreads
        .map((rawThread) => this.normalizePullRequestReviewThread(rawThread))
        .filter((thread): thread is PullRequestReviewThread => thread !== null);
      if (normalizedThreads.length > 0) {
        reviewThreads = normalizedThreads;
        diagnostics.selectedReviewSource = "restThreads";
      }
    } catch (error) {
      diagnostics.restThreadsError = toErrorMessage(error);
    }

    if (reviewThreads.length === 0) {
      try {
        const graphqlThreads = await this.readPullRequestReviewThreadsFromGraphQl(
          repoPath,
          repoSlug,
          prNumber,
        );
        if (graphqlThreads.length > 0) {
          reviewThreads = graphqlThreads;
          diagnostics.selectedReviewSource = "graphqlThreads";
        }
      } catch (error) {
        diagnostics.graphqlThreadsError = toErrorMessage(error);
      }
    }

    if (reviewThreads.length === 0) {
      try {
        const reviewCommentPages = await this.readPaginatedGhList<GhPullRequestReviewComment>(
          repoPath,
          reviewCommentEndpoint,
        );
        const fallbackThreads = this.buildThreadsFromReviewComments(
          reviewCommentPages.flatMap((page) => page),
        );
        if (fallbackThreads.length > 0) {
          reviewThreads = fallbackThreads;
          diagnostics.selectedReviewSource = "restReviewComments";
        }
      } catch (error) {
        diagnostics.restReviewCommentsError = toErrorMessage(error);
      }
    }

    let discussionThreads: PullRequestReviewThread[] = [];
    try {
      discussionThreads = await this.readIssueDiscussionThreads(repoPath, issueCommentEndpoint);
    } catch (error) {
      diagnostics.discussionCommentsError = toErrorMessage(error);
    }

    const threads = [...reviewThreads, ...discussionThreads];
    diagnostics.reviewThreadCount = reviewThreads.length;
    diagnostics.discussionThreadCount = discussionThreads.length;
    diagnostics.totalThreadCount = threads.length;
    return { threads, diagnostics };
  }

  private async readPullRequestReviewThreadsFromGraphQl(
    repoPath: string,
    repoSlug: string,
    prNumber: string,
  ): Promise<PullRequestReviewThread[]> {
    const [owner, repo] = repoSlug.split("/");
    if (!owner || !repo) return [];
    const pullNumber = Number.parseInt(prNumber, 10);
    if (!Number.isFinite(pullNumber)) return [];

    const query = `
      query($owner: String!, $repo: String!, $number: Int!, $after: String) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            reviewThreads(first: 100, after: $after) {
              nodes {
                id
                path
                line
                startLine
                originalLine
                originalStartLine
                diffSide
                startDiffSide
                isResolved
                isOutdated
                comments(first: 100) {
                  nodes {
                    id
                    body
                    createdAt
                    updatedAt
                    url
                    author {
                      login
                      avatarUrl
                      url
                    }
                  }
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      }
    `;

    const threads: PullRequestReviewThread[] = [];
    let afterCursor: string | undefined;
    let hasNextPage = true;

    while (hasNextPage) {
      const args = [
        "api",
        "graphql",
        "-f",
        `query=${query}`,
        "-F",
        `owner=${owner}`,
        "-F",
        `repo=${repo}`,
        "-F",
        `number=${pullNumber}`,
      ];
      if (afterCursor) {
        args.push("-F", `after=${afterCursor}`);
      }
      const raw = await textFromGh(args, repoPath);
      const parsed = JSON.parse(raw) as {
        data?: {
          repository?: {
            pullRequest?: {
              reviewThreads?: {
                nodes?: unknown;
                pageInfo?: {
                  hasNextPage?: unknown;
                  endCursor?: unknown;
                } | null;
              } | null;
            } | null;
          } | null;
        } | null;
      };

      const reviewThreads = parsed.data?.repository?.pullRequest?.reviewThreads;
      const nodes = Array.isArray(reviewThreads?.nodes) ? (reviewThreads?.nodes as GhGraphQlReviewThread[]) : [];
      for (const node of nodes) {
        const normalized = this.normalizeGraphQlReviewThread(node);
        if (normalized) threads.push(normalized);
      }

      hasNextPage = Boolean(reviewThreads?.pageInfo?.hasNextPage);
      const nextCursor = asString(reviewThreads?.pageInfo?.endCursor);
      afterCursor = hasNextPage ? nextCursor : undefined;
      if (hasNextPage && !afterCursor) {
        hasNextPage = false;
      }
    }

    return threads;
  }

  private async readPaginatedGhList<T>(repoPath: string, endpoint: string): Promise<T[][]> {
    const raw = await textFromGh(
      [
        "api",
        "--paginate",
        "--slurp",
        "-H",
        "Accept: application/vnd.github+json",
        "-H",
        "X-GitHub-Api-Version: 2022-11-28",
        endpoint,
      ],
      repoPath,
    );
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((page) => (Array.isArray(page) ? (page as T[]) : []));
  }

  private buildThreadsFromReviewComments(
    rawComments: GhPullRequestReviewComment[],
  ): PullRequestReviewThread[] {
    const commentsById = new Map<string, GhPullRequestReviewComment>();
    for (const rawComment of rawComments) {
      const id = asId(rawComment.id);
      if (!id) continue;
      commentsById.set(id, rawComment);
    }
    if (commentsById.size === 0) return [];

    const rootByCommentId = new Map<string, string>();
    const resolveRootId = (commentId: string): string => {
      const cached = rootByCommentId.get(commentId);
      if (cached) return cached;
      const seen = new Set<string>();
      let current = commentId;
      while (true) {
        if (seen.has(current)) break;
        seen.add(current);
        const rawComment = commentsById.get(current);
        const parentId = asId(rawComment?.in_reply_to_id);
        if (!parentId || !commentsById.has(parentId)) break;
        current = parentId;
      }
      rootByCommentId.set(commentId, current);
      return current;
    };

    const commentsByRootId = new Map<string, GhPullRequestReviewComment[]>();
    for (const [commentId, rawComment] of commentsById.entries()) {
      const rootId = resolveRootId(commentId);
      const group = commentsByRootId.get(rootId);
      if (group) {
        group.push(rawComment);
      } else {
        commentsByRootId.set(rootId, [rawComment]);
      }
    }

    const toSortTimestamp = (value: string | undefined): number => {
      if (!value) return Number.MAX_SAFE_INTEGER;
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
    };

    const threads: PullRequestReviewThread[] = [];
    for (const [rootId, group] of commentsByRootId.entries()) {
      const rootComment = commentsById.get(rootId) ?? group[0];
      const filePathCandidate = asString(rootComment?.path) ?? asString(group.find((entry) => asString(entry.path))?.path) ?? "";
      const filePath = normalizePath(filePathCandidate);
      if (!filePath) continue;

      const normalizedComments = group
        .map((rawComment) => this.normalizePullRequestReviewComment(rawComment))
        .filter((comment): comment is PullRequestReviewComment => comment !== null)
        .sort((a, b) => (toSortTimestamp(a.createdAt) - toSortTimestamp(b.createdAt)) || a.id.localeCompare(b.id));
      if (normalizedComments.length === 0) continue;

      const line = asNumber(rootComment?.line) ?? asNumber(group.find((entry) => asNumber(entry.line) !== undefined)?.line);
      const startLine = asNumber(rootComment?.start_line);
      const originalLine = asNumber(rootComment?.original_line);
      const originalStartLine = asNumber(rootComment?.original_start_line);

      threads.push({
        id: `fallback-thread-${rootId}`,
        kind: "review",
        filePath,
        side: toThreadSide(rootComment?.side),
        startSide: toThreadSide(rootComment?.start_side),
        line,
        startLine,
        originalLine,
        originalStartLine,
        resolved: false,
        outdated: line === undefined && originalLine !== undefined,
        comments: normalizedComments,
        url: normalizedComments[0]?.url,
      });
    }

    threads.sort((a, b) => {
      if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
      const aLine = a.line ?? a.originalLine ?? Number.MAX_SAFE_INTEGER;
      const bLine = b.line ?? b.originalLine ?? Number.MAX_SAFE_INTEGER;
      return aLine - bLine;
    });

    return threads;
  }

  private async readIssueDiscussionThreads(
    repoPath: string,
    issueCommentEndpoint: string,
  ): Promise<PullRequestReviewThread[]> {
    const pages = await this.readPaginatedGhList<GhIssueComment>(repoPath, issueCommentEndpoint);
    const issueComments = pages.flatMap((page) => page);
    if (issueComments.length === 0) return [];

    const threads: PullRequestReviewThread[] = [];
    for (const rawComment of issueComments) {
      const normalized = this.normalizePullRequestReviewComment(rawComment);
      if (!normalized) continue;
      threads.push({
        id: `discussion-${normalized.id}`,
        kind: "discussion",
        filePath: "__discussion__",
        side: "",
        startSide: "",
        resolved: false,
        outdated: false,
        comments: [normalized],
        url: normalized.url,
      });
    }
    return threads;
  }

  private normalizePullRequestReviewThread(rawThread: GhReviewThread): PullRequestReviewThread | null {
    const commentsRaw = Array.isArray(rawThread.comments) ? rawThread.comments : [];
    const comments = commentsRaw
      .map((entry) => this.normalizePullRequestReviewComment(entry as GhReviewThreadComment))
      .filter((comment): comment is PullRequestReviewComment => comment !== null);
    if (comments.length === 0) return null;

    const filePath = normalizePath(asString(rawThread.path) ?? "");
    if (!filePath) return null;

    const id = asId(rawThread.id) ?? comments[0]?.id;
    if (!id) return null;

    return {
      id,
      kind: "review",
      filePath,
      side: toThreadSide(rawThread.side),
      startSide: toThreadSide(rawThread.start_side),
      line: asNumber(rawThread.line),
      startLine: asNumber(rawThread.start_line),
      originalLine: asNumber(rawThread.original_line),
      originalStartLine: asNumber(rawThread.original_start_line),
      resolved: asBoolean(rawThread.resolved) ?? asBoolean(rawThread.is_resolved) ?? false,
      outdated: asBoolean(rawThread.outdated) ?? asBoolean(rawThread.is_outdated) ?? false,
      comments,
      url: comments[0]?.url,
    };
  }

  private normalizeGraphQlReviewThread(rawThread: GhGraphQlReviewThread): PullRequestReviewThread | null {
    const commentsRaw = Array.isArray(rawThread.comments?.nodes)
      ? (rawThread.comments?.nodes as GhGraphQlReviewComment[])
      : [];
    const comments = commentsRaw
      .map((entry) => this.normalizeGraphQlReviewComment(entry))
      .filter((comment): comment is PullRequestReviewComment => comment !== null);
    if (comments.length === 0) return null;

    const filePath = normalizePath(asString(rawThread.path) ?? "");
    if (!filePath) return null;

    const id = asString(rawThread.id) ?? comments[0]?.id;
    if (!id) return null;

    return {
      id,
      kind: "review",
      filePath,
      side: toThreadSide(rawThread.diffSide),
      startSide: toThreadSide(rawThread.startDiffSide),
      line: asNumber(rawThread.line),
      startLine: asNumber(rawThread.startLine),
      originalLine: asNumber(rawThread.originalLine),
      originalStartLine: asNumber(rawThread.originalStartLine),
      resolved: asBoolean(rawThread.isResolved) ?? false,
      outdated: asBoolean(rawThread.isOutdated) ?? false,
      comments,
      url: comments[0]?.url,
    };
  }

  private normalizeGraphQlReviewComment(rawComment: GhGraphQlReviewComment): PullRequestReviewComment | null {
    const id = asString(rawComment.id);
    const createdAt = asString(rawComment.createdAt);
    if (!id || !createdAt) return null;
    return {
      id,
      body: asString(rawComment.body) ?? "",
      createdAt,
      updatedAt: asString(rawComment.updatedAt),
      url: asString(rawComment.url),
      author: {
        login: asString(rawComment.author?.login) ?? "unknown",
        avatarUrl: asString(rawComment.author?.avatarUrl),
        profileUrl: asString(rawComment.author?.url),
      },
    };
  }

  private normalizePullRequestReviewComment(rawComment: GhReviewThreadComment): PullRequestReviewComment | null {
    const id = asId(rawComment.id);
    const createdAt = asString(rawComment.created_at);
    if (!id || !createdAt) return null;
    return {
      id,
      body: asString(rawComment.body) ?? "",
      createdAt,
      updatedAt: asString(rawComment.updated_at),
      url: asString(rawComment.html_url),
      author: {
        login: asString(rawComment.user?.login) ?? "unknown",
        avatarUrl: asString(rawComment.user?.avatar_url),
        profileUrl: asString(rawComment.user?.html_url),
      },
    };
  }

  private toGithubRepoUrl(remoteUrl: string): string | undefined {
    const normalized = remoteUrl.trim();
    if (normalized.length === 0) {
      return undefined;
    }

    const httpsMatch = normalized.match(/^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/i);
    if (httpsMatch) {
      return `https://github.com/${httpsMatch[1]}`;
    }

    const scpMatch = normalized.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/i);
    if (scpMatch) {
      return `https://github.com/${scpMatch[1]}`;
    }

    const sshMatch = normalized.match(/^ssh:\/\/git@github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/i);
    if (sshMatch) {
      return `https://github.com/${sshMatch[1]}`;
    }

    return undefined;
  }

  private async resolveGithubRepoSlug(repoPath: string): Promise<string | undefined> {
    try {
      const originUrl = (await textFromGit(["remote", "get-url", "origin"], repoPath)).trim();
      const githubRepoUrl = this.toGithubRepoUrl(originUrl);
      if (!githubRepoUrl) return undefined;
      const match = githubRepoUrl.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)$/i);
      return match?.[1];
    } catch {
      return undefined;
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
