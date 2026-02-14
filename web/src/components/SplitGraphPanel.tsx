import { useMemo, useCallback, useEffect, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
  type Viewport,
  MarkerType,
  Position,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import type { ViewGraph, ViewGraphNode, ViewportState } from "../types/graph";
import DiamondNode from "./nodes/DiamondNode";
import PillNode from "./nodes/PillNode";
import ProcessNode from "./nodes/ProcessNode";
import GroupNode from "./nodes/GroupNode";
import KnowledgeNode from "./nodes/KnowledgeNode";
import { SearchBox } from "./SearchBox";
/* style.css imported globally in main.tsx */

interface DiffStats {
  added: number;
  removed: number;
  modified: number;
}

export interface GraphDiffTarget {
  id: string;
  side: "old" | "new";
  x: number;
  y: number;
  viewportX: number;
  viewportY: number;
  viewportZoom: number;
  diffStatus: "added" | "removed" | "modified";
}

interface SplitGraphPanelProps {
  title: string;
  side: "old" | "new";
  graph: ViewGraph;
  viewType: "logic" | "knowledge" | "react";
  showCalls?: boolean;
  onNodeSelect: (nodeId: string, side: "old" | "new") => void;
  viewport: ViewportState;
  onViewportChange: (viewport: ViewportState) => void;
  selectedNodeId: string;
  highlightedNodeId?: string;
  focusNodeId?: string;
  focusNodeTick?: number;
  focusFilePath: string;
  diffStats?: DiffStats;
  fileContentMap: Map<string, string>;
  onDiffTargetsChange?: (side: "old" | "new", targets: GraphDiffTarget[]) => void;
}

const statusColor: Record<string, string> = {
  added: "#15803d",
  removed: "#b91c1c",
  modified: "#ca8a04",
  unchanged: "#334155",
};

const statusTextColor: Record<string, string> = {
  added: "#f0fdf4",
  removed: "#fef2f2",
  modified: "#1c1917",
  unchanged: "#f8fafc",
};

const decisionKinds = new Set(["if", "switch", "ternary"]);
const terminalKinds = new Set(["return"]);
const loopKinds = new Set(["for", "while"]);

const leafNodeShape = (branchType: string): string => {
  if (decisionKinds.has(branchType)) return "diamond";
  if (terminalKinds.has(branchType) || loopKinds.has(branchType)) return "pill";
  return "process";
};

const logicNodeTypes: NodeTypes = {
  diamond: DiamondNode,
  pill: PillNode,
  process: ProcessNode,
  scope: GroupNode,
};

const knowledgeNodeTypes: NodeTypes = {
  knowledge: KnowledgeNode,
};

const LEAF_W = 220;
const LEAF_H = 64;
const DIAMOND_W = 220;
const DIAMOND_H = 220;
const PAD_X = 45;
const PAD_TOP = 72;
const PAD_BOTTOM = 45;
const NODE_W = 220;
const NODE_H = 56;
const SEARCH_FLASH_MS = 3200;
const SEARCH_FLASH_STYLE = {
  outline: "5px solid #ffffff",
  outlineOffset: "3px",
  boxShadow: "0 0 0 2px rgba(255,255,255,0.95), 0 0 28px rgba(255,255,255,0.92)",
  zIndex: 1000,
};

/* ========== LOGIC: two-pass nested layout ========== */

interface CodeContextData {
  lines: Array<{ num: number; text: string; highlight: boolean }>;
}

const extractCodeContext = (
  fileContent: string,
  startLine: number | undefined,
  endLine: number | undefined,
): CodeContextData => {
  if (!startLine || !fileContent) return { lines: [] };
  const allLines = fileContent.split("\n");
  const from = Math.max(0, startLine - 6);
  const to = Math.min(allLines.length, (endLine ?? startLine) + 5);
  const end = endLine ?? startLine;
  return {
    lines: allLines.slice(from, to).map((text, i) => {
      const num = from + i + 1;
      return { num, text, highlight: num >= startLine && num <= end };
    }),
  };
};

const computeLogicLayout = (
  graph: ViewGraph,
  selectedNodeId: string,
  fileContentMap: Map<string, string>,
  showCalls: boolean,
): { nodes: Node[]; edges: Edge[] } => {
  const groupNodes = graph.nodes.filter((n) => n.kind === "group");
  const leafNodes = graph.nodes.filter((n) => n.kind !== "group");

  /* Build children map */
  const childrenOf = new Map<string, ViewGraphNode[]>();
  for (const g of groupNodes) childrenOf.set(g.id, []);
  for (const leaf of leafNodes) {
    if (leaf.parentId && childrenOf.has(leaf.parentId)) {
      childrenOf.get(leaf.parentId)!.push(leaf);
    }
  }
  for (const g of groupNodes) {
    if (g.parentId && childrenOf.has(g.parentId)) {
      childrenOf.get(g.parentId)!.push(g);
    }
  }

  /* Remove empty groups iteratively */
  const emptyIds = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const g of groupNodes) {
      if (emptyIds.has(g.id)) continue;
      const kids = childrenOf.get(g.id) ?? [];
      const hasLeaf = kids.some((c) => c.kind === "Branch");
      const hasSubGroup = kids.some((c) => c.kind === "group" && !emptyIds.has(c.id));
      if (!hasLeaf && !hasSubGroup) { emptyIds.add(g.id); changed = true; }
    }
  }

  /* Pass 1: layout children inside each group (TB direction for flowchart feel) */
  const childPos = new Map<string, { x: number; y: number }>();
  const groupSize = new Map<string, { w: number; h: number }>();

  /* Process bottom-up: leaf-only groups first, then parents */
  const sortedGroups = [...groupNodes].filter((g) => !emptyIds.has(g.id));
  /* Sort so children come before parents */
  const depth = new Map<string, number>();
  const getDepth = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    const node = graph.nodes.find((n) => n.id === id);
    if (!node?.parentId || emptyIds.has(node.parentId)) { depth.set(id, 0); return 0; }
    const d = getDepth(node.parentId) + 1;
    depth.set(id, d);
    return d;
  };
  sortedGroups.forEach((g) => getDepth(g.id));
  sortedGroups.sort((a, b) => (depth.get(b.id) ?? 0) - (depth.get(a.id) ?? 0));

  for (const group of sortedGroups) {
    const kids = (childrenOf.get(group.id) ?? []).filter((c) => !emptyIds.has(c.id));
    if (kids.length === 0) { emptyIds.add(group.id); continue; }

    const dg = new dagre.graphlib.Graph();
    dg.setDefaultEdgeLabel(() => ({}));
    dg.setGraph({ rankdir: "TB", nodesep: 120, ranksep: 130, marginx: 40, marginy: 40 });

    for (const kid of kids) {
      const isDiamond = kid.kind === "Branch" && decisionKinds.has(kid.branchType ?? "");
      const isSub = kid.kind === "group";
      const w = isDiamond ? DIAMOND_W : isSub ? (groupSize.get(kid.id)?.w ?? LEAF_W) : LEAF_W;
      const h = isDiamond ? DIAMOND_H : isSub ? (groupSize.get(kid.id)?.h ?? LEAF_H) : LEAF_H;
      dg.setNode(kid.id, { width: w, height: h });
    }
    const kidIds = new Set(kids.map((k) => k.id));
    for (const edge of graph.edges) {
      if (kidIds.has(edge.source) && kidIds.has(edge.target) && dg.hasNode(edge.source) && dg.hasNode(edge.target)) {
        dg.setEdge(edge.source, edge.target);
      }
    }
    dagre.layout(dg);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const kid of kids) {
      const p = dg.node(kid.id);
      if (!p) continue;
      const isDiamond = kid.kind === "Branch" && decisionKinds.has(kid.branchType ?? "");
      const isSub = kid.kind === "group";
      const w = isDiamond ? DIAMOND_W : isSub ? (groupSize.get(kid.id)?.w ?? LEAF_W) : LEAF_W;
      const h = isDiamond ? DIAMOND_H : isSub ? (groupSize.get(kid.id)?.h ?? LEAF_H) : LEAF_H;
      const tlx = p.x - w / 2;
      const tly = p.y - h / 2;
      childPos.set(kid.id, { x: tlx, y: tly });
      minX = Math.min(minX, tlx); minY = Math.min(minY, tly);
      maxX = Math.max(maxX, tlx + w); maxY = Math.max(maxY, tly + h);
    }
    for (const kid of kids) {
      const p = childPos.get(kid.id);
      if (p) childPos.set(kid.id, { x: p.x - minX + PAD_X, y: p.y - minY + PAD_TOP });
    }
    groupSize.set(group.id, { w: (maxX - minX) + PAD_X * 2, h: (maxY - minY) + PAD_TOP + PAD_BOTTOM });
  }

  /* Pass 2: top-level layout (LR for horizontal alignment between old/new) */
  const topNodes = graph.nodes.filter((n) => {
    if (emptyIds.has(n.id)) return false;
    if (!n.parentId) return true;
    if (emptyIds.has(n.parentId)) return true;
    return false;
  });

  const g2 = new dagre.graphlib.Graph();
  g2.setDefaultEdgeLabel(() => ({}));
  g2.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 100, marginx: 40, marginy: 40 });
  for (const n of topNodes) {
    const sz = groupSize.get(n.id);
    const w = sz?.w ?? LEAF_W;
    const h = sz?.h ?? LEAF_H;
    g2.setNode(n.id, { width: w, height: h });
  }
  const topIdSet = new Set(topNodes.map((n) => n.id));
  for (const edge of graph.edges) {
    if (topIdSet.has(edge.source) && topIdSet.has(edge.target) && g2.hasNode(edge.source) && g2.hasNode(edge.target)) {
      g2.setEdge(edge.source, edge.target);
    }
  }
  dagre.layout(g2);
  const topPos = new Map<string, { x: number; y: number }>();
  for (const n of topNodes) {
    const p = g2.node(n.id);
    const sz = groupSize.get(n.id);
    const w = sz?.w ?? LEAF_W;
    const h = sz?.h ?? LEAF_H;
    topPos.set(n.id, { x: (p?.x ?? 0) - w / 2, y: (p?.y ?? 0) - h / 2 });
  }

  /* Build ReactFlow nodes */
  const flowNodes: Node[] = [];
  for (const node of graph.nodes) {
    if (emptyIds.has(node.id)) continue;
    const parentOk = node.parentId && !emptyIds.has(node.parentId);
    const bg = statusColor[node.diffStatus] ?? "#334155";
    const txt = statusTextColor[node.diffStatus] ?? "#f8fafc";
    const sel = node.id === selectedNodeId;

    if (node.kind === "group") {
      const sz = groupSize.get(node.id) ?? { w: LEAF_W, h: LEAF_H };
      const pos = parentOk ? (childPos.get(node.id) ?? { x: 0, y: 0 }) : (topPos.get(node.id) ?? { x: 0, y: 0 });
      flowNodes.push({
        id: node.id, type: "scope",
        data: {
          label: node.label,
          bgColor: bg,
          textColor: txt,
          selected: sel,
          width: sz.w,
          height: sz.h,
          fileName: node.fileName,
          className: node.className,
          functionParams: node.functionParams,
          returnType: node.returnType,
          documentation: node.documentation,
        },
        position: pos, sourcePosition: Position.Bottom, targetPosition: Position.Top,
        initialWidth: sz.w,
        initialHeight: sz.h,
        ...(parentOk ? { parentId: node.parentId } : {}),
        style: { width: sz.w, height: sz.h },
      });
    } else {
      const shape = leafNodeShape(node.branchType ?? "");
      const initialSize = shape === "diamond"
        ? { width: 120, height: 120 }
        : { width: LEAF_W, height: LEAF_H };
      const pos = parentOk ? (childPos.get(node.id) ?? { x: 0, y: 0 }) : (topPos.get(node.id) ?? { x: 0, y: 0 });
      const normalizedFilePath = normPath(node.filePath);
      const fileContent = fileContentMap.get(normalizedFilePath) ?? "";
      const codeContext = extractCodeContext(fileContent, node.startLine, node.endLine);
      const nodeLang = langFromPath(normalizedFilePath);

      /* Return nodes get a distinct purple color */
      let nodeBg = bg;
      let nodeTxt = txt;
      if ((node.branchType ?? "") === "return") {
        if (node.diffStatus === "unchanged") { nodeBg = "#6d28d9"; nodeTxt = "#f5f3ff"; }
        else if (node.diffStatus === "modified") { nodeBg = "#a78bfa"; nodeTxt = "#1e1b4b"; }
      }

      flowNodes.push({
        id: node.id, type: shape,
        data: { label: node.label, bgColor: nodeBg, textColor: nodeTxt, selected: sel, codeContext, language: nodeLang },
        position: pos, sourcePosition: Position.Bottom, targetPosition: Position.Top,
        initialWidth: initialSize.width,
        initialHeight: initialSize.height,
        ...(parentOk ? { parentId: node.parentId } : {}),
      });
    }
  }

  /* Sort: parents before children */
  flowNodes.sort((a, b) => {
    const ap = "parentId" in a && a.parentId;
    const bp = "parentId" in b && b.parentId;
    if (!ap && bp) return -1;
    if (ap && !bp) return 1;
    return 0;
  });

  /* Edges: keep branch flow + function invoke calls, hide hierarchy edges */
  const visibleIds = new Set(flowNodes.map((n) => n.id));
  const groupIdSet = new Set(flowNodes.filter((n) => n.type === "scope").map((n) => n.id));
  const flowEdges: Edge[] = graph.edges
    .filter((e) => {
      if (!visibleIds.has(e.source) || !visibleIds.has(e.target)) return false;
      if (e.relation === "hierarchy") return false;
      if (!showCalls && e.relation === "invoke") return false;
      /* Show function invocation links between scope/group nodes */
      if (groupIdSet.has(e.source) || groupIdSet.has(e.target)) {
        return e.relation === "invoke";
      }
      return true;
    })
    .map((edge) => {
      const isInvoke = edge.relation === "invoke";
      const stroke = edge.diffStatus === "added"
        ? "#4ade80"
        : edge.diffStatus === "removed"
          ? "#f87171"
          : isInvoke
            ? "#f59e0b"
            : "#64748b";
      const strokeWidth = isInvoke ? 2.5 : 1.5;
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: isInvoke ? "calls" : "",
        animated: edge.diffStatus === "added" || edge.diffStatus === "removed",
        style: {
          stroke,
          strokeWidth,
          strokeDasharray: isInvoke ? "6 4" : undefined,
        },
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: stroke },
      };
    });

  return { nodes: flowNodes, edges: flowEdges };
};

/* ========== FLAT layout for knowledge/react ========== */

const computeFlatLayout = (
  graph: ViewGraph,
  selectedNodeId: string,
  fileContentMap: Map<string, string>,
): { nodes: Node[]; edges: Edge[] } => {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 50, ranksep: 80, marginx: 50, marginy: 50 });
  graph.nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  graph.edges.forEach((e) => { if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target); });
  dagre.layout(g);

  const nodes: Node[] = graph.nodes.map((node) => {
    const p = g.node(node.id);
    const bg = statusColor[node.diffStatus] ?? "#334155";
    const txt = statusTextColor[node.diffStatus] ?? "#f8fafc";
    const sel = node.id === selectedNodeId;
    const nfp = normPath(node.filePath);
    const fileContent = fileContentMap.get(nfp) ?? "";
    const codeContext = extractCodeContext(fileContent, node.startLine, node.endLine);
    const lang = langFromPath(nfp);
    return {
      id: node.id,
      type: "knowledge",
      data: {
        label: node.label,
        shortPath: shortenPath(node.filePath),
        fullPath: node.filePath,
        bgColor: bg,
        textColor: txt,
        selected: sel,
        codeContext,
        language: lang,
      },
      position: { x: (p?.x ?? 0) - NODE_W / 2, y: (p?.y ?? 0) - NODE_H / 2 },
      sourcePosition: Position.Right, targetPosition: Position.Left,
      initialWidth: NODE_W,
      initialHeight: NODE_H,
    };
  });
  const edges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id, source: edge.source, target: edge.target, label: "",
    animated: edge.diffStatus === "added" || edge.diffStatus === "removed",
    style: { stroke: edge.diffStatus === "added" ? "#4ade80" : edge.diffStatus === "removed" ? "#f87171" : "#64748b", strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "#94a3b8" },
  }));
  return { nodes, edges };
};

const normPath = (v: string): string =>
  v.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");

const langFromPath = (path: string): string => {
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  if (path.endsWith(".js") || path.endsWith(".jsx")) return "javascript";
  if (path.endsWith(".py")) return "python";
  return "text";
};

const shortenPath = (filePath: string): string => {
  const parts = filePath.replace(/\\/g, "/").split("/");
  if (parts.length <= 3) return filePath;
  const firstDir = parts[0];
  const secondDir = parts[1];
  const fileName = parts[parts.length - 1];
  return `${firstDir}/${secondDir}/[...]/${fileName}`;
};

export const SplitGraphPanel = ({
  title, side, graph, viewType, showCalls = true, onNodeSelect, viewport, onViewportChange, selectedNodeId, highlightedNodeId, focusNodeId, focusNodeTick, focusFilePath, diffStats, fileContentMap, onDiffTargetsChange,
}: SplitGraphPanelProps) => {
  /******************* STORE ***********************/
  const [searchQuery, setSearchQuery] = useState("");
  const [searchExclude, setSearchExclude] = useState(false);
  const [searchIdx, setSearchIdx] = useState(0);
  const [searchHighlightedNodeId, setSearchHighlightedNodeId] = useState("");
  const lastAutoFocusSearchRef = useRef<string>("");
  const searchHighlightTimerRef = useRef<number | null>(null);
  const flowContainerRef = useRef<HTMLDivElement>(null);
  const [flowSize, setFlowSize] = useState({ width: 800, height: 500 });

  /******************* COMPUTED ***********************/
  const isLogic = useMemo(() => viewType === "logic", [viewType]);
  const isOld = useMemo(() => side === "old", [side]);
  /* Heavy layout: only recomputes when graph structure changes, NOT on selection */
  const layoutResult = useMemo(
    () => isLogic ? computeLogicLayout(graph, "", fileContentMap, showCalls) : computeFlatLayout(graph, "", fileContentMap),
    [graph, isLogic, fileContentMap, showCalls],
  );

  /* Light selection pass: just updates node styles */
  const flowElements = useMemo(() => {
    if (!selectedNodeId && !highlightedNodeId && !searchHighlightedNodeId) return layoutResult;
    const nodes = layoutResult.nodes.map((node) => {
      const isSearchTarget = node.id === searchHighlightedNodeId;
      const isSelected = node.id === selectedNodeId || node.id === highlightedNodeId || isSearchTarget;
      if (!isSelected) return node;
      const baseNode = (node.type === "scope" || node.type === "diamond" || node.type === "pill" || node.type === "process" || node.type === "knowledge")
        ? { ...node, data: { ...node.data, selected: true } }
        : { ...node, style: { ...(node.style ?? {}), border: "3px solid #38bdf8", boxShadow: "0 0 12px #38bdf8" } };
      if (!isSearchTarget) {
        return baseNode;
      }
      return { ...baseNode, style: { ...(baseNode.style ?? {}), ...SEARCH_FLASH_STYLE } };
    });
    return { nodes, edges: layoutResult.edges };
  }, [layoutResult, selectedNodeId, highlightedNodeId, searchHighlightedNodeId]);

  /* Search: find matching node ids */
  const searchMatches = useMemo(() => {
    if (!searchQuery || searchQuery.length < 2) return [];
    const q = searchQuery.toLowerCase();
    return flowElements.nodes.filter((n) => {
      const gn = graph.nodes.find((g) => g.id === n.id);
      const text = `${gn?.label ?? ""} ${gn?.filePath ?? ""} ${gn?.kind ?? ""}`.toLowerCase();
      const matches = text.includes(q);
      return searchExclude ? !matches : matches;
    });
  }, [searchQuery, searchExclude, flowElements.nodes, graph.nodes]);

  const searchResultNodes = useMemo(() => {
    if (!searchQuery || searchQuery.length < 2) return flowElements;
    if (searchExclude) {
      /* Exclude mode: hide nodes that DON'T match (i.e. show only matches, which are non-matching text) */
      const keepIds = new Set(searchMatches.map((n) => n.id));
      const nodes = flowElements.nodes.filter((n) => keepIds.has(n.id));
      const nodeIds = new Set(nodes.map((n) => n.id));
      const edges = flowElements.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
      return { nodes, edges };
    }
    /* Normal mode: highlight matches, dim others */
    const matchIds = new Set(searchMatches.map((n) => n.id));
    const nodes = flowElements.nodes.map((node) => {
      if (node.id === searchHighlightedNodeId) {
        return { ...node, style: { ...(node.style ?? {}), ...SEARCH_FLASH_STYLE } };
      }
      if (!matchIds.has(node.id)) return { ...node, style: { ...(node.style ?? {}), opacity: 0.25 } };
      return { ...node, style: { ...(node.style ?? {}), outline: "2px solid #fbbf24", outlineOffset: "2px" } };
    });
    return { nodes, edges: flowElements.edges };
  }, [flowElements, searchMatches, searchQuery, searchExclude, searchHighlightedNodeId]);

  const flowNodeById = useMemo(() => new Map(flowElements.nodes.map((n) => [n.id, n])), [flowElements.nodes]);

  const nodeAbsolutePosition = useCallback((node: Node): { x: number; y: number } => {
    let x = node.position.x;
    let y = node.position.y;
    let parentId = node.parentId;
    while (parentId) {
      const parent = flowNodeById.get(parentId);
      if (!parent) break;
      x += parent.position.x;
      y += parent.position.y;
      parentId = parent.parentId;
    }
    return { x, y };
  }, [flowNodeById]);

  const nodeSize = useCallback((node: Node): { width: number; height: number } => {
    const styleWidth = typeof node.style?.width === "number" ? node.style.width : undefined;
    const styleHeight = typeof node.style?.height === "number" ? node.style.height : undefined;
    if (styleWidth && styleHeight) return { width: styleWidth, height: styleHeight };
    if (node.type === "diamond") return { width: 120, height: 120 };
    if (node.type === "knowledge") return { width: NODE_W, height: NODE_H };
    if (node.type === "scope") return { width: LEAF_W, height: LEAF_H };
    return { width: LEAF_W, height: LEAF_H };
  }, []);

  const viewportForNode = useCallback((node: Node): { x: number; y: number; zoom: number } => {
    const zoom = 0.9;
    const padding = 24;
    const abs = nodeAbsolutePosition(node);
    const size = nodeSize(node);
    const worldVisibleW = flowSize.width / zoom;
    const worldVisibleH = flowSize.height / zoom;
    const tooLarge = size.width > worldVisibleW * 0.8 || size.height > worldVisibleH * 0.8;

    if (tooLarge) {
      const anchorWorldX = abs.x - padding;
      const anchorWorldY = abs.y - padding;
      return {
        x: padding - anchorWorldX * zoom,
        y: padding - anchorWorldY * zoom,
        zoom,
      };
    }

    const centerX = abs.x + size.width / 2;
    const centerY = abs.y + size.height / 2;
    return {
      x: flowSize.width / 2 - centerX * zoom,
      y: flowSize.height / 2 - centerY * zoom,
      zoom,
    };
  }, [flowSize.height, flowSize.width, nodeAbsolutePosition, nodeSize]);

  const flowStyle = useMemo(() => ({ width: "100%", height: "100%" }), []);
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
    return { added: graph.nodes.filter((n) => n.diffStatus === "added").length, removed: graph.nodes.filter((n) => n.diffStatus === "removed").length, modified: graph.nodes.filter((n) => n.diffStatus === "modified").length };
  }, [diffStats, graph.nodes]);
  const nodeTypesForFlow = useMemo(() => (isLogic ? logicNodeTypes : knowledgeNodeTypes), [isLogic]);

  const focusedViewport = useMemo(() => {
    if (!focusFilePath) return null;
    const nf = normPath(focusFilePath);
    const pts: Array<{ x: number; y: number }> = [];
    for (const n of flowElements.nodes) {
      const gn = graph.nodes.find((g) => g.id === n.id);
      if (gn && normPath(gn.filePath) === nf) pts.push(nodeAbsolutePosition(n));
    }
    if (pts.length === 0) return null;
    const ax = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const ay = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    return { x: -ax + 200, y: -ay + 150, zoom: 0.9 };
  }, [focusFilePath, flowElements.nodes, graph.nodes, nodeAbsolutePosition]);

  /******************* FUNCTIONS ***********************/
  const handleSearch = useCallback((q: string, exclude: boolean) => { setSearchQuery(q); setSearchExclude(exclude); setSearchIdx(0); }, []);
  const flashSearchTarget = useCallback((nodeId: string) => {
    setSearchHighlightedNodeId(nodeId);
    if (searchHighlightTimerRef.current !== null) {
      window.clearTimeout(searchHighlightTimerRef.current);
    }
    searchHighlightTimerRef.current = window.setTimeout(() => {
      setSearchHighlightedNodeId("");
      searchHighlightTimerRef.current = null;
    }, SEARCH_FLASH_MS);
  }, []);
  const handleSearchNext = useCallback(() => {
    if (searchMatches.length === 0) return;
    const next = (searchIdx + 1) % searchMatches.length;
    setSearchIdx(next);
    const target = searchMatches[next];
    if (target) {
      flashSearchTarget(target.id);
      onViewportChange(viewportForNode(target));
    }
  }, [searchMatches, searchIdx, onViewportChange, flashSearchTarget, viewportForNode]);
  const handleSearchPrev = useCallback(() => {
    if (searchMatches.length === 0) return;
    const prev = (searchIdx - 1 + searchMatches.length) % searchMatches.length;
    setSearchIdx(prev);
    const target = searchMatches[prev];
    if (target) {
      flashSearchTarget(target.id);
      onViewportChange(viewportForNode(target));
    }
  }, [searchMatches, searchIdx, onViewportChange, flashSearchTarget, viewportForNode]);
  const handleNodeClick = useCallback<NodeMouseHandler>((_e, n) => { onNodeSelect(n.id, side); }, [onNodeSelect, side]);
  const handleMove = useCallback((_e: MouseEvent | TouchEvent | null, v: Viewport) => { onViewportChange({ x: v.x, y: v.y, zoom: v.zoom }); }, [onViewportChange]);

  /******************* USEEFFECTS ***********************/
  const prevFocusRef = useRef<string>("");

  useEffect(() => {
    const el = flowContainerRef.current;
    if (!el) return;
    const update = (): void => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setFlowSize({ width: rect.width, height: rect.height });
      }
    };
    update();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => update());
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!onDiffTargetsChange) return;
    const graphNodeById = new Map(graph.nodes.map((n) => [n.id, n]));
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
        } as GraphDiffTarget;
      })
      .filter((entry): entry is GraphDiffTarget => entry !== null);
    onDiffTargetsChange(side, targets);
  }, [onDiffTargetsChange, side, graph.nodes, flowElements.nodes, nodeAbsolutePosition, viewportForNode]);

  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2 || searchMatches.length === 0) return;
    const searchKey = `${searchExclude ? "exclude" : "include"}:${searchQuery.toLowerCase()}`;
    if (lastAutoFocusSearchRef.current === searchKey) return;
    lastAutoFocusSearchRef.current = searchKey;
    setSearchIdx(0);
    const first = searchMatches[0];
    flashSearchTarget(first.id);
    onViewportChange(viewportForNode(first));
  }, [searchQuery, searchExclude, searchMatches, onViewportChange, flashSearchTarget, viewportForNode]);

  useEffect(() => () => {
    if (searchHighlightTimerRef.current !== null) {
      window.clearTimeout(searchHighlightTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (focusFilePath && focusFilePath !== prevFocusRef.current && focusedViewport) {
      prevFocusRef.current = focusFilePath;
      onViewportChange(focusedViewport);
    }
  }, [focusFilePath, focusedViewport, onViewportChange]);

  useEffect(() => {
    if (!focusNodeId) return;
    const target = flowElements.nodes.find((node) => node.id === focusNodeId);
    if (!target) return;
    onViewportChange(viewportForNode(target));
  }, [focusNodeId, focusNodeTick, flowElements.nodes, onViewportChange, viewportForNode]);

  return (
    <section className={searchHighlightedNodeId ? "panel panelSearchFlash" : "panel"}>
      <h3>{title}</h3>
      <div className="panelToolbar">
        {!isOld && (
          <div className="legendRow">
            <span className="legendItem addedLegend">Added {stats.added}</span>
            <span className="legendItem removedLegend">Removed {stats.removed}</span>
            <span className="legendItem modifiedLegend">Modified {stats.modified}</span>
          </div>
        )}
        <SearchBox
          placeholder="Search nodes..."
          onSearch={handleSearch}
          onNext={handleSearchNext}
          onPrev={handleSearchPrev}
          resultCount={searchMatches.length}
          currentIndex={searchIdx}
        />
      </div>
      <div className="flowContainer" ref={flowContainerRef}>
        <ReactFlow
          id={`reactflow-${side}`}
          nodes={searchResultNodes.nodes} edges={searchResultNodes.edges} nodeTypes={nodeTypesForFlow}
          onNodeClick={handleNodeClick} viewport={viewport} onMove={handleMove}
          style={flowStyle} onlyRenderVisibleElements minZoom={0.05} maxZoom={2}
          nodesDraggable={false}
          panOnDrag
          selectionOnDrag={false}
        >
          <Background />
          {!isOld && <Controls />}
          {!isOld && (
            <MiniMap
              pannable
              zoomable
              bgColor="#0b1120"
              maskColor="rgba(148, 163, 184, 0.2)"
              maskStrokeColor="#cbd5e1"
              nodeColor={minimapNodeColor}
              nodeStrokeColor={minimapNodeStrokeColor}
              nodeStrokeWidth={2}
            />
          )}
        </ReactFlow>
      </div>
    </section>
  );
};
