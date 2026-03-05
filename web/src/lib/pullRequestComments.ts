import type { PullRequestReviewThread } from "#/api";
import type { ViewGraphNode } from "#/types/graph";

export type DiffSide = "old" | "new";
export type PathAliasesByPath = Map<string, string[]>;

export const normalizeDiffPath = (value: string): string =>
  value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");

interface LineRange {
  start: number;
  end: number;
}

const normalizeLineRange = (start?: number, end?: number): LineRange | null => {
  if (!end || end < 1) return null;
  const safeStart = start && start > 0 ? start : end;
  if (safeStart <= end) return { start: safeStart, end };
  return { start: end, end: safeStart };
};

export const resolveThreadLineRange = (
  thread: PullRequestReviewThread,
  side: DiffSide,
): LineRange | null => {
  if (side === "new") {
    const endLine = thread.line ?? (thread.side === "new" ? thread.originalLine : undefined);
    const startLine = thread.startLine ?? (thread.startSide === "new" ? thread.originalStartLine : undefined);
    return normalizeLineRange(startLine, endLine);
  }

  const endLine = thread.originalLine ?? (thread.side === "old" ? thread.line : undefined);
  const startLine = thread.originalStartLine ?? (thread.startSide === "old" ? thread.startLine : undefined);
  return normalizeLineRange(startLine, endLine);
};

const resolveNodeLineRange = (node: Pick<ViewGraphNode, "startLine" | "endLine">): LineRange | null => {
  const end = node.endLine ?? node.startLine;
  if (!end || end < 1) return null;
  const start = node.startLine ?? end;
  if (start <= end) return { start, end };
  return { start: end, end: start };
};

const rangesOverlap = (a: LineRange, b: LineRange): boolean =>
  a.start <= b.end && b.start <= a.end;

const buildComparablePathSet = (filePath: string, aliases?: string[]): Set<string> => {
  const comparable = new Set<string>([normalizeDiffPath(filePath)]);
  for (const alias of aliases ?? []) {
    const normalizedAlias = normalizeDiffPath(alias);
    if (normalizedAlias) comparable.add(normalizedAlias);
  }
  return comparable;
};

export const buildLineThreadIndex = (
  threads: PullRequestReviewThread[],
  filePath: string,
  side: DiffSide,
  aliases?: string[],
): Map<number, string[]> => {
  const comparablePaths = buildComparablePathSet(filePath, aliases);
  const lineToThreadIds = new Map<number, string[]>();
  for (const thread of threads) {
    if (thread.kind === "discussion") continue;
    if (!comparablePaths.has(normalizeDiffPath(thread.filePath))) continue;
    const range = resolveThreadLineRange(thread, side);
    if (!range) continue;
    for (let line = range.start; line <= range.end; line += 1) {
      const current = lineToThreadIds.get(line);
      if (current) {
        current.push(thread.id);
      } else {
        lineToThreadIds.set(line, [thread.id]);
      }
    }
  }
  return lineToThreadIds;
};

export const buildNodeThreadIndex = (
  threads: PullRequestReviewThread[],
  nodes: Array<Pick<ViewGraphNode, "id" | "filePath" | "startLine" | "endLine">>,
  side: DiffSide,
  pathAliasesByPath?: PathAliasesByPath,
): Map<string, string[]> => {
  const nodeToThreadIds = new Map<string, string[]>();
  for (const node of nodes) {
    const nodeRange = resolveNodeLineRange(node);
    if (!nodeRange) continue;
    const normalizedPath = normalizeDiffPath(node.filePath);
    const aliases = pathAliasesByPath?.get(normalizedPath) ?? [];
    const comparablePaths = buildComparablePathSet(normalizedPath, aliases);

    for (const thread of threads) {
      if (thread.kind === "discussion") continue;
      if (!comparablePaths.has(normalizeDiffPath(thread.filePath))) continue;
      const threadRange = resolveThreadLineRange(thread, side);
      if (!threadRange || !rangesOverlap(nodeRange, threadRange)) continue;
      const current = nodeToThreadIds.get(node.id);
      if (current) {
        current.push(thread.id);
      } else {
        nodeToThreadIds.set(node.id, [thread.id]);
      }
    }
  }
  return nodeToThreadIds;
};

export interface ThreadBadgeSummary {
  totalCount: number;
  unresolvedCount: number;
}

export const summarizeThreadBadge = (
  threadIds: string[] | undefined,
  threadById: Map<string, PullRequestReviewThread>,
): ThreadBadgeSummary => {
  if (!threadIds || threadIds.length === 0) {
    return { totalCount: 0, unresolvedCount: 0 };
  }
  let unresolvedCount = 0;
  for (const threadId of threadIds) {
    if (!threadById.get(threadId)?.resolved) {
      unresolvedCount += 1;
    }
  }
  return { totalCount: threadIds.length, unresolvedCount };
};
