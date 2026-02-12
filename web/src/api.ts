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
