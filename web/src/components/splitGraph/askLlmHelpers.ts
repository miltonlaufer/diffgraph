import type { MutableRefObject } from "react";
import {
  lineRangeText,
  oneLine,
  shortPathForPrompt,
  shortStatus,
} from "./helpers";
import { normPath } from "./layout";
import type { ViewGraphNode } from "#/types/graph";
import type { ViewGraph } from "#/types/graph";

export const ASK_LLM_MESSAGE =
  "Can you explain the probable reason for doing this code change, what the consequences are, and suggest any improvement to it?";
export const ASK_LLM_CONTEXT_RADIUS = 4;
export const ASK_LLM_MAX_NODE_LINES = 64;
export const ASK_LLM_MAX_CONNECTED_NODES = 80;
export const ASK_LLM_URL_CONTEXT_RADIUS = 2;
export const ASK_LLM_URL_MAX_NODE_LINES = 28;
export const ASK_LLM_URL_MAX_CONNECTED_NODES = 24;

export const nodeCodeLinesFromMap = (
  contentMap: Map<string, string> | undefined,
  cache: Map<string, string[]>,
  node: ViewGraphNode,
): string[] => {
  const start = node.startLine ?? 0;
  if (start < 1) return [];
  const end = node.endLine && node.endLine >= start ? node.endLine : start;
  const from = Math.max(1, start - ASK_LLM_CONTEXT_RADIUS);
  const to = Math.min(start + ASK_LLM_MAX_NODE_LINES - 1, end + ASK_LLM_CONTEXT_RADIUS);
  if (!contentMap) return [];
  const normalizedPath = normPath(node.filePath);
  const cacheKey = `${normalizedPath}:${node.filePath}`;
  let lines = cache.get(cacheKey);
  if (!lines) {
    const content = contentMap.get(normalizedPath) ?? contentMap.get(node.filePath) ?? "";
    lines = content.length > 0 ? content.split("\n") : [];
    cache.set(cacheKey, lines);
  }
  if (lines.length === 0) return [];
  const sliceFrom = Math.max(0, from - 1);
  const sliceTo = Math.min(lines.length, to);
  return lines.slice(sliceFrom, sliceTo).map((text, idx) => `${from + idx}: ${text}`);
};

export const nodeSnippetFromMap = (
  contentMap: Map<string, string> | undefined,
  cache: Map<string, string[]>,
  node: ViewGraphNode,
  contextRadius: number,
  maxNodeLines: number,
): { startLine: number; lines: string[] } | null => {
  const start = node.startLine ?? 0;
  if (start < 1) return null;
  const end = node.endLine && node.endLine >= start ? node.endLine : start;
  const from = Math.max(1, start - contextRadius);
  const to = Math.min(start + maxNodeLines - 1, end + contextRadius);
  if (!contentMap) return null;
  const normalizedPath = normPath(node.filePath);
  const cacheKey = `${normalizedPath}:${node.filePath}`;
  let sourceLines = cache.get(cacheKey);
  if (!sourceLines) {
    const content = contentMap.get(normalizedPath) ?? contentMap.get(node.filePath) ?? "";
    sourceLines = content.length > 0 ? content.split("\n") : [];
    cache.set(cacheKey, sourceLines);
  }
  if (sourceLines.length === 0) return null;
  const sliceFrom = Math.max(0, from - 1);
  const sliceTo = Math.min(sourceLines.length, to);
  return { startLine: from, lines: sourceLines.slice(sliceFrom, sliceTo) };
};

export const buildMiniUnifiedDiff = (
  oldSnippet: { startLine: number; lines: string[] } | null,
  newSnippet: { startLine: number; lines: string[] } | null,
): string[] => {
  const oldLines = oldSnippet?.lines ?? [];
  const newLines = newSnippet?.lines ?? [];
  if (oldLines.length === 0 && newLines.length === 0) {
    return ["@@ -0,0 +0,0 @@", "(code unavailable)"];
  }

  const maxLen = Math.max(oldLines.length, newLines.length);
  const changedIndices: number[] = [];
  for (let idx = 0; idx < maxLen; idx += 1) {
    if ((oldLines[idx] ?? "") !== (newLines[idx] ?? "")) {
      changedIndices.push(idx);
    }
  }
  if (changedIndices.length === 0) {
    return [
      `@@ -${oldSnippet?.startLine ?? 1},${oldLines.length} +${newSnippet?.startLine ?? 1},${newLines.length} @@`,
      " (unchanged snippet)",
    ];
  }

  const include = new Set<number>();
  for (const idx of changedIndices) {
    include.add(idx);
    include.add(idx - 1);
    include.add(idx + 1);
  }
  const included = [...include]
    .filter((idx) => idx >= 0 && idx < maxLen)
    .sort((a, b) => a - b);
  if (included.length === 0) {
    return [
      `@@ -${oldSnippet?.startLine ?? 1},${oldLines.length} +${newSnippet?.startLine ?? 1},${newLines.length} @@`,
    ];
  }

  const first = included[0] ?? 0;
  const oldStart = (oldSnippet?.startLine ?? 1) + first;
  const newStart = (newSnippet?.startLine ?? 1) + first;
  const diff: string[] = [`@@ -${oldStart},${oldLines.length} +${newStart},${newLines.length} @@`];
  for (const idx of included) {
    const oldText = oldLines[idx];
    const newText = newLines[idx];
    if (oldText !== undefined && newText !== undefined && oldText === newText) {
      diff.push(` ${oldText}`);
      continue;
    }
    if (oldText !== undefined) diff.push(`-${oldText}`);
    if (newText !== undefined) diff.push(`+${newText}`);
  }
  return diff;
};

export const nodePromptBlock = (
  node: ViewGraphNode,
  contentMap: Map<string, string> | undefined,
  cache: Map<string, string[]>,
): string[] => {
  const lines = nodeCodeLinesFromMap(contentMap, cache, node);
  const rangeText = lineRangeText(node.startLine, node.endLine);
  const block = [
    `Label: ${oneLine(node.label)}`,
    `Kind: ${node.kind}`,
    `Diff status: ${node.diffStatus}`,
    `File: ${node.filePath}`,
    `Line range: ${rangeText}`,
    "Code:",
  ];
  if (lines.length === 0) {
    block.push("  (code unavailable)");
  } else {
    block.push(...lines.map((line) => `  ${line}`));
  }
  return block;
};

export const copyTextToClipboard = async (text: string): Promise<boolean> => {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below.
    }
  }

  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  textarea.setAttribute("readonly", "true");
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  return copied;
};

export interface UseAskLlmPromptParams {
  side: "old" | "new";
  graph: ViewGraph;
  graphNodeById: Map<string, ViewGraphNode>;
  counterpartNodeById: Map<string, ViewGraphNode>;
  indexedMatchKeyByNodeId: Map<string, string>;
  counterpartNodeIdByIndexedMatchKey: Map<string, string>;
  fileContentMap: Map<string, string>;
  counterpartFileContentMap: Map<string, string>;
  fileLinesCacheRef: MutableRefObject<Map<string, string[]>>;
  counterpartFileLinesCacheRef: MutableRefObject<Map<string, string[]>>;
  pullRequestDescriptionExcerpt: string;
}

export const buildAskLlmPrompt = (params: UseAskLlmPromptParams) => (nodeId: string): string => {
  const {
    side,
    graph,
    graphNodeById,
    counterpartNodeById,
    counterpartNodeIdByIndexedMatchKey,
    indexedMatchKeyByNodeId,
    fileContentMap,
    counterpartFileContentMap,
    fileLinesCacheRef,
    counterpartFileLinesCacheRef,
    pullRequestDescriptionExcerpt,
  } = params;
  const node = graphNodeById.get(nodeId);
  if (!node) {
    return `${ASK_LLM_MESSAGE}\n\nNode context is unavailable.`;
  }
  const oppositeSide: "old" | "new" = side === "old" ? "new" : "old";

  const appendNodeWithVersions = (lines: string[], currentNode: ViewGraphNode): void => {
    lines.push(`${side.toUpperCase()} code:`);
    lines.push(
      ...nodePromptBlock(currentNode, fileContentMap, fileLinesCacheRef.current),
    );
    const indexedKey = indexedMatchKeyByNodeId.get(currentNode.id);
    const counterpartNodeId = indexedKey
      ? counterpartNodeIdByIndexedMatchKey.get(indexedKey)
      : undefined;
    const counterpartNode = counterpartNodeId
      ? counterpartNodeById.get(counterpartNodeId)
      : undefined;
    if (!counterpartNode) return;
    lines.push("");
    lines.push(`${oppositeSide.toUpperCase()} code:`);
    lines.push(
      ...nodePromptBlock(
        counterpartNode,
        counterpartFileContentMap,
        counterpartFileLinesCacheRef.current,
      ),
    );
  };

  const edges = graph.edges.filter(
    (edge) => edge.source === nodeId || edge.target === nodeId,
  );
  const connectedIds: string[] = [];
  const connectionByNodeId = new Map<string, string[]>();
  for (const edge of edges) {
    const otherId = edge.source === nodeId ? edge.target : edge.source;
    if (!otherId || otherId === nodeId) continue;
    if (!connectionByNodeId.has(otherId)) {
      connectionByNodeId.set(otherId, []);
      connectedIds.push(otherId);
    }
    const direction = edge.source === nodeId ? "outgoing" : "incoming";
    const relation = edge.relation ?? edge.kind;
    const flow = edge.flowType ? `/${edge.flowType}` : "";
    connectionByNodeId.get(otherId)?.push(`${direction} ${relation}${flow} [${edge.diffStatus}]`);
  }

  const selectedConnectedIds = connectedIds.slice(0, ASK_LLM_MAX_CONNECTED_NODES);
  const omittedCount = connectedIds.length - selectedConnectedIds.length;
  const promptLines = [ASK_LLM_MESSAGE];
  if (
    pullRequestDescriptionExcerpt &&
    pullRequestDescriptionExcerpt.trim().length > 0
  ) {
    promptLines.push("", "PR description (excerpt):", pullRequestDescriptionExcerpt.trim());
  }
  promptLines.push("", `Graph side: ${side}`, "", "Primary node:");
  appendNodeWithVersions(promptLines, node);
  promptLines.push("");
  promptLines.push(
    `Connected nodes (${selectedConnectedIds.length}${omittedCount > 0 ? ` of ${connectedIds.length}` : ""}):`,
  );

  if (selectedConnectedIds.length === 0) {
    promptLines.push("  (none)");
  } else {
    for (const [idx, relatedId] of selectedConnectedIds.entries()) {
      const relatedNode = graphNodeById.get(relatedId);
      if (!relatedNode) continue;
      const edgesSummary =
        connectionByNodeId.get(relatedId)?.join("; ") ?? "related";
      promptLines.push("");
      promptLines.push(`${idx + 1}. ${oneLine(relatedNode.label)}`);
      promptLines.push(`Connections: ${edgesSummary}`);
      appendNodeWithVersions(promptLines, relatedNode);
    }
  }
  if (omittedCount > 0) {
    promptLines.push("");
    promptLines.push(`... ${omittedCount} additional connected nodes omitted.`);
  }

  return promptLines.join("\n");
};

export const buildAskLlmUrlPrompt = (params: UseAskLlmPromptParams) => (nodeId: string): string => {
  const {
    side,
    graph,
    graphNodeById,
    counterpartNodeById,
    counterpartNodeIdByIndexedMatchKey,
    indexedMatchKeyByNodeId,
    fileContentMap,
    counterpartFileContentMap,
    fileLinesCacheRef,
    counterpartFileLinesCacheRef,
    pullRequestDescriptionExcerpt,
  } = params;
  const node = graphNodeById.get(nodeId);
  if (!node) {
    return "Task: explain reason, consequences, improvements.\n(no node context)";
  }

  const resolveCounterpart = (
    currentNode: ViewGraphNode,
  ): ViewGraphNode | undefined => {
    const indexedKey = indexedMatchKeyByNodeId.get(currentNode.id);
    const counterpartNodeId = indexedKey
      ? counterpartNodeIdByIndexedMatchKey.get(indexedKey)
      : undefined;
    return counterpartNodeId
      ? counterpartNodeById.get(counterpartNodeId)
      : undefined;
  };

  const primaryCounterpart = resolveCounterpart(node);
  const currentSnippet = nodeSnippetFromMap(
    fileContentMap,
    fileLinesCacheRef.current,
    node,
    ASK_LLM_URL_CONTEXT_RADIUS,
    ASK_LLM_URL_MAX_NODE_LINES,
  );
  const counterpartSnippet = primaryCounterpart
    ? nodeSnippetFromMap(
        counterpartFileContentMap,
        counterpartFileLinesCacheRef.current,
        primaryCounterpart,
        ASK_LLM_URL_CONTEXT_RADIUS,
        ASK_LLM_URL_MAX_NODE_LINES,
      )
    : null;
  const oldSnippet = side === "old" ? currentSnippet : counterpartSnippet;
  const newSnippet = side === "new" ? currentSnippet : counterpartSnippet;

  const lines: string[] = [
    "Task: explain reason, consequences, improvements.",
  ];
  if (
    pullRequestDescriptionExcerpt &&
    pullRequestDescriptionExcerpt.trim().length > 0
  ) {
    lines.push(`pr:${oneLine(pullRequestDescriptionExcerpt)}`);
  }
  lines.push(
    `p|st:${shortStatus(node.diffStatus)}|k:${node.kind}|sym:${oneLine(node.label)}|f:${shortPathForPrompt(node.filePath)}`,
  );
  if (primaryCounterpart) {
    lines.push(
      `p2|st:${shortStatus(primaryCounterpart.diffStatus)}|k:${primaryCounterpart.kind}|sym:${oneLine(primaryCounterpart.label)}|f:${shortPathForPrompt(primaryCounterpart.filePath)}`,
    );
  }

  lines.push("diff:");
  lines.push(...buildMiniUnifiedDiff(oldSnippet, newSnippet));

  const relatedById = new Map<string, { score: number; rels: Set<string> }>();
  for (const edge of graph.edges) {
    if (edge.source !== nodeId && edge.target !== nodeId) continue;
    const relatedId = edge.source === nodeId ? edge.target : edge.source;
    if (!relatedId || relatedId === nodeId) continue;
    const relatedNode = graphNodeById.get(relatedId);
    if (!relatedNode) continue;
    const direction = edge.source === nodeId ? "out" : "in";
    const rel = edge.relation ?? edge.kind;
    const flow = edge.flowType ? `/${edge.flowType}` : "";
    const relToken = `${direction}:${rel}${flow}`;
    const base = relatedById.get(relatedId) ?? {
      score: 0,
      rels: new Set<string>(),
    };
    base.rels.add(relToken);
    base.score = Math.max(
      base.score,
      (relatedNode.diffStatus !== "unchanged" ? 4 : 0) +
        (edge.relation === "invoke" ? 2 : 0) +
        (edge.relation === "flow" ? 1 : 0),
    );
    relatedById.set(relatedId, base);
  }

  const relatedEntries = [...relatedById.entries()]
    .map(([relatedId, meta]) => ({
      relatedId,
      node: graphNodeById.get(relatedId),
      score: meta.score,
      rels: [...meta.rels].sort().join(","),
    }))
    .filter(
      (
        entry,
      ): entry is {
        relatedId: string;
        node: ViewGraphNode;
        score: number;
        rels: string;
      } => entry.node !== undefined,
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        oneLine(a.node.label).localeCompare(oneLine(b.node.label)),
    );

  const selectedRelated = relatedEntries.slice(0, ASK_LLM_URL_MAX_CONNECTED_NODES);
  lines.push(`ctx:${selectedRelated.length}`);
  for (const [idx, related] of selectedRelated.entries()) {
    const counterpart = resolveCounterpart(related.node);
    const counterpartToken = counterpart
      ? `|p2:${oneLine(counterpart.label)}`
      : "";
    lines.push(
      `${idx + 1}|st:${shortStatus(related.node.diffStatus)}|rel:${related.rels}|sym:${oneLine(related.node.label)}|f:${shortPathForPrompt(related.node.filePath)}${counterpartToken}`,
    );
  }
  const omitted = relatedEntries.length - selectedRelated.length;
  if (omitted > 0) {
    lines.push(`...+${omitted} more`);
  }

  return lines.join("\n");
};
