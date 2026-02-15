import type { Node } from "@xyflow/react";
import type { ViewportState } from "../../types/graph";
import { LEAF_H, LEAF_W } from "./layout";

interface FlowSize {
  width: number;
  height: number;
}

const NODE_CENTER_ZOOM = 0.9;
const VIEWPORT_FOCUS_TOP_RATIO = 0.2;
const VIEWPORT_FOCUS_LEFT_RATIO = 0.2;
const DIAMOND_BOUNDS = 146;
const FLOW_NODE_W = 220;
const FLOW_NODE_H = 72;

export const resolveNodeSize = (node: Node): { width: number; height: number } => {
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

export const computeNodeAbsolutePosition = (
  node: Node,
  nodeById: Map<string, Node>,
): { x: number; y: number } => {
  let x = node.position.x;
  let y = node.position.y;
  let parentId = node.parentId;
  while (parentId) {
    const parent = nodeById.get(parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }
  return { x, y };
};

export const computeViewportForNode = (
  node: Node,
  nodeById: Map<string, Node>,
  flowSize: FlowSize,
): ViewportState => {
  const zoom = NODE_CENTER_ZOOM;
  const abs = computeNodeAbsolutePosition(node, nodeById);
  return {
    x: flowSize.width * VIEWPORT_FOCUS_LEFT_RATIO - abs.x * zoom,
    y: flowSize.height * VIEWPORT_FOCUS_TOP_RATIO - abs.y * zoom,
    zoom,
  };
};

export const isNodeVisibleInViewport = (
  node: Node,
  nodeById: Map<string, Node>,
  flowSize: FlowSize,
  viewport: ViewportState,
  margin = 20,
): boolean => {
  const abs = computeNodeAbsolutePosition(node, nodeById);
  const size = resolveNodeSize(node);
  const left = abs.x * viewport.zoom + viewport.x;
  const top = abs.y * viewport.zoom + viewport.y;
  const right = (abs.x + size.width) * viewport.zoom + viewport.x;
  const bottom = (abs.y + size.height) * viewport.zoom + viewport.y;
  return right >= margin && bottom >= margin && left <= flowSize.width - margin && top <= flowSize.height - margin;
};
