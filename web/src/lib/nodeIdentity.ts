import type { ViewGraphNode } from "#/types/graph";

const normalizePath = (value: string): string =>
  value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");

const normalizeLabel = (label: string): string =>
  label
    .replace(/^\[[^\]]+\]\s*/, "")
    .replace(/@\d+/g, "@#")
    .replace(/\bline\s+\d+\b/gi, "line #")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export const buildCrossGraphNodeMatchKey = (
  node: Pick<ViewGraphNode, "kind" | "filePath" | "className" | "label" | "branchType">,
): string =>
  `${node.kind}:${normalizePath(node.filePath)}:${(node.className ?? "").trim().toLowerCase()}:${(node.branchType ?? "").trim().toLowerCase()}:${normalizeLabel(node.label)}`;
