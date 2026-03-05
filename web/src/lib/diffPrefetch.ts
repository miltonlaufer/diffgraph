import type { FileDiffEntry, ViewGraph } from "../types/graph";
import type { DiffMeta } from "../api";
import type { PullRequestReviewThread } from "../api";
import { fetchDiffFiles, fetchPullRequestReviewThreads, fetchView } from "../api";

type ViewType = "logic" | "knowledge" | "react";

interface CachedView {
  oldGraph: ViewGraph;
  newGraph: ViewGraph;
}

interface DiffCache {
  meta: DiffMeta | null;
  files: FileDiffEntry[] | null;
  views: Map<ViewType, CachedView>;
  reviewThreads: PullRequestReviewThread[] | null;
}

const cache = new Map<string, DiffCache>();
const prefetchPromises = new Map<string, Promise<void>>();

const getOrCreateCache = (diffId: string): DiffCache => {
  let entry = cache.get(diffId);
  if (!entry) {
    entry = {
      meta: null,
      files: null,
      views: new Map(),
      reviewThreads: null,
    };
    cache.set(diffId, entry);
  }
  return entry;
};

export const getCachedMeta = (diffId: string): DiffMeta | null =>
  cache.get(diffId)?.meta ?? null;

export const getCachedView = (
  diffId: string,
  viewType: ViewType,
): CachedView | null =>
  cache.get(diffId)?.views.get(viewType) ?? null;

export const getCachedFiles = (diffId: string): FileDiffEntry[] | null =>
  cache.get(diffId)?.files ?? null;

export const getCachedReviewThreads = (diffId: string): PullRequestReviewThread[] | null =>
  cache.get(diffId)?.reviewThreads ?? null;

export const prefetchDiff = (
  diffId: string,
  meta: DiffMeta,
): Promise<void> => {
  const key = diffId;
  const existing = prefetchPromises.get(key);
  if (existing) return existing;

  const c = getOrCreateCache(diffId);
  c.meta = meta;

  const viewTypes: ViewType[] = ["logic", "knowledge"];
  if (meta.hasReactView) viewTypes.push("react");

  const filesPromise = fetchDiffFiles(diffId);
  const viewPromises = viewTypes.map((vt) =>
    fetchView(diffId, vt).then((payload) => ({ oldGraph: payload.oldGraph, newGraph: payload.newGraph })),
  );
  const reviewThreadsPromise = meta.pullRequestNumber
    ? fetchPullRequestReviewThreads(diffId)
    : Promise.resolve<PullRequestReviewThread[]>([]);

  const promise = Promise.allSettled([
    filesPromise,
    Promise.allSettled(viewPromises),
    reviewThreadsPromise,
  ])
    .then(([filesResult, viewResultsResult, reviewThreadsResult]) => {
      if (filesResult.status === "fulfilled") {
        c.files = filesResult.value as FileDiffEntry[];
      }
      if (viewResultsResult.status === "fulfilled") {
        viewResultsResult.value.forEach((result, i) => {
          if (result.status === "fulfilled") {
            c.views.set(viewTypes[i], result.value);
          }
        });
      }
      if (reviewThreadsResult?.status === "fulfilled") {
        c.reviewThreads = reviewThreadsResult.value as PullRequestReviewThread[];
      }
    })
    .finally(() => {
      prefetchPromises.delete(key);
    });

  prefetchPromises.set(key, promise);
  return promise;
};

export const setCachedMeta = (diffId: string, meta: DiffMeta): void => {
  getOrCreateCache(diffId).meta = meta;
};

export const setCachedView = (
  diffId: string,
  viewType: ViewType,
  payload: CachedView,
): void => {
  getOrCreateCache(diffId).views.set(viewType, payload);
};

export const setCachedFiles = (diffId: string, files: FileDiffEntry[]): void => {
  getOrCreateCache(diffId).files = files;
};

export const setCachedReviewThreads = (
  diffId: string,
  reviewThreads: PullRequestReviewThread[],
): void => {
  getOrCreateCache(diffId).reviewThreads = reviewThreads;
};
