import type { ViewGraph } from "../types/graph";

export type NodePortPosition = "left" | "right" | "top" | "bottom";

export interface LayoutNode {
  id: string;
  type?: string;
  data: Record<string, unknown>;
  position: { x: number; y: number };
  sourcePosition?: NodePortPosition;
  targetPosition?: NodePortPosition;
  parentId?: string;
  style?: Record<string, unknown>;
  initialWidth?: number;
  initialHeight?: number;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  label?: string;
  labelStyle?: Record<string, unknown>;
  animated?: boolean;
  style?: Record<string, unknown>;
  markerEnd?: {
    type: "arrowclosed";
    width: number;
    height: number;
    color: string;
  };
}

export interface LayoutWorkerRequest {
  requestId: number;
  graph: ViewGraph;
  viewType: "logic" | "knowledge" | "react";
  showCalls: boolean;
  fileEntries: Array<[string, string]>;
}

export interface LayoutWorkerSuccess {
  requestId: number;
  ok: true;
  result: {
    nodes: LayoutNode[];
    edges: LayoutEdge[];
  };
}

export interface LayoutWorkerFailure {
  requestId: number;
  ok: false;
  error: string;
}

export type LayoutWorkerResponse = LayoutWorkerSuccess | LayoutWorkerFailure;
