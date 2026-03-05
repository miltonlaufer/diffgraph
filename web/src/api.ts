import type { FileDiffEntry, SymbolDetail, ViewGraph } from "./types/graph";

const queryParam = (name: string): string => {
  const params = new URLSearchParams(window.location.search);
  return params.get(name) ?? "";
};

export const getDiffId = (): string => queryParam("diffId");

export const fetchView = async (diffId: string, viewType: "logic" | "knowledge" | "react"): Promise<{ oldGraph: ViewGraph; newGraph: ViewGraph }> => {
  const response = await fetch(`/api/views/${diffId}/${viewType}`);
  if (!response.ok) {
    throw new Error("Failed to load view graph");
  }
  return (await response.json()) as { oldGraph: ViewGraph; newGraph: ViewGraph };
};

export const fetchSymbolDetail = async (diffId: string, symbolId: string): Promise<SymbolDetail> => {
  const response = await fetch(`/api/diff/${diffId}/symbol/${symbolId}`);
  if (!response.ok) {
    throw new Error("Failed to load symbol details");
  }
  return (await response.json()) as SymbolDetail;
};

export const fetchDiffFiles = async (diffId: string): Promise<FileDiffEntry[]> => {
  const response = await fetch(`/api/diff/${diffId}/files`);
  if (!response.ok) {
    throw new Error("Failed to load file diffs");
  }
  return (await response.json()) as FileDiffEntry[];
};

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

export interface PullRequestReviewThreadsResponse {
  threads: PullRequestReviewThread[];
  diagnostics: PullRequestReviewThreadsDiagnostics | null;
}

export const fetchPullRequestReviewThreads = async (diffId: string): Promise<PullRequestReviewThread[]> => {
  const response = await fetch(`/api/diff/${diffId}/pull-request-threads`);
  if (!response.ok) {
    throw new Error("Failed to load pull request review threads");
  }
  const payload = (await response.json()) as PullRequestReviewThread[] | PullRequestReviewThreadsResponse;
  if (Array.isArray(payload)) {
    return payload;
  }
  const threads = Array.isArray(payload?.threads) ? payload.threads : [];
  if (threads.length === 0 && payload?.diagnostics) {
    console.warn("[diffgraph] pull-request-threads returned no threads", payload.diagnostics);
  }
  return threads;
};

export interface DiffMeta {
  diffId: string;
  oldRef: string;
  newRef: string;
  hasReactView: boolean;
  pullRequestNumber?: string;
  pullRequestUrl?: string;
  pullRequestDescription?: string;
  pullRequestDescriptionExcerpt?: string;
  pullRequestDescriptionTruncated?: boolean;
}

export const fetchDiffMeta = async (diffId: string): Promise<DiffMeta> => {
  const response = await fetch(`/api/diff/${diffId}/meta`);
  if (!response.ok) {
    throw new Error("Failed to load diff metadata");
  }
  return (await response.json()) as DiffMeta;
};
