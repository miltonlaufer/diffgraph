import type { FileDiffEntry, ViewGraph } from "../types/graph";
import type { DiffMeta } from "../api";
import { fetchDiffFiles, fetchView } from "../api";

type ViewType = "logic" | "knowledge" | "react";

interface CachedView {
  oldGraph: ViewGraph;
  newGraph: ViewGraph;
}

interface DiffCache {
  meta: DiffMeta | null;
  files: FileDiffEntry[] | null;
  views: Map<ViewType, CachedView>;
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

  const promise = Promise.all([
    fetchDiffFiles(diffId),
    ...viewTypes.map((vt) =>
      fetchView(diffId, vt).then((payload) => {
        c.views.set(vt, { oldGraph: payload.oldGraph, newGraph: payload.newGraph });
      }),
    ),
  ])
    .then(([files]) => {
      c.files = files as FileDiffEntry[];
    })
    .catch(() => {
      prefetchPromises.delete(key);
      cache.delete(diffId);
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
