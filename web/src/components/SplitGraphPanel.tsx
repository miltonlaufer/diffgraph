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
import type { FileDiffEntry, ViewGraph, ViewGraphNode, ViewportState } from "../types/graph";
import DiamondNode from "./nodes/DiamondNode";
import PillNode from "./nodes/PillNode";
import ProcessNode from "./nodes/ProcessNode";
import GroupNode from "./nodes/GroupNode";
import { SearchBox } from "./SearchBox";
/* style.css imported globally in main.tsx */

interface DiffStats {
  added: number;
  removed: number;
  modified: number;
}

interface SplitGraphPanelProps {
  title: string;
  side: "old" | "new";
  graph: ViewGraph;
  viewType: "logic" | "knowledge" | "react";
  onNodeSelect: (nodeId: string) => void;
  viewport: ViewportState;
  onViewportChange: (viewport: ViewportState) => void;
  selectedNodeId: string;
  focusFilePath: string;
  diffStats?: DiffStats;
  fileDiffs?: FileDiffEntry[];
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

const LEAF_W = 220;
const LEAF_H = 64;
const DIAMOND_W = 220;
const DIAMOND_H = 220;
const PAD_X = 35;
const PAD_TOP = 48;
const PAD_BOTTOM = 35;
const NODE_W = 220;
const NODE_H = 56;

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
        data: { label: node.label, bgColor: bg, textColor: txt, selected: sel, width: sz.w, height: sz.h },
        position: pos, sourcePosition: Position.Bottom, targetPosition: Position.Top,
        ...(parentOk ? { parentId: node.parentId, extent: "parent" as const } : {}),
        style: { width: sz.w, height: sz.h },
      });
    } else {
      const shape = leafNodeShape(node.branchType ?? "");
      const pos = parentOk ? (childPos.get(node.id) ?? { x: 0, y: 0 }) : (topPos.get(node.id) ?? { x: 0, y: 0 });
      const normalizedFilePath = normPath(node.filePath);
      const fileContent = fileContentMap.get(normalizedFilePath) ?? "";
      const codeContext = extractCodeContext(fileContent, node.startLine, node.endLine);

      /* Return nodes get a distinct purple color */
      let nodeBg = bg;
      let nodeTxt = txt;
      if ((node.branchType ?? "") === "return") {
        if (node.diffStatus === "unchanged") { nodeBg = "#6d28d9"; nodeTxt = "#f5f3ff"; }
        else if (node.diffStatus === "modified") { nodeBg = "#a78bfa"; nodeTxt = "#1e1b4b"; }
      }

      flowNodes.push({
        id: node.id, type: shape,
        data: { label: node.label, bgColor: nodeBg, textColor: nodeTxt, selected: sel, codeContext },
        position: pos, sourcePosition: Position.Bottom, targetPosition: Position.Top,
        ...(parentOk ? { parentId: node.parentId, extent: "parent" as const } : {}),
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

  /* Edges: only CALLS (flow) edges, not DECLARES (parent-child is shown by nesting) */
  const visibleIds = new Set(flowNodes.map((n) => n.id));
  const groupIdSet = new Set(flowNodes.filter((n) => n.type === "scope").map((n) => n.id));
  const flowEdges: Edge[] = graph.edges
    .filter((e) => {
      if (!visibleIds.has(e.source) || !visibleIds.has(e.target)) return false;
      /* Hide edges that connect to/from group nodes -- nesting handles that */
      if (groupIdSet.has(e.source) || groupIdSet.has(e.target)) return false;
      return true;
    })
    .map((edge) => ({
      id: edge.id, source: edge.source, target: edge.target,
      label: "",
      animated: edge.diffStatus === "added" || edge.diffStatus === "removed",
      style: { stroke: edge.diffStatus === "added" ? "#4ade80" : edge.diffStatus === "removed" ? "#f87171" : "#64748b", strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "#94a3b8" },
    }));

  return { nodes: flowNodes, edges: flowEdges };
};

/* ========== FLAT layout for knowledge/react ========== */

const computeFlatLayout = (
  graph: ViewGraph,
  selectedNodeId: string,
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
    const shortPath = shortenPath(node.filePath);
    const fullText = `${node.label}\n${node.filePath}`;
    return {
      id: node.id,
      data: {
        label: (
          <div title={fullText} style={{ width: NODE_W - 20, overflow: "hidden", pointerEvents: "auto" }}>
            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, fontWeight: 500 }}>{node.label}</div>
            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, opacity: 0.7 }}>{shortPath}</div>
          </div>
        ),
      },
      position: { x: (p?.x ?? 0) - NODE_W / 2, y: (p?.y ?? 0) - NODE_H / 2 },
      sourcePosition: Position.Right, targetPosition: Position.Left,
      style: { border: sel ? "3px solid #38bdf8" : "1px solid #475569", borderRadius: 8, fontSize: 11, background: bg, color: txt, boxShadow: sel ? "0 0 12px #38bdf8" : "none", cursor: "pointer", width: NODE_W, overflow: "hidden" },
    };
  });
  const edges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id, source: edge.source, target: edge.target, label: edge.kind,
    animated: edge.diffStatus === "added" || edge.diffStatus === "removed",
    style: { stroke: edge.diffStatus === "added" ? "#4ade80" : edge.diffStatus === "removed" ? "#f87171" : "#64748b", strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "#94a3b8" },
  }));
  return { nodes, edges };
};

const normPath = (v: string): string =>
  v.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");

const shortenPath = (filePath: string): string => {
  const parts = filePath.replace(/\\/g, "/").split("/");
  if (parts.length <= 3) return filePath;
  const firstDir = parts[0];
  const secondDir = parts[1];
  const fileName = parts[parts.length - 1];
  return `${firstDir}/${secondDir}/[...]/${fileName}`;
};

export const SplitGraphPanel = ({
  title, side, graph, viewType, onNodeSelect, viewport, onViewportChange, selectedNodeId, focusFilePath, diffStats, fileDiffs,
}: SplitGraphPanelProps) => {
  /******************* STORE ***********************/
  const [searchQuery, setSearchQuery] = useState("");
  const [searchExclude, setSearchExclude] = useState(false);
  const [searchIdx, setSearchIdx] = useState(0);

  /******************* COMPUTED ***********************/
  const isLogic = useMemo(() => viewType === "logic", [viewType]);
  const isOld = useMemo(() => side === "old", [side]);

  const fileContentMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!fileDiffs) return map;
    for (const f of fileDiffs) {
      const content = isOld ? f.oldContent : f.newContent;
      map.set(normPath(f.path), content);
    }
    return map;
  }, [fileDiffs, isOld]);

  /* Heavy layout: only recomputes when graph structure changes, NOT on selection */
  const layoutResult = useMemo(
    () => isLogic ? computeLogicLayout(graph, "", fileContentMap) : computeFlatLayout(graph, ""),
    [graph, isLogic, fileContentMap],
  );

  /* Light selection pass: just updates node styles */
  const flowElements = useMemo(() => {
    if (!selectedNodeId) return layoutResult;
    const nodes = layoutResult.nodes.map((node) => {
      const isSelected = node.id === selectedNodeId;
      if (!isSelected) return node;
      if (node.type === "scope" || node.type === "diamond" || node.type === "pill" || node.type === "process") {
        return { ...node, data: { ...node.data, selected: true } };
      }
      return { ...node, style: { ...(node.style ?? {}), border: "3px solid #38bdf8", boxShadow: "0 0 12px #38bdf8" } };
    });
    return { nodes, edges: layoutResult.edges };
  }, [layoutResult, selectedNodeId]);

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
      if (!matchIds.has(node.id)) return { ...node, style: { ...(node.style ?? {}), opacity: 0.25 } };
      return { ...node, style: { ...(node.style ?? {}), outline: "2px solid #fbbf24", outlineOffset: "2px" } };
    });
    return { nodes, edges: flowElements.edges };
  }, [flowElements, searchMatches, searchQuery, searchExclude]);

  const flowStyle = useMemo(() => ({ width: "100%", height: "100%" }), []);
  const stats = useMemo(() => {
    if (diffStats) return diffStats;
    return { added: graph.nodes.filter((n) => n.diffStatus === "added").length, removed: graph.nodes.filter((n) => n.diffStatus === "removed").length, modified: graph.nodes.filter((n) => n.diffStatus === "modified").length };
  }, [diffStats, graph.nodes]);
  const nodeTypesForFlow = useMemo(() => (isLogic ? logicNodeTypes : undefined), [isLogic]);

  const focusedViewport = useMemo(() => {
    if (!focusFilePath) return null;
    const nf = normPath(focusFilePath);
    const pts: Array<{ x: number; y: number }> = [];
    for (const n of flowElements.nodes) {
      const gn = graph.nodes.find((g) => g.id === n.id);
      if (gn && normPath(gn.filePath) === nf) pts.push(n.position);
    }
    if (pts.length === 0) return null;
    const ax = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const ay = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    return { x: -ax + 200, y: -ay + 150, zoom: 0.9 };
  }, [focusFilePath, flowElements.nodes, graph.nodes]);

  /******************* FUNCTIONS ***********************/
  const handleSearch = useCallback((q: string, exclude: boolean) => { setSearchQuery(q); setSearchExclude(exclude); setSearchIdx(0); }, []);
  const handleSearchNext = useCallback(() => {
    if (searchMatches.length === 0) return;
    const next = (searchIdx + 1) % searchMatches.length;
    setSearchIdx(next);
    const target = searchMatches[next];
    if (target) onViewportChange({ x: -target.position.x + 200, y: -target.position.y + 150, zoom: 0.9 });
  }, [searchMatches, searchIdx, onViewportChange]);
  const handleSearchPrev = useCallback(() => {
    if (searchMatches.length === 0) return;
    const prev = (searchIdx - 1 + searchMatches.length) % searchMatches.length;
    setSearchIdx(prev);
    const target = searchMatches[prev];
    if (target) onViewportChange({ x: -target.position.x + 200, y: -target.position.y + 150, zoom: 0.9 });
  }, [searchMatches, searchIdx, onViewportChange]);
  const handleNodeClick = useCallback<NodeMouseHandler>((_e, n) => { onNodeSelect(n.id); }, [onNodeSelect]);
  const handleMove = useCallback((_e: MouseEvent | TouchEvent | null, v: Viewport) => { onViewportChange({ x: v.x, y: v.y, zoom: v.zoom }); }, [onViewportChange]);

  /******************* USEEFFECTS ***********************/
  const prevFocusRef = useRef<string>("");
  useEffect(() => {
    if (focusFilePath && focusFilePath !== prevFocusRef.current && focusedViewport) {
      prevFocusRef.current = focusFilePath;
      onViewportChange(focusedViewport);
    }
  }, [focusFilePath, focusedViewport, onViewportChange]);

  return (
    <section className="panel">
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
      <div className="flowContainer">
        <ReactFlow
          nodes={searchResultNodes.nodes} edges={searchResultNodes.edges} nodeTypes={nodeTypesForFlow}
          onNodeClick={handleNodeClick} viewport={viewport} onMove={handleMove}
          style={flowStyle} onlyRenderVisibleElements
        >
          <Background />
          {!isOld && <Controls />}
          {!isOld && <MiniMap pannable zoomable />}
        </ReactFlow>
      </div>
    </section>
  );
};
