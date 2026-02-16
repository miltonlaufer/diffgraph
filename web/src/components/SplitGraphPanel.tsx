import { useMemo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeMouseHandler,
  type Viewport,
} from "@xyflow/react";
import { observer, useLocalObservable } from "mobx-react-lite";
import { GraphCanvas } from "./splitGraph/GraphCanvas";
import { useSplitGraphRuntime } from "./splitGraph/context";
import { GraphPanelHeader } from "./splitGraph/GraphPanelHeader";
import {
  buildTopLevelAnchorKeyByNodeId,
  computeLayoutByView,
  knowledgeNodeTypes,
  LEAF_H,
  LEAF_W,
  logicNodeTypes,
  normPath,
  stableNodeKey,
} from "./splitGraph/layout";
import { SplitGraphPanelStore } from "./splitGraph/store";
import { useSplitGraphDerivedWorker } from "./splitGraph/useSplitGraphDerivedWorker";
import { useFlowContainerSize } from "./splitGraph/useFlowContainerSize";
import { useSplitGraphLayoutWorker } from "./splitGraph/useSplitGraphLayoutWorker";
import {
  computeNodeAbsolutePosition,
  computeViewportForNode,
  isNodeVisibleInViewport as computeIsNodeVisibleInViewport,
} from "./splitGraph/viewport";
import { buildCrossGraphNodeMatchKey } from "../lib/nodeIdentity";
import type { ViewGraphNode } from "../types/graph";
import type { GraphDiffTarget, InternalNodeAnchor, SplitGraphPanelProps, TopLevelAnchor } from "./splitGraph/types";

export type { AlignmentBreakpoint, GraphDiffTarget, InternalNodeAnchor, TopLevelAnchor } from "./splitGraph/types";

const SEARCH_FLASH_MS = 5000;
const SEARCH_FLASH_STYLE = {
  outline: "5px solid #ffffff",
  outlineOffset: "3px",
  boxShadow: "0 0 0 2px rgba(255,255,255,0.95), 0 0 28px rgba(255,255,255,0.92)",
  zIndex: 1000,
};
const EDGE_TOOLTIP_OFFSET_X = 12;
const EDGE_TOOLTIP_OFFSET_Y = 14;
const EDGE_CLICK_HIGHLIGHT_MS = 5000;
const GROUP_BLOCK_GAP = 22;
const VIEWPORT_EPSILON = 0.5;
const VIEWPORT_ZOOM_EPSILON = 0.001;
const DIAMOND_BOUNDS = 146;
const FLOW_NODE_W = 220;
const FLOW_NODE_H = 72;
const ASK_LLM_MESSAGE = "Can you explain the probable reason for doing this code change, what the consequences are, and suggest any improvement to it?";
const ASK_LLM_CONTEXT_RADIUS = 4;
const ASK_LLM_MAX_NODE_LINES = 64;
const ASK_LLM_MAX_CONNECTED_NODES = 80;
const ASK_LLM_URL_CONTEXT_RADIUS = 2;
const ASK_LLM_URL_MAX_NODE_LINES = 28;
const ASK_LLM_URL_MAX_CONNECTED_NODES = 24;
const CHATGPT_URL_PREFIX = "https://chatgpt.com/?prompt=";
const CHATGPT_URL_MAX_LENGTH = 7000;
const CHATGPT_URL_TRUNCATION_NOTICE = "\n\n[PROMPT CUT BECAUSE OF URL LENGTH LIMIT]";

interface PanelViewport {
  x: number;
  y: number;
  zoom: number;
}

const labelIdentity = (label: string): string =>
  label
    .replace(/^\[[^\]]+\]\s*/, "")
    .replace(/@\d+/g, "@#")
    .replace(/\bline\s+\d+\b/gi, "line #")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const structuralAnchorKey = (topKey: string, kind: string, filePath: string, className: string | undefined, label: string, branchType: string | undefined): string =>
  `${topKey}:${kind}:${normPath(filePath)}:${(className ?? "").trim().toLowerCase()}:${labelIdentity(label)}:${(branchType ?? "").trim().toLowerCase()}`;

const oneLine = (value: string): string => value.replace(/\s+/g, " ").trim();

const lineRangeText = (startLine?: number, endLine?: number): string => {
  if (!startLine || startLine < 1) return "unknown";
  if (!endLine || endLine < startLine) return `${startLine}`;
  return `${startLine}-${endLine}`;
};

const shortPathForPrompt = (filePath: string): string => {
  const normalized = normPath(filePath);
  const parts = normalized.split("/").filter((part) => part.length > 0);
  if (parts.length <= 3) return normalized;
  return parts.slice(-3).join("/");
};

const shortStatus = (status: string): string => {
  if (status === "added") return "a";
  if (status === "removed") return "r";
  if (status === "modified") return "m";
  return "u";
};

const buildCappedChatGptUrl = (prompt: string): string => {
  const maxEncodedPromptLen = Math.max(256, CHATGPT_URL_MAX_LENGTH - CHATGPT_URL_PREFIX.length);
  const encodedFullPrompt = encodeURIComponent(prompt);
  if (encodedFullPrompt.length <= maxEncodedPromptLen) {
    return `${CHATGPT_URL_PREFIX}${encodedFullPrompt}`;
  }

  const encodedNotice = encodeURIComponent(CHATGPT_URL_TRUNCATION_NOTICE);
  const contentBudget = maxEncodedPromptLen - encodedNotice.length;
  if (contentBudget <= 0) {
    return `${CHATGPT_URL_PREFIX}${encodedNotice.slice(0, maxEncodedPromptLen)}`;
  }

  let low = 0;
  let high = prompt.length;
  let best = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const encodedCandidate = encodeURIComponent(prompt.slice(0, mid));
    if (encodedCandidate.length <= contentBudget) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const truncatedPrompt = `${prompt.slice(0, best).trimEnd()}${CHATGPT_URL_TRUNCATION_NOTICE}`;
  const encodedTruncatedPrompt = encodeURIComponent(truncatedPrompt);
  return `${CHATGPT_URL_PREFIX}${encodedTruncatedPrompt.slice(0, maxEncodedPromptLen)}`;
};

const buildIndexedMatchKeyByNodeId = (nodes: ViewGraphNode[]): Map<string, string> => {
  const baseKeyNodeIds = new Map<string, string[]>();
  for (const node of nodes) {
    const baseKey = buildCrossGraphNodeMatchKey(node);
    const list = baseKeyNodeIds.get(baseKey) ?? [];
    list.push(node.id);
    baseKeyNodeIds.set(baseKey, list);
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const indexedMatchKeyByNodeId = new Map<string, string>();
  for (const [baseKey, nodeIds] of baseKeyNodeIds.entries()) {
    const sortedNodeIds = nodeIds.slice().sort((a, b) => {
      const nodeA = nodeById.get(a);
      const nodeB = nodeById.get(b);
      const startA = nodeA?.startLine ?? Number.MAX_SAFE_INTEGER;
      const startB = nodeB?.startLine ?? Number.MAX_SAFE_INTEGER;
      if (startA !== startB) return startA - startB;
      const endA = nodeA?.endLine ?? startA;
      const endB = nodeB?.endLine ?? startB;
      if (endA !== endB) return endA - endB;
      return a.localeCompare(b);
    });
    for (const [idx, nodeId] of sortedNodeIds.entries()) {
      indexedMatchKeyByNodeId.set(nodeId, `${baseKey}#${idx + 1}`);
    }
  }
  return indexedMatchKeyByNodeId;
};

const isGroupHeaderTarget = (event: unknown): boolean => {
  const maybeTarget = (event as { target?: EventTarget | null } | null)?.target;
  if (!(maybeTarget instanceof Element)) return false;
  return Boolean(maybeTarget.closest("[data-group-header='true']"));
};

const nodeSize = (node: Node): { width: number; height: number } => {
  const styleWidth = typeof node.style?.width === "number" ? node.style.width : undefined;
  const styleHeight = typeof node.style?.height === "number" ? node.style.height : undefined;
  const initialWidth = typeof node.initialWidth === "number" ? node.initialWidth : undefined;
  const initialHeight = typeof node.initialHeight === "number" ? node.initialHeight : undefined;
  const fallback = (() => {
    if (node.type === "diamond") return { width: DIAMOND_BOUNDS, height: DIAMOND_BOUNDS };
    if (node.type === "knowledge") return { width: FLOW_NODE_W, height: LEAF_H };
    if (node.type === "scope") return { width: LEAF_W, height: LEAF_H };
    return { width: FLOW_NODE_W, height: FLOW_NODE_H };
  })();
  return {
    width: Math.max(styleWidth ?? 0, initialWidth ?? 0, fallback.width),
    height: Math.max(styleHeight ?? 0, initialHeight ?? 0, fallback.height),
  };
};

const hasHorizontalOverlap = (
  aX: number,
  aWidth: number,
  bX: number,
  bWidth: number,
): boolean => {
  const margin = 4;
  return aX + aWidth - margin > bX && bX + bWidth - margin > aX;
};

const hasActivePointerEvent = (event: MouseEvent | TouchEvent | null): boolean => {
  if (!event) return false;
  const eventType = typeof (event as { type?: unknown }).type === "string"
    ? (event as { type: string }).type
    : "";
  if (event instanceof MouseEvent) {
    return event.buttons > 0
      || eventType.startsWith("mouse")
      || eventType.startsWith("pointer")
      || eventType === "click"
      || eventType === "dblclick";
  }
  const maybeEvent = event as {
    buttons?: unknown;
    touches?: { length: number } | null;
    pointerType?: unknown;
    type?: unknown;
  };
  if (maybeEvent.touches && typeof maybeEvent.touches.length === "number") {
    return maybeEvent.touches.length > 0 || eventType.startsWith("touch");
  }
  if (typeof maybeEvent.pointerType === "string") {
    return true;
  }
  return eventType.startsWith("touch") || eventType.startsWith("pointer");
};

const isWheelEvent = (event: MouseEvent | TouchEvent | null): boolean => {
  if (!event) return false;
  const maybeEvent = event as { type?: unknown };
  return typeof maybeEvent.type === "string" && maybeEvent.type === "wheel";
};

interface LayoutElements {
  nodes: Node[];
  edges: Edge[];
}

const hasViewportDelta = (a: PanelViewport, b: PanelViewport): boolean =>
  Math.abs(a.x - b.x) > VIEWPORT_EPSILON
  || Math.abs(a.y - b.y) > VIEWPORT_EPSILON
  || Math.abs(a.zoom - b.zoom) > VIEWPORT_ZOOM_EPSILON;

const resolveSiblingBlockOverlaps = (layoutResult: LayoutElements): LayoutElements => {
  if (layoutResult.nodes.length < 2) return layoutResult;

  const nodes = layoutResult.nodes.map((node) => ({
    ...node,
    position: { ...node.position },
  }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map<string, Node[]>();
  const rootParentKey = "__root__";

  for (const node of nodes) {
    const parentKey = node.parentId ?? rootParentKey;
    const siblings = childrenByParent.get(parentKey) ?? [];
    siblings.push(node);
    childrenByParent.set(parentKey, siblings);
  }

  if (childrenByParent.size === 0) {
    return { nodes, edges: layoutResult.edges };
  }

  const depthByNodeId = new Map<string, number>();
  const getDepth = (nodeId: string): number => {
    const cached = depthByNodeId.get(nodeId);
    if (cached !== undefined) return cached;
    const node = nodeById.get(nodeId);
    if (!node?.parentId) {
      depthByNodeId.set(nodeId, 0);
      return 0;
    }
    const depth = getDepth(node.parentId) + 1;
    depthByNodeId.set(nodeId, depth);
    return depth;
  };

  const parentKeys = [...childrenByParent.keys()].sort((a, b) => {
    if (a === rootParentKey) return -1;
    if (b === rootParentKey) return 1;
    const depthA = getDepth(a);
    const depthB = getDepth(b);
    if (depthA !== depthB) return depthA - depthB;
    return a.localeCompare(b);
  });

  for (const parentKey of parentKeys) {
    const siblings = childrenByParent.get(parentKey);
    if (!siblings || siblings.length < 2) continue;

    const ordered = siblings.slice().sort((a, b) => {
      const aAbs = computeNodeAbsolutePosition(a, nodeById);
      const bAbs = computeNodeAbsolutePosition(b, nodeById);
      const yDelta = aAbs.y - bAbs.y;
      if (Math.abs(yDelta) > 0.5) return yDelta;
      return aAbs.x - bAbs.x;
    });

    const placed: Array<{ x: number; y: number; width: number; height: number }> = [];
    for (const node of ordered) {
      const abs = computeNodeAbsolutePosition(node, nodeById);
      const size = nodeSize(node);
      let nextAbsY = abs.y;
      for (const prev of placed) {
        if (!hasHorizontalOverlap(abs.x, size.width, prev.x, prev.width)) continue;
        const minY = prev.y + prev.height + GROUP_BLOCK_GAP;
        if (nextAbsY < minY) {
          nextAbsY = minY;
        }
      }

      if (nextAbsY > abs.y + 0.5) {
        if (node.parentId) {
          const parent = nodeById.get(node.parentId);
          if (parent) {
            const parentAbs = computeNodeAbsolutePosition(parent, nodeById);
            node.position.y = nextAbsY - parentAbs.y;
          }
        } else {
          node.position.y = nextAbsY;
        }
      }

      placed.push({
        x: abs.x,
        y: nextAbsY,
        width: size.width,
        height: size.height,
      });
    }
  }

  return { nodes, edges: layoutResult.edges };
};

export const SplitGraphPanel = observer(({
  title,
  side,
  graph,
  counterpartGraph,
  viewType,
  showCalls = true,
  diffStats,
  fileContentMap,
  counterpartFileContentMap,
  alignmentOffset,
  alignmentAnchors,
  alignmentBreakpoints,
  pullRequestDescriptionExcerpt,
  isViewportPrimary = true,
}: SplitGraphPanelProps) => {
  const { state: runtimeState, actions: runtimeActions } = useSplitGraphRuntime();
  const {
    viewport,
    selectedNodeId,
    highlightedNodeId,
    focusNodeId,
    focusNodeTick,
    focusSourceSide,
    graphSearchSide,
    graphSearchQuery,
    graphSearchTick,
    graphSearchNavSide,
    graphSearchNavDirection,
    graphSearchNavTick,
    focusFilePath,
    focusFileTick,
    hoveredNodeId,
    hoveredNodeMatchKey,
    hoveredNodeSide,
  } = runtimeState;
  const {
    onInteractionClick,
    onGraphNodeFocus,
    onNodeSelect,
    onNodeHoverChange,
    onViewportChange,
    onDiffTargetsChange,
    onTopLevelAnchorsChange,
    onNodeAnchorsChange,
    onLayoutPendingChange,
    onSearchStateChange,
  } = runtimeActions;
  const store = useLocalObservable(() => new SplitGraphPanelStore());
  const searchHighlightTimerRef = useRef<number | null>(null);
  const edgeClickHighlightTimerRef = useRef<number | null>(null);
  const flowContainerRef = useRef<HTMLDivElement>(null);
  const fileLinesCacheRef = useRef<Map<string, string[]>>(new Map());
  const counterpartFileLinesCacheRef = useRef<Map<string, string[]>>(new Map());
  const lastEdgeNavigationRef = useRef<{ edgeId: string; lastEndpoint: "source" | "target" } | null>(null);
  const lastAppliedFocusNodeKeyRef = useRef("");
  const lastAppliedFocusFileTickRef = useRef(0);
  const lastAppliedSearchTickRef = useRef(0);
  const lastViewportRecoveryKeyRef = useRef("");
  const lastNodeAnchorSignatureRef = useRef("");
  const viewportOverrideBaseRef = useRef<PanelViewport | null>(null);
  const [viewportOverride, setViewportOverride] = useState<PanelViewport | null>(null);
  const layoutResult = store.layoutResult;
  const effectiveViewport = viewportOverride ?? viewport;

  const isLogic = viewType === "logic";
  const isOld = side === "old";
  const oppositeSide: "old" | "new" = isOld ? "new" : "old";
  const fileEntries = useMemo(() => Array.from(fileContentMap.entries()), [fileContentMap]);

  useEffect(() => {
    fileLinesCacheRef.current.clear();
  }, [fileContentMap]);
  useEffect(() => {
    counterpartFileLinesCacheRef.current.clear();
  }, [counterpartFileContentMap]);

  const computeLayoutSync = useCallback(
    () => computeLayoutByView(viewType, graph, "", fileContentMap, showCalls),
    [viewType, graph, fileContentMap, showCalls],
  );

  const topLevelAnchorKeyByNodeId = useMemo(
    () => buildTopLevelAnchorKeyByNodeId(graph.nodes),
    [graph.nodes],
  );

  const graphNodeById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  );
  const counterpartNodes = counterpartGraph?.nodes ?? [];
  const counterpartNodeById = useMemo(
    () => new Map(counterpartNodes.map((node) => [node.id, node])),
    [counterpartNodes],
  );
  const indexedMatchKeyByNodeId = useMemo(
    () => buildIndexedMatchKeyByNodeId(graph.nodes),
    [graph.nodes],
  );
  const counterpartNodeIdByIndexedMatchKey = useMemo(() => {
    const indexedById = buildIndexedMatchKeyByNodeId(counterpartNodes);
    const map = new Map<string, string>();
    for (const [nodeId, indexedKey] of indexedById.entries()) {
      map.set(indexedKey, nodeId);
    }
    return map;
  }, [counterpartNodes]);

  const nodeCodeLinesFromMap = useCallback((
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
  }, []);

  const nodeSnippetFromMap = useCallback((
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
  }, []);

  const buildMiniUnifiedDiff = useCallback((
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
      return [`@@ -${oldSnippet?.startLine ?? 1},${oldLines.length} +${newSnippet?.startLine ?? 1},${newLines.length} @@`, " (unchanged snippet)"];
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
      return [`@@ -${oldSnippet?.startLine ?? 1},${oldLines.length} +${newSnippet?.startLine ?? 1},${newLines.length} @@`];
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
  }, []);

  const nodePromptBlock = useCallback((
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
  }, [nodeCodeLinesFromMap]);

  const copyTextToClipboard = useCallback(async (text: string): Promise<boolean> => {
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
  }, []);

  const buildAskLlmPrompt = useCallback((nodeId: string): string => {
    const node = graphNodeById.get(nodeId);
    if (!node) {
      return `${ASK_LLM_MESSAGE}\n\nNode context is unavailable.`;
    }
    const appendNodeWithVersions = (lines: string[], currentNode: ViewGraphNode): void => {
      lines.push(`${side.toUpperCase()} code:`);
      lines.push(
        ...nodePromptBlock(
          currentNode,
          fileContentMap,
          fileLinesCacheRef.current,
        ),
      );
      const indexedKey = indexedMatchKeyByNodeId.get(currentNode.id);
      const counterpartNodeId = indexedKey ? counterpartNodeIdByIndexedMatchKey.get(indexedKey) : undefined;
      const counterpartNode = counterpartNodeId ? counterpartNodeById.get(counterpartNodeId) : undefined;
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

    const edges = graph.edges.filter((edge) => edge.source === nodeId || edge.target === nodeId);
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
    if (pullRequestDescriptionExcerpt && pullRequestDescriptionExcerpt.trim().length > 0) {
      promptLines.push("", "PR description (excerpt):", pullRequestDescriptionExcerpt.trim());
    }
    promptLines.push("", `Graph side: ${side}`, "", "Primary node:");
    appendNodeWithVersions(promptLines, node);
    promptLines.push("");
    promptLines.push(`Connected nodes (${selectedConnectedIds.length}${omittedCount > 0 ? ` of ${connectedIds.length}` : ""}):`);

    if (selectedConnectedIds.length === 0) {
      promptLines.push("  (none)");
    } else {
      for (const [idx, relatedId] of selectedConnectedIds.entries()) {
        const relatedNode = graphNodeById.get(relatedId);
        if (!relatedNode) continue;
        const edgesSummary = connectionByNodeId.get(relatedId)?.join("; ") ?? "related";
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
  }, [
    counterpartFileContentMap,
    counterpartNodeById,
    counterpartNodeIdByIndexedMatchKey,
    fileContentMap,
    graph.edges,
    graphNodeById,
    indexedMatchKeyByNodeId,
    nodePromptBlock,
    oppositeSide,
    pullRequestDescriptionExcerpt,
    side,
  ]);

  const buildAskLlmUrlPrompt = useCallback((nodeId: string): string => {
    const node = graphNodeById.get(nodeId);
    if (!node) {
      return "Task: explain reason, consequences, improvements.\n(no node context)";
    }

    const resolveCounterpart = (currentNode: ViewGraphNode): ViewGraphNode | undefined => {
      const indexedKey = indexedMatchKeyByNodeId.get(currentNode.id);
      const counterpartNodeId = indexedKey ? counterpartNodeIdByIndexedMatchKey.get(indexedKey) : undefined;
      return counterpartNodeId ? counterpartNodeById.get(counterpartNodeId) : undefined;
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

    const lines: string[] = ["Task: explain reason, consequences, improvements."];
    if (pullRequestDescriptionExcerpt && pullRequestDescriptionExcerpt.trim().length > 0) {
      lines.push(`pr:${oneLine(pullRequestDescriptionExcerpt)}`);
    }
    lines.push(`p|st:${shortStatus(node.diffStatus)}|k:${node.kind}|sym:${oneLine(node.label)}|f:${shortPathForPrompt(node.filePath)}`);
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
      const base = relatedById.get(relatedId) ?? { score: 0, rels: new Set<string>() };
      base.rels.add(relToken);
      base.score = Math.max(
        base.score,
        (relatedNode.diffStatus !== "unchanged" ? 4 : 0)
        + (edge.relation === "invoke" ? 2 : 0)
        + (edge.relation === "flow" ? 1 : 0),
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
      .filter((entry): entry is { relatedId: string; node: ViewGraphNode; score: number; rels: string } => entry.node !== undefined)
      .sort((a, b) => b.score - a.score || oneLine(a.node.label).localeCompare(oneLine(b.node.label)));

    const selectedRelated = relatedEntries.slice(0, ASK_LLM_URL_MAX_CONNECTED_NODES);
    lines.push(`ctx:${selectedRelated.length}`);
    for (const [idx, related] of selectedRelated.entries()) {
      const counterpart = resolveCounterpart(related.node);
      const counterpartToken = counterpart ? `|p2:${oneLine(counterpart.label)}` : "";
      lines.push(
        `${idx + 1}|st:${shortStatus(related.node.diffStatus)}|rel:${related.rels}|sym:${oneLine(related.node.label)}|f:${shortPathForPrompt(related.node.filePath)}${counterpartToken}`,
      );
    }
    const omitted = relatedEntries.length - selectedRelated.length;
    if (omitted > 0) {
      lines.push(`...+${omitted} more`);
    }

    return lines.join("\n");
  }, [
    buildMiniUnifiedDiff,
    counterpartFileContentMap,
    counterpartNodeById,
    counterpartNodeIdByIndexedMatchKey,
    fileContentMap,
    graph.edges,
    graphNodeById,
    indexedMatchKeyByNodeId,
    nodeSnippetFromMap,
    pullRequestDescriptionExcerpt,
    side,
  ]);

  const handleAskLlmForNode = useCallback(async (nodeId: string): Promise<boolean> => {
    const prompt = buildAskLlmPrompt(nodeId);
    return copyTextToClipboard(prompt);
  }, [buildAskLlmPrompt, copyTextToClipboard]);
  const handleAskLlmHrefForNode = useCallback((nodeId: string): string => {
    const prompt = buildAskLlmUrlPrompt(nodeId);
    return buildCappedChatGptUrl(prompt);
  }, [buildAskLlmUrlPrompt]);

  const topKeyByNodeId = useMemo(() => {
    const resolved = new Map<string, string>();
    const resolving = new Set<string>();
    const resolveFor = (nodeId: string): string | undefined => {
      const cached = resolved.get(nodeId);
      if (cached) return cached;
      if (resolving.has(nodeId)) return undefined;
      resolving.add(nodeId);
      try {
        const node = graphNodeById.get(nodeId);
        if (!node) return undefined;
        if (node.kind === "group" && !node.parentId) {
          const topKey = topLevelAnchorKeyByNodeId.get(node.id) ?? stableNodeKey(node);
          resolved.set(nodeId, topKey);
          return topKey;
        }
        if (!node.parentId) return undefined;
        const parentTopKey = resolveFor(node.parentId);
        if (parentTopKey) {
          resolved.set(nodeId, parentTopKey);
        }
        return parentTopKey;
      } finally {
        resolving.delete(nodeId);
      }
    };

    for (const node of graph.nodes) {
      resolveFor(node.id);
    }
    return resolved;
  }, [graph.nodes, graphNodeById, topLevelAnchorKeyByNodeId]);

  const topAlignedLayoutResult = useMemo(() => {
    if (!alignmentOffset && !alignmentAnchors) return layoutResult;
    const hasAlignmentAnchors = Boolean(alignmentAnchors && Object.keys(alignmentAnchors).length > 0);
    const nodes = layoutResult.nodes.map((node) => ({
      ...node,
      position: {
        x: (() => {
          if (node.parentId) return node.position.x;
          const graphNode = graphNodeById.get(node.id);
          if (graphNode && graphNode.kind === "group" && alignmentAnchors) {
            const anchorKey = topLevelAnchorKeyByNodeId.get(graphNode.id) ?? stableNodeKey(graphNode);
            const anchored = alignmentAnchors[anchorKey];
            if (anchored) return anchored.x;
          }
          if (hasAlignmentAnchors) return node.position.x;
          return alignmentOffset ? node.position.x + alignmentOffset.x : node.position.x;
        })(),
        y: (() => {
          if (node.parentId) return node.position.y;
          const graphNode = graphNodeById.get(node.id);
          if (graphNode && graphNode.kind === "group" && alignmentAnchors) {
            const anchorKey = topLevelAnchorKeyByNodeId.get(graphNode.id) ?? stableNodeKey(graphNode);
            const anchored = alignmentAnchors[anchorKey];
            if (anchored) return anchored.y;
          }
          if (hasAlignmentAnchors) return node.position.y;
          return alignmentOffset ? node.position.y + alignmentOffset.y : node.position.y;
        })(),
      },
    }));
    return { nodes, edges: layoutResult.edges };
  }, [alignmentAnchors, alignmentOffset, graphNodeById, layoutResult, topLevelAnchorKeyByNodeId]);

  const internalNodeAnchors = useMemo(() => {
    if (!isLogic) return {} as Record<string, InternalNodeAnchor>;
    const nodeById = new Map(topAlignedLayoutResult.nodes.map((node) => [node.id, node]));
    const structuralEntries: Array<{ baseKey: string; topKey: string; y: number; x: number }> = [];
    const idAnchors: Record<string, InternalNodeAnchor> = {};
    for (const node of topAlignedLayoutResult.nodes) {
      if (!node.parentId) continue;
      const graphNode = graphNodeById.get(node.id);
      if (!graphNode || graphNode.kind === "group") continue;
      const topKey = topKeyByNodeId.get(node.id);
      if (!topKey) continue;
      const abs = computeNodeAbsolutePosition(node, nodeById);
      idAnchors[`id:${topKey}:${node.id}`] = { topKey, y: abs.y };
      structuralEntries.push({
        baseKey: structuralAnchorKey(
          topKey,
          graphNode.kind,
          graphNode.filePath,
          graphNode.className,
          graphNode.label,
          graphNode.branchType,
        ),
        topKey,
        y: abs.y,
        x: abs.x,
      });
    }

    structuralEntries.sort((a, b) => (a.y - b.y) || (a.x - b.x) || a.baseKey.localeCompare(b.baseKey));
    const countByKey = new Map<string, number>();
    const structuralAnchors: Record<string, InternalNodeAnchor> = {};
    for (const entry of structuralEntries) {
      const nextIdx = (countByKey.get(entry.baseKey) ?? 0) + 1;
      countByKey.set(entry.baseKey, nextIdx);
      structuralAnchors[`struct:${entry.baseKey}#${nextIdx}`] = { topKey: entry.topKey, y: entry.y };
    }
    return { ...structuralAnchors, ...idAnchors };
  }, [graphNodeById, isLogic, topAlignedLayoutResult.nodes, topKeyByNodeId]);

  const positionedLayoutResult = useMemo(() => {
    const hasInternalAlignmentData = Boolean(
      isLogic
      && side === "new"
      && alignmentBreakpoints
      && Object.keys(alignmentBreakpoints).length > 0
      && topAlignedLayoutResult.nodes.length > 0,
    );
    // Internal breakpoint-based descendant shifting can push nodes out of parent
    // scope blocks on dense graphs. Keep top-level old/new alignment, but keep
    // descendants in their original local layout.
    if (!hasInternalAlignmentData) {
      return resolveSiblingBlockOverlaps(topAlignedLayoutResult);
    }
    return resolveSiblingBlockOverlaps(topAlignedLayoutResult);
  }, [alignmentBreakpoints, isLogic, side, topAlignedLayoutResult, topKeyByNodeId]);

  const positionedNodeById = useMemo(
    () => new Map(positionedLayoutResult.nodes.map((node) => [node.id, node])),
    [positionedLayoutResult.nodes],
  );

  const splitGraphDerivedInput = useMemo(
    () => ({
      graphNodes: graph.nodes,
      positionedNodeIds: positionedLayoutResult.nodes.map((node) => node.id),
      positionedEdges: positionedLayoutResult.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
      })),
      searchQuery: store.searchQuery,
      searchExclude: store.searchExclude,
    }),
    [graph.nodes, positionedLayoutResult.edges, positionedLayoutResult.nodes, store.searchExclude, store.searchQuery],
  );

  const splitGraphDerived = useSplitGraphDerivedWorker(splitGraphDerivedInput);

  const nodeMatchKeyById = useMemo(
    () => new Map(splitGraphDerived.nodeMatchKeyByIdEntries),
    [splitGraphDerived.nodeMatchKeyByIdEntries],
  );

  const nodeIdsByMatchKey = useMemo(
    () => new Map(splitGraphDerived.nodeIdsByMatchKeyEntries),
    [splitGraphDerived.nodeIdsByMatchKeyEntries],
  );

  const hoveredNodeIdForPanel = useMemo(() => {
    if (!hoveredNodeId && !hoveredNodeMatchKey) return "";

    let candidateId = "";
    if (hoveredNodeId && positionedNodeById.has(hoveredNodeId)) {
      candidateId = hoveredNodeId;
    } else if (hoveredNodeMatchKey) {
      const candidates = nodeIdsByMatchKey.get(hoveredNodeMatchKey) ?? [];
      if (candidates.length > 0) {
        candidateId = candidates[0];
      }
    }
    if (!candidateId) return "";

    const graphNode = graphNodeById.get(candidateId);
    if (!graphNode) return "";
    return candidateId;
  }, [graphNodeById, hoveredNodeId, hoveredNodeMatchKey, nodeIdsByMatchKey, positionedNodeById]);

  const hoverNeighborhoodByNodeId = useMemo(() => {
    const map = new Map<string, { keepNodeIds: Set<string>; keepEdgeIds: Set<string> }>();
    for (const entry of splitGraphDerived.hoverNeighborhoodByNodeIdEntries) {
      map.set(entry.nodeId, {
        keepNodeIds: new Set(entry.keepNodeIds),
        keepEdgeIds: new Set(entry.keepEdgeIds),
      });
    }
    return map;
  }, [splitGraphDerived.hoverNeighborhoodByNodeIdEntries]);

  const hoverNeighborhoodSeedId = useMemo(() => {
    if (hoveredNodeIdForPanel) return hoveredNodeIdForPanel;
    const searchNodeId = store.searchHighlightedNodeId;
    if (searchNodeId && positionedNodeById.has(searchNodeId)) return searchNodeId;
    if (highlightedNodeId && positionedNodeById.has(highlightedNodeId)) return highlightedNodeId;
    return "";
  }, [highlightedNodeId, hoveredNodeIdForPanel, positionedNodeById, store.searchHighlightedNodeId]);

  const hoverNeighborhood = useMemo(() => {
    if (!hoverNeighborhoodSeedId) return null;
    return hoverNeighborhoodByNodeId.get(hoverNeighborhoodSeedId) ?? null;
  }, [hoverNeighborhoodByNodeId, hoverNeighborhoodSeedId]);

  const flowElements = useMemo(() => {
    const hasNodeHighlights = Boolean(selectedNodeId || highlightedNodeId || store.searchHighlightedNodeId);
    const hasHoverNeighborhood = hoverNeighborhood !== null;
    const hasEdgeEmphasis = store.hoveredEdgeId.length > 0 || store.clickedEdgeId.length > 0;
    if (!hasNodeHighlights && !hasEdgeEmphasis && !hasHoverNeighborhood) return positionedLayoutResult;

    const nodes = (hasNodeHighlights || hasHoverNeighborhood)
      ? positionedLayoutResult.nodes.map((node) => {
        const isSearchTarget = node.id === store.searchHighlightedNodeId;
        const isHoveredNode = node.id === hoveredNodeIdForPanel;
        const graphNode = graphNodeById.get(node.id);
        const isHoverRelated =
          Boolean(hasHoverNeighborhood && hoverNeighborhood?.keepNodeIds.has(node.id))
          && graphNode?.kind !== "group";
        const isPrimarySelected =
          node.id === selectedNodeId
          || node.id === highlightedNodeId
          || isSearchTarget;
        let nextNode = node;
        if (isPrimarySelected || isHoveredNode) {
          nextNode = (node.type === "scope" || node.type === "diamond" || node.type === "pill" || node.type === "process" || node.type === "knowledge")
            ? { ...node, data: { ...node.data, selected: true } }
            : {
              ...node,
              style: {
                ...(node.style ?? {}),
                border: "5px solid #f8fafc",
                boxShadow: "0 0 0 2px rgba(56, 189, 248, 0.95), 0 0 22px rgba(56, 189, 248, 0.85)",
              },
            };
        }
        if (isSearchTarget) {
          nextNode = { ...nextNode, style: { ...(nextNode.style ?? {}), ...SEARCH_FLASH_STYLE } };
        }
        if (isHoverRelated && !isPrimarySelected && !isHoveredNode) {
          nextNode = {
            ...nextNode,
            style: {
              ...(nextNode.style ?? {}),
              outline: "2px solid #c084fc",
              outlineOffset: "2px",
              boxShadow: "0 0 0 1px rgba(192,132,252,0.9), 0 0 14px rgba(192,132,252,0.55)",
            },
          };
        }
        if (isHoveredNode) {
          nextNode = {
            ...nextNode,
            style: {
              ...(nextNode.style ?? {}),
              outline: "3px solid #fbbf24",
              outlineOffset: "2px",
              boxShadow: "0 0 0 2px rgba(251,191,36,0.92), 0 0 22px rgba(251,191,36,0.5)",
            },
          };
        }
        return nextNode;
      })
      : positionedLayoutResult.nodes;

    const edges = (hasEdgeEmphasis || hasHoverNeighborhood)
      ? positionedLayoutResult.edges.map((edge) => {
        const isHovered = edge.id === store.hoveredEdgeId;
        const isClicked = edge.id === store.clickedEdgeId;
        const isPrimaryEdge = isHovered || isClicked;
        const isInHoverNeighborhood = Boolean(hasHoverNeighborhood && hoverNeighborhood?.keepEdgeIds.has(edge.id));
        if (!isPrimaryEdge && !isInHoverNeighborhood && !hasEdgeEmphasis) return edge;
        const baseStyle = edge.style ?? {};
        const baseLabelStyle = edge.labelStyle ?? {};
        const baseLabelBgStyle = edge.labelBgStyle ?? {};
        const baseStrokeWidth =
          typeof baseStyle.strokeWidth === "number"
            ? baseStyle.strokeWidth
            : Number(baseStyle.strokeWidth ?? 1.5);
        const nextStrokeWidth = isPrimaryEdge
          ? Math.max(baseStrokeWidth + 2.6, 4.2)
          : isInHoverNeighborhood
            ? Math.max(baseStrokeWidth + 1.8, 3.2)
            : baseStrokeWidth;
        const nextStrokeOpacity = isPrimaryEdge
          ? 1
          : isInHoverNeighborhood
            ? 1
            : 0.24;
        const nextLabelOpacity = isPrimaryEdge
          ? 1
          : isInHoverNeighborhood
            ? 1
            : 0.35;
        const nextStroke = isPrimaryEdge
          ? "#f8fafc"
          : isInHoverNeighborhood
            ? "#c084fc"
            : baseStyle.stroke;
        return {
          ...edge,
          style: {
            ...baseStyle,
            stroke: nextStroke,
            strokeWidth: nextStrokeWidth,
            strokeOpacity: nextStrokeOpacity,
            filter: isPrimaryEdge
              ? "drop-shadow(0 0 8px rgba(248,250,252,0.95))"
              : isInHoverNeighborhood
                ? "drop-shadow(0 0 7px rgba(192,132,252,0.9))"
                : baseStyle.filter,
          },
          labelStyle: {
            ...baseLabelStyle,
            fill: isPrimaryEdge ? "#ffffff" : isInHoverNeighborhood ? "#f3e8ff" : baseLabelStyle.fill,
            opacity: nextLabelOpacity,
          },
          labelBgStyle: {
            ...baseLabelBgStyle,
            fillOpacity: isPrimaryEdge ? 0.98 : isInHoverNeighborhood ? 0.68 : 0.5,
            stroke: isPrimaryEdge ? "#f8fafc" : isInHoverNeighborhood ? "#c084fc" : baseLabelBgStyle.stroke,
          },
        };
      })
      : positionedLayoutResult.edges;

    return { nodes, edges };
  }, [
    graphNodeById,
    hoveredNodeIdForPanel,
    hoverNeighborhood,
    highlightedNodeId,
    positionedLayoutResult,
    selectedNodeId,
    store.clickedEdgeId,
    store.hoveredEdgeId,
    store.searchHighlightedNodeId,
  ]);

  const flowElementsNodeById = useMemo(
    () => new Map(flowElements.nodes.map((node) => [node.id, node])),
    [flowElements.nodes],
  );

  const searchMatches = useMemo(() => {
    return splitGraphDerived.searchMatchIds
      .map((nodeId) => flowElementsNodeById.get(nodeId))
      .filter((node): node is Node => node !== undefined);
  }, [flowElementsNodeById, splitGraphDerived.searchMatchIds]);

  const searchResultNodes = useMemo(() => {
    if (!store.searchQuery || store.searchQuery.length < 2) return flowElements;
    if (store.searchExclude) {
      const keepIds = new Set(searchMatches.map((n) => n.id));
      const nodes = flowElements.nodes.filter((n) => keepIds.has(n.id));
      const nodeIds = new Set(nodes.map((n) => n.id));
      const edges = flowElements.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
      return { nodes, edges };
    }
    const matchIds = new Set(searchMatches.map((n) => n.id));
    const nodes = flowElements.nodes.map((node) => {
      if (node.id === store.searchHighlightedNodeId) {
        return { ...node, style: { ...(node.style ?? {}), ...SEARCH_FLASH_STYLE } };
      }
      if (!matchIds.has(node.id)) return { ...node, style: { ...(node.style ?? {}), opacity: 0.25 } };
      return { ...node, style: { ...(node.style ?? {}), outline: "2px solid #fbbf24", outlineOffset: "2px" } };
    });
    return { nodes, edges: flowElements.edges };
  }, [flowElements, searchMatches, store.searchQuery, store.searchExclude, store.searchHighlightedNodeId]);

  const graphCanvasNodes = useMemo(
    () => searchResultNodes.nodes.map((node) => ({
      ...node,
      data: {
        ...(node.data as Record<string, unknown>),
        askLlmNodeId: node.id,
        onAskLlmForNode: handleAskLlmForNode,
        onAskLlmHrefForNode: handleAskLlmHrefForNode,
      },
    })),
    [handleAskLlmForNode, handleAskLlmHrefForNode, searchResultNodes.nodes],
  );

  const flowNodeById = useMemo(() => new Map(flowElements.nodes.map((n) => [n.id, n])), [flowElements.nodes]);

  const nodeAbsolutePosition = useCallback((node: Node): { x: number; y: number } => {
    return computeNodeAbsolutePosition(node, flowNodeById);
  }, [flowNodeById]);

  const viewportForNode = useCallback((node: Node): { x: number; y: number; zoom: number } => {
    return computeViewportForNode(node, flowNodeById, store.flowSize);
  }, [flowNodeById, store.flowSize]);

  const minimapNodeColor = useCallback((node: Node): string => {
    const data = node.data as { bgColor?: unknown } | undefined;
    if (data && typeof data.bgColor === "string" && data.bgColor.length > 0) {
      return data.bgColor;
    }
    return "#94a3b8";
  }, []);

  const minimapNodeStrokeColor = useCallback((node: Node): string => {
    const data = node.data as { selected?: unknown } | undefined;
    return data?.selected ? "#f8fafc" : "#1e293b";
  }, []);

  const stats = useMemo(() => {
    if (diffStats) return diffStats;
    return {
      added: graph.nodes.filter((n) => n.diffStatus === "added").length,
      removed: graph.nodes.filter((n) => n.diffStatus === "removed").length,
      modified: graph.nodes.filter((n) => n.diffStatus === "modified").length,
    };
  }, [diffStats, graph.nodes]);

  const hoveredEdgeTooltip = useMemo(() => {
    if (!store.hoveredEdgeId) return null;
    const edge = flowElements.edges.find((candidate) => candidate.id === store.hoveredEdgeId);
    if (!edge) return null;

    const sourceGraphNode = graphNodeById.get(edge.source);
    const targetGraphNode = graphNodeById.get(edge.target);
    const sourceLabel = sourceGraphNode ? oneLine(sourceGraphNode.label) : edge.source;
    const targetLabel = targetGraphNode ? oneLine(targetGraphNode.label) : edge.target;
    const sourceKind = sourceGraphNode?.kind ? `[${sourceGraphNode.kind}] ` : "";
    const targetKind = targetGraphNode?.kind ? `[${targetGraphNode.kind}] ` : "";

    return {
      sourceText: `${sourceKind}${sourceLabel}`,
      targetText: `${targetKind}${targetLabel}`,
    };
  }, [flowElements.edges, graphNodeById, store.hoveredEdgeId]);

  const edgeTooltipStyle = useMemo(
    () => ({
      position: "fixed" as const,
      left: `${store.hoveredEdgePointerX + EDGE_TOOLTIP_OFFSET_X}px`,
      top: `${store.hoveredEdgePointerY + EDGE_TOOLTIP_OFFSET_Y}px`,
      zIndex: 1200,
      pointerEvents: "none" as const,
      background: "#0f172a",
      border: "1px solid #334155",
      borderRadius: 8,
      padding: "8px 10px",
      maxWidth: "min(560px, calc(100vw - 24px))",
      boxShadow: "0 8px 22px rgba(2, 6, 23, 0.75)",
      color: "#e2e8f0",
      fontSize: 11,
      lineHeight: 1.35,
      fontFamily: "JetBrains Mono, Fira Code, Consolas, monospace",
      whiteSpace: "pre-wrap" as const,
    }),
    [store.hoveredEdgePointerX, store.hoveredEdgePointerY],
  );

  const nodeTypesForFlow = isLogic ? logicNodeTypes : knowledgeNodeTypes;
  const hasInputNodes = graph.nodes.length > 0;
  const hasRenderedNodes = positionedLayoutResult.nodes.length > 0;
  const showLayoutStatus = hasInputNodes && store.layoutPending;
  const layoutStatusLabel = hasRenderedNodes ? "Updating graph layout..." : "Building graph layout...";

  useEffect(() => {
    if (!onLayoutPendingChange) return;
    onLayoutPendingChange(side, store.layoutPending);
  }, [onLayoutPendingChange, side, store.layoutPending]);

  useEffect(() => {
    if (!onLayoutPendingChange) return;
    return () => {
      onLayoutPendingChange(side, false);
    };
  }, [onLayoutPendingChange, side]);

  const focusedViewport = useMemo(() => {
    if (!focusFilePath) return null;
    const normalizedFilePath = normPath(focusFilePath);
    const pts: Array<{ x: number; y: number }> = [];
    for (const n of flowElements.nodes) {
      const gn = graph.nodes.find((g) => g.id === n.id);
      if (gn && normPath(gn.filePath) === normalizedFilePath) pts.push(nodeAbsolutePosition(n));
    }
    if (pts.length === 0) return null;
    const ax = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;
    const ay = pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
    return { x: -ax + 200, y: -ay + 150, zoom: 0.9 };
  }, [focusFilePath, flowElements.nodes, graph.nodes, nodeAbsolutePosition]);

  const flashSearchTarget = useCallback((nodeId: string) => {
    store.setSearchHighlightedNodeId(nodeId);
    if (searchHighlightTimerRef.current !== null) {
      window.clearTimeout(searchHighlightTimerRef.current);
    }
    searchHighlightTimerRef.current = window.setTimeout(() => {
      store.clearSearchHighlight();
      searchHighlightTimerRef.current = null;
    }, SEARCH_FLASH_MS);
  }, [store]);

  const handleSearch = useCallback((query: string, exclude: boolean) => {
    store.setSearch(query, exclude);
  }, [store]);

  const handleSearchNext = useCallback(() => {
    onInteractionClick?.();
    if (searchMatches.length === 0) return;
    const next = (store.searchIdx + 1) % searchMatches.length;
    store.setSearchIdx(next);
    const target = searchMatches[next];
    if (target) {
      flashSearchTarget(target.id);
      onViewportChange(viewportForNode(target));
    }
  }, [searchMatches, store, flashSearchTarget, onInteractionClick, onViewportChange, viewportForNode]);

  const handleSearchPrev = useCallback(() => {
    onInteractionClick?.();
    if (searchMatches.length === 0) return;
    const prev = (store.searchIdx - 1 + searchMatches.length) % searchMatches.length;
    store.setSearchIdx(prev);
    const target = searchMatches[prev];
    if (target) {
      flashSearchTarget(target.id);
      onViewportChange(viewportForNode(target));
    }
  }, [searchMatches, store, flashSearchTarget, onInteractionClick, onViewportChange, viewportForNode]);

  const handleNodeClick = useCallback<NodeMouseHandler>((_event, node) => {
    onNodeSelect(node.id, side);
  }, [onNodeSelect, side]);

  const handleNodeMouseEnter = useCallback<NodeMouseHandler>((_event, node) => {
    const graphNode = graphNodeById.get(node.id);
    if (!graphNode) return;
    if (graphNode.kind === "group" && !isGroupHeaderTarget(_event)) return;
    onNodeHoverChange(side, node.id, nodeMatchKeyById.get(node.id) ?? "");
  }, [graphNodeById, nodeMatchKeyById, onNodeHoverChange, side]);

  const handleNodeMouseMove = useCallback<NodeMouseHandler>((event, node) => {
    const graphNode = graphNodeById.get(node.id);
    if (!graphNode || graphNode.kind !== "group") return;
    const matchKey = nodeMatchKeyById.get(node.id) ?? "";
    const onHeader = isGroupHeaderTarget(event);
    if (onHeader) {
      if (hoveredNodeId === node.id && hoveredNodeMatchKey === matchKey) return;
      onNodeHoverChange(side, node.id, matchKey);
      return;
    }
    if (hoveredNodeId === node.id) {
      onNodeHoverChange(side, "", "");
    }
  }, [graphNodeById, hoveredNodeId, hoveredNodeMatchKey, nodeMatchKeyById, onNodeHoverChange, side]);

  const handleNodeMouseLeave = useCallback<NodeMouseHandler>((event) => {
    const related = (event as { relatedTarget?: EventTarget | null }).relatedTarget ?? null;
    if (related instanceof Element && related.closest(".react-flow__node")) {
      return;
    }
    onNodeHoverChange(side, "", "");
  }, [onNodeHoverChange, side]);

  const handleEdgeMouseEnter = useCallback<EdgeMouseHandler>((_event, edge) => {
    store.setHoveredEdge(edge.id, _event.clientX, _event.clientY);
  }, [store]);

  const handleEdgeMouseMove = useCallback<EdgeMouseHandler>((event, edge) => {
    if (store.hoveredEdgeId !== edge.id) {
      store.setHoveredEdge(edge.id, event.clientX, event.clientY);
      return;
    }
    store.setHoveredEdgePointer(event.clientX, event.clientY);
  }, [store]);

  const handleEdgeMouseLeave = useCallback<EdgeMouseHandler>(() => {
    store.clearHoveredEdge();
  }, [store]);

  const handleEdgeClick = useCallback<EdgeMouseHandler>((_event, edge) => {
    const navigateToTarget = lastEdgeNavigationRef.current?.edgeId === edge.id
      && lastEdgeNavigationRef.current?.lastEndpoint === "source";
    const endpoint: "source" | "target" = navigateToTarget ? "target" : "source";
    const nodeId = endpoint === "source" ? edge.source : edge.target;
    if (!nodeId || !graphNodeById.has(nodeId)) return;
    store.setClickedEdgeId(edge.id);
    if (edgeClickHighlightTimerRef.current !== null) {
      window.clearTimeout(edgeClickHighlightTimerRef.current);
    }
    edgeClickHighlightTimerRef.current = window.setTimeout(() => {
      store.clearClickedEdge();
      edgeClickHighlightTimerRef.current = null;
    }, EDGE_CLICK_HIGHLIGHT_MS);
    if (onGraphNodeFocus) {
      onGraphNodeFocus(nodeId, side);
    } else {
      onNodeSelect(nodeId, side);
    }
    lastEdgeNavigationRef.current = { edgeId: edge.id, lastEndpoint: endpoint };
  }, [graphNodeById, onGraphNodeFocus, onNodeSelect, side, store]);

  const handlePaneMouseLeave = useCallback(() => {
    store.clearHoveredEdge();
    onNodeHoverChange(side, "", "");
  }, [onNodeHoverChange, side, store]);

  const handleMoveStart = useCallback((event: MouseEvent | TouchEvent | null) => {
    if (!hasActivePointerEvent(event)) return;
    if (viewportOverrideBaseRef.current !== null) {
      viewportOverrideBaseRef.current = null;
      setViewportOverride(null);
    }
  }, []);

  const handleMove = useCallback((event: MouseEvent | TouchEvent | null, nextViewport: Viewport) => {
    const nextViewportState = { x: nextViewport.x, y: nextViewport.y, zoom: nextViewport.zoom };
    const wheel = isWheelEvent(event);
    const pointerDriven = hasActivePointerEvent(event);
    const nullEventDriven = event === null && hasViewportDelta(nextViewportState, viewport);
    if (!wheel && !pointerDriven && !nullEventDriven) return;
    if (viewportOverrideBaseRef.current !== null) {
      viewportOverrideBaseRef.current = null;
      setViewportOverride(null);
    }
    onViewportChange(nextViewportState);
  }, [onViewportChange, viewport]);

  const handleMoveEnd = useCallback(() => {}, []);

  useSplitGraphLayoutWorker({
    store,
    graph,
    viewType,
    showCalls,
    fileEntries,
    computeLayoutSync,
  });

  useFlowContainerSize(flowContainerRef, store);

  useEffect(() => {
    if (!onDiffTargetsChange) return;
    const targets: GraphDiffTarget[] = flowElements.nodes
      .map((node) => {
        const gn = graphNodeById.get(node.id);
        if (!gn || gn.diffStatus === "unchanged") return null;
        const abs = nodeAbsolutePosition(node);
        const vp = viewportForNode(node);
        return {
          id: node.id,
          side,
          x: abs.x,
          y: abs.y,
          viewportX: vp.x,
          viewportY: vp.y,
          viewportZoom: vp.zoom,
          diffStatus: gn.diffStatus,
          kind: gn.kind,
        } as GraphDiffTarget;
      })
      .filter((entry): entry is GraphDiffTarget => entry !== null);
    onDiffTargetsChange(side, targets);
  }, [flowElements.nodes, graphNodeById, nodeAbsolutePosition, onDiffTargetsChange, side, viewportForNode]);

  useEffect(() => {
    if (!onTopLevelAnchorsChange) return;
    const anchors: Record<string, TopLevelAnchor> = {};
    for (const node of store.layoutResult.nodes) {
      if (node.parentId) continue;
      const gn = graphNodeById.get(node.id);
      if (!gn || gn.kind !== "group") continue;
      const width = typeof node.style?.width === "number" ? node.style.width : LEAF_W;
      const height = typeof node.style?.height === "number" ? node.style.height : LEAF_H;
      const anchorKey = topLevelAnchorKeyByNodeId.get(gn.id) ?? stableNodeKey(gn);
      anchors[anchorKey] = { x: node.position.x, y: node.position.y, width, height };
    }
    onTopLevelAnchorsChange(side, anchors);
  }, [graphNodeById, store.layoutResult.nodes, onTopLevelAnchorsChange, side, topLevelAnchorKeyByNodeId]);

  useEffect(() => {
    if (!onNodeAnchorsChange) return;
    const signature = Object.entries(internalNodeAnchors)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, anchor]) => `${key}:${anchor.topKey}:${Math.round(anchor.y * 10)}`)
      .join("|");
    if (signature === lastNodeAnchorSignatureRef.current) return;
    lastNodeAnchorSignatureRef.current = signature;
    onNodeAnchorsChange(side, internalNodeAnchors);
  }, [internalNodeAnchors, onNodeAnchorsChange, side]);

  useEffect(() => {
    if (graphSearchTick <= 0) return;
    if (graphSearchTick === lastAppliedSearchTickRef.current) return;
    lastAppliedSearchTickRef.current = graphSearchTick;
    if (graphSearchSide !== side) return;
    const query = graphSearchQuery.trim();
    if (!query) return;
    store.setLastAutoFocusSearchKey("");
    store.setSearch(query, false);
  }, [graphSearchQuery, graphSearchSide, graphSearchTick, side, store]);

  useEffect(() => {
    store.setSearch("", false);
    store.setLastAutoFocusSearchKey("");
    store.clearSearchHighlight();
  }, [focusFilePath, store]);

  useEffect(() => {
    onSearchStateChange?.(side, store.searchQuery.trim().length > 0 && !store.searchExclude);
  }, [onSearchStateChange, side, store.searchExclude, store.searchQuery]);

  useEffect(() => () => {
    onSearchStateChange?.(side, false);
  }, [onSearchStateChange, side]);

  useEffect(() => {
    if (graphSearchNavTick <= 0) return;
    if (graphSearchNavSide !== side) return;
    if (store.searchQuery.trim().length < 1 || store.searchExclude) return;
    if (searchMatches.length === 0) return;
    if (graphSearchNavDirection === "next") {
      handleSearchNext();
      return;
    }
    handleSearchPrev();
  }, [
    graphSearchNavDirection,
    graphSearchNavSide,
    graphSearchNavTick,
    handleSearchNext,
    handleSearchPrev,
    searchMatches.length,
    side,
    store.searchExclude,
    store.searchQuery,
  ]);

  useEffect(() => {
    if (!store.searchQuery || store.searchQuery.length < 2 || searchMatches.length === 0) return;
    const searchKey = `${store.searchExclude ? "exclude" : "include"}:${store.searchQuery.toLowerCase()}`;
    if (store.lastAutoFocusSearchKey === searchKey) return;
    store.setLastAutoFocusSearchKey(searchKey);
    store.setSearchIdx(0);
    const first = searchMatches[0];
    flashSearchTarget(first.id);
    onViewportChange(viewportForNode(first));
  }, [store, searchMatches, onViewportChange, flashSearchTarget, viewportForNode]);

  useEffect(() => () => {
    if (searchHighlightTimerRef.current !== null) {
      window.clearTimeout(searchHighlightTimerRef.current);
    }
    if (edgeClickHighlightTimerRef.current !== null) {
      window.clearTimeout(edgeClickHighlightTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!focusFilePath || !focusedViewport || focusFileTick <= 0) return;
    if (focusFileTick === lastAppliedFocusFileTickRef.current) return;
    lastAppliedFocusFileTickRef.current = focusFileTick;
    onViewportChange(focusedViewport);
  }, [focusFilePath, focusFileTick, focusedViewport, onViewportChange]);

  useEffect(() => {
    if (!viewportOverride || !viewportOverrideBaseRef.current) return;
    if (!hasViewportDelta(viewport, viewportOverrideBaseRef.current)) return;
    viewportOverrideBaseRef.current = null;
    setViewportOverride(null);
  }, [viewport, viewportOverride]);

  const isNodeVisibleInViewport = useCallback((node: Node): boolean => {
    return computeIsNodeVisibleInViewport(node, flowNodeById, store.flowSize, effectiveViewport);
  }, [effectiveViewport, flowNodeById, store.flowSize]);

  useEffect(() => {
    if (!hoveredNodeSide || hoveredNodeSide === side) return;
    if (!hoveredNodeIdForPanel) return;
    if (store.layoutPending) return;
    if (store.flowSize.width <= 0 || store.flowSize.height <= 0) return;

    const target = flowElements.nodes.find((node) => node.id === hoveredNodeIdForPanel);
    if (!target) return;

    const isVisible = computeIsNodeVisibleInViewport(target, flowNodeById, store.flowSize, effectiveViewport);
    if (isVisible) return;

    const nextViewport = viewportForNode(target);
    if (!hasViewportDelta(nextViewport, effectiveViewport)) return;
    viewportOverrideBaseRef.current = viewport;
    setViewportOverride(nextViewport);
  }, [
    effectiveViewport,
    flowElements.nodes,
    flowNodeById,
    hoveredNodeIdForPanel,
    hoveredNodeSide,
    side,
    store.flowSize.height,
    store.flowSize.width,
    store.layoutPending,
    viewport,
    viewportForNode,
  ]);

  useEffect(() => {
    if (!isViewportPrimary) return;
    if (viewportOverride) return;
    if (store.layoutPending) return;
    if (flowElements.nodes.length === 0) return;
    if (store.flowSize.width <= 0 || store.flowSize.height <= 0) return;

    const firstNode = flowElements.nodes[0];
    const lastNode = flowElements.nodes[flowElements.nodes.length - 1];
    const layoutRecoveryKey = [
      graph.nodes.length,
      flowElements.nodes.length,
      flowElements.edges.length,
      firstNode?.id ?? "",
      lastNode?.id ?? "",
      Math.round(store.flowSize.width),
      Math.round(store.flowSize.height),
    ].join(":");

    if (layoutRecoveryKey === lastViewportRecoveryKeyRef.current) return;
    lastViewportRecoveryKeyRef.current = layoutRecoveryKey;

    const hasVisibleNode = flowElements.nodes.some((node) => isNodeVisibleInViewport(node));
    if (hasVisibleNode) return;

    const preferredId = selectedNodeId || highlightedNodeId || focusNodeId || "";
    const preferredTarget = preferredId
      ? flowElements.nodes.find((node) => node.id === preferredId)
      : undefined;
    if (preferredId && !preferredTarget) return;
    const target = (
      preferredTarget
      ?? flowElements.nodes.find((node) => node.type !== "scope")
      ?? flowElements.nodes[0]
    );
    if (!target) return;
    onViewportChange(viewportForNode(target));
  }, [
    focusNodeId,
    flowElements.edges.length,
    flowElements.nodes,
    graph.nodes.length,
    highlightedNodeId,
    isNodeVisibleInViewport,
    isViewportPrimary,
    onViewportChange,
    selectedNodeId,
    store.flowSize.height,
    store.flowSize.width,
    store.layoutPending,
    viewportOverride,
    viewportForNode,
  ]);

  useEffect(() => {
    if (!focusNodeId) return;
    if ((focusNodeTick ?? 0) <= 0) return;
    if (focusSourceSide && focusSourceSide !== side) return;
    if (store.layoutPending) return;
    const target = flowElements.nodes.find((node) => node.id === focusNodeId);
    if (!target) return;
    const abs = nodeAbsolutePosition(target);
    const focusNodeKey = [
      focusNodeTick ?? 0,
      target.id,
      Math.round(abs.x),
      Math.round(abs.y),
      Math.round(store.flowSize.width),
      Math.round(store.flowSize.height),
    ].join(":");
    if (focusNodeKey === lastAppliedFocusNodeKeyRef.current) return;
    onViewportChange(viewportForNode(target));
    lastAppliedFocusNodeKeyRef.current = focusNodeKey;
  }, [
    focusNodeId,
    focusNodeTick,
    focusSourceSide,
    flowElements.nodes,
    nodeAbsolutePosition,
    onViewportChange,
    side,
    store.flowSize.height,
    store.flowSize.width,
    store.layoutPending,
    viewportForNode,
  ]);

  useEffect(() => {
    store.clearHoveredEdge();
    store.clearClickedEdge();
    lastEdgeNavigationRef.current = null;
    viewportOverrideBaseRef.current = null;
    setViewportOverride(null);
    if (edgeClickHighlightTimerRef.current !== null) {
      window.clearTimeout(edgeClickHighlightTimerRef.current);
      edgeClickHighlightTimerRef.current = null;
    }
  }, [graph.nodes, graph.edges, viewType, showCalls, store]);

  return (
    <section className={store.searchHighlightedNodeId ? "panel panelSearchFlash" : "panel"}>
      <GraphPanelHeader
        title={title}
        isOld={isOld}
        stats={stats}
        searchQuery={store.searchQuery}
        searchExclude={store.searchExclude}
        searchMatchCount={searchMatches.length}
        searchIndex={store.searchIdx}
        onSearch={handleSearch}
        onSearchNext={handleSearchNext}
        onSearchPrev={handleSearchPrev}
      />
      {showLayoutStatus && (
        <div className="layoutStatusBanner" role="status" aria-live="polite">
          <div className="spinner layoutStatusSpinner" />
          <span className="dimText">{layoutStatusLabel}</span>
        </div>
      )}
      {!showLayoutStatus && !hasInputNodes && (
        <p className="dimText" style={{ marginTop: 6, marginBottom: 0 }}>No nodes for current file/filters.</p>
      )}
      {hoveredEdgeTooltip && typeof document !== "undefined" && createPortal(
        <div style={edgeTooltipStyle}>
          <div><strong>Source:</strong> {hoveredEdgeTooltip.sourceText}</div>
          <div><strong>Target:</strong> {hoveredEdgeTooltip.targetText}</div>
        </div>,
        document.body,
      )}
      <GraphCanvas
        side={side}
        isOld={isOld}
        nodes={graphCanvasNodes}
        edges={searchResultNodes.edges}
        nodeTypes={nodeTypesForFlow}
        viewport={effectiveViewport}
        flowContainerRef={flowContainerRef}
        minimapNodeColor={minimapNodeColor}
        minimapNodeStrokeColor={minimapNodeStrokeColor}
        onNodeClick={handleNodeClick}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseMove={handleNodeMouseMove}
        onNodeMouseLeave={handleNodeMouseLeave}
        onEdgeClick={handleEdgeClick}
        onEdgeMouseEnter={handleEdgeMouseEnter}
        onEdgeMouseMove={handleEdgeMouseMove}
        onEdgeMouseLeave={handleEdgeMouseLeave}
        onPaneMouseLeave={handlePaneMouseLeave}
        onMoveStart={handleMoveStart}
        onMove={handleMove}
        onMoveEnd={handleMoveEnd}
      />
    </section>
  );
});
