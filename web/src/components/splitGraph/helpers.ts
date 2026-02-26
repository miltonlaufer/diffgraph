import type { Node } from "@xyflow/react";
import { buildCrossGraphNodeMatchKey } from "#/lib/nodeIdentity";
import { normPath } from "./layout";
import type { ViewGraphNode } from "#/types/graph";

export const LEAF_W = 220;
export const LEAF_H = 64;
const DIAMOND_BOUNDS = 146;
const FLOW_NODE_W = 220;
const FLOW_NODE_H = 72;

export const CHATGPT_URL_PREFIX = "https://chatgpt.com/?prompt=";
export const CHATGPT_URL_MAX_LENGTH = 7000;
export const CHATGPT_URL_TRUNCATION_NOTICE = "\n\n[PROMPT CUT BECAUSE OF URL LENGTH LIMIT]";

export const labelIdentity = (label: string): string =>
  label
    .replace(/^\[[^\]]+\]\s*/, "")
    .replace(/@\d+/g, "@#")
    .replace(/\bline\s+\d+\b/gi, "line #")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export const structuralAnchorKey = (
  topKey: string,
  kind: string,
  filePath: string,
  className: string | undefined,
  label: string,
  branchType: string | undefined,
): string =>
  `${topKey}:${kind}:${normPath(filePath)}:${(className ?? "").trim().toLowerCase()}:${labelIdentity(label)}:${(branchType ?? "").trim().toLowerCase()}`;

export const oneLine = (value: string): string => value.replace(/\s+/g, " ").trim();

export const lineRangeText = (startLine?: number, endLine?: number): string => {
  if (!startLine || startLine < 1) return "unknown";
  if (!endLine || endLine < startLine) return `${startLine}`;
  return `${startLine}-${endLine}`;
};

export const shortPathForPrompt = (filePath: string): string => {
  const normalized = normPath(filePath);
  const parts = normalized.split("/").filter((part) => part.length > 0);
  if (parts.length <= 3) return normalized;
  return parts.slice(-3).join("/");
};

export const shortStatus = (status: string): string => {
  if (status === "added") return "a";
  if (status === "removed") return "r";
  if (status === "modified") return "m";
  return "u";
};

export const buildCappedChatGptUrl = (prompt: string): string => {
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

export const buildIndexedMatchKeyByNodeId = (nodes: ViewGraphNode[]): Map<string, string> => {
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

export const hasDebugEdgesFlag = (): boolean => {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("debugEdges") === "1";
};

export const isGroupHeaderTarget = (event: unknown): boolean => {
  const maybeTarget = (event as { target?: EventTarget | null } | null)?.target;
  if (!(maybeTarget instanceof Element)) return false;
  return Boolean(maybeTarget.closest("[data-group-header='true']"));
};

export const nodeSize = (node: Node): { width: number; height: number } => {
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

export const hasHorizontalOverlap = (
  aX: number,
  aWidth: number,
  bX: number,
  bWidth: number,
): boolean => {
  const margin = 4;
  return aX + aWidth - margin > bX && bX + bWidth - margin > aX;
};

export const hasActivePointerEvent = (event: MouseEvent | TouchEvent | null): boolean => {
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

export const isWheelEvent = (event: MouseEvent | TouchEvent | null): boolean => {
  if (!event) return false;
  const maybeEvent = event as { type?: unknown };
  return typeof maybeEvent.type === "string" && maybeEvent.type === "wheel";
};

export interface PanelViewport {
  x: number;
  y: number;
  zoom: number;
}

const VIEWPORT_EPSILON = 0.5;
const VIEWPORT_ZOOM_EPSILON = 0.001;

export const hasViewportDelta = (a: PanelViewport, b: PanelViewport): boolean =>
  Math.abs(a.x - b.x) > VIEWPORT_EPSILON
  || Math.abs(a.y - b.y) > VIEWPORT_EPSILON
  || Math.abs(a.zoom - b.zoom) > VIEWPORT_ZOOM_EPSILON;
