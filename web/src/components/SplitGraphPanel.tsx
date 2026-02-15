import { useMemo, useCallback, useEffect, useRef } from "react";
import {
  type EdgeMouseHandler,
  type Node,
  type NodeMouseHandler,
  type Viewport,
} from "@xyflow/react";
import { observer, useLocalObservable } from "mobx-react-lite";
import { buildCrossGraphNodeMatchKey } from "#/lib/nodeIdentity";
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
import { useFlowContainerSize } from "./splitGraph/useFlowContainerSize";
import { useSplitGraphLayoutWorker } from "./splitGraph/useSplitGraphLayoutWorker";
import {
  computeNodeAbsolutePosition,
  computeViewportForNode,
  isNodeVisibleInViewport as computeIsNodeVisibleInViewport,
} from "./splitGraph/viewport";
import type { GraphDiffTarget, InternalNodeAnchor, SplitGraphPanelProps, TopLevelAnchor } from "./splitGraph/types";

export type { AlignmentBreakpoint, GraphDiffTarget, InternalNodeAnchor, TopLevelAnchor } from "./splitGraph/types";

const SEARCH_FLASH_MS = 3200;
const SEARCH_FLASH_STYLE = {
  outline: "5px solid #ffffff",
  outlineOffset: "3px",
  boxShadow: "0 0 0 2px rgba(255,255,255,0.95), 0 0 28px rgba(255,255,255,0.92)",
  zIndex: 1000,
};

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

const resolveBreakpointDelta = (
  breakpoints: Array<{ sourceY: number; deltaY: number }> | undefined,
  sourceY: number,
): number => {
  if (!breakpoints || breakpoints.length === 0) return 0;
  // Keep a stable baseline before the first matched anchor, so newly inserted
  // nodes above it move with the same block shift instead of being overlapped.
  let delta = breakpoints[0]?.deltaY ?? 0;
  for (const bp of breakpoints) {
    if (sourceY + 0.5 >= bp.sourceY) {
      delta = bp.deltaY;
      continue;
    }
    break;
  }
  return delta;
};

export const SplitGraphPanel = observer(({
  title,
  side,
  graph,
  viewType,
  showCalls = true,
  diffStats,
  fileContentMap,
  alignmentOffset,
  alignmentAnchors,
  alignmentBreakpoints,
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
    focusFilePath,
    focusFileTick,
    hoveredNodeId,
    hoveredNodeMatchKey,
  } = runtimeState;
  const {
    onNodeSelect,
    onNodeHoverChange,
    onViewportChange,
    onDiffTargetsChange,
    onTopLevelAnchorsChange,
    onNodeAnchorsChange,
    onLayoutPendingChange,
  } = runtimeActions;
  const store = useLocalObservable(() => new SplitGraphPanelStore());
  const searchHighlightTimerRef = useRef<number | null>(null);
  const flowContainerRef = useRef<HTMLDivElement>(null);
  const lastAppliedFocusNodeTickRef = useRef(0);
  const lastAppliedFocusFileTickRef = useRef(0);
  const lastViewportRecoveryKeyRef = useRef("");
  const lastNodeAnchorSignatureRef = useRef("");
  const layoutResult = store.layoutResult;

  const isLogic = viewType === "logic";
  const isOld = side === "old";
  const fileEntries = useMemo(() => Array.from(fileContentMap.entries()), [fileContentMap]);

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

  const nodeMatchKeyById = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of graph.nodes) {
      if (node.kind === "group") continue;
      map.set(node.id, buildCrossGraphNodeMatchKey(node));
    }
    return map;
  }, [graph.nodes]);

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
    if (
      !isLogic
      || side !== "new"
      || !alignmentBreakpoints
      || Object.keys(alignmentBreakpoints).length === 0
      || topAlignedLayoutResult.nodes.length === 0
    ) {
      return topAlignedLayoutResult;
    }

    const nodeById = new Map(topAlignedLayoutResult.nodes.map((node) => [node.id, node]));
    const absoluteById = new Map<string, { x: number; y: number }>();
    for (const node of topAlignedLayoutResult.nodes) {
      absoluteById.set(node.id, computeNodeAbsolutePosition(node, nodeById));
    }

    const adjustedAbsYById = new Map<string, number>();
    for (const node of topAlignedLayoutResult.nodes) {
      const abs = absoluteById.get(node.id);
      if (!node.parentId) {
        adjustedAbsYById.set(node.id, abs?.y ?? node.position.y);
        continue;
      }
      const topKey = topKeyByNodeId.get(node.id);
      if (!abs || !topKey) {
        adjustedAbsYById.set(node.id, abs?.y ?? node.position.y);
        continue;
      }
      const breakpoints = alignmentBreakpoints[topKey];
      const deltaY = resolveBreakpointDelta(breakpoints, abs.y);
      adjustedAbsYById.set(node.id, abs.y + deltaY);
    }

    // Prevent upward drift that places inner nodes above their original top-content area.
    // We keep top-level group headers aligned and shift only descendants of that top group.
    const originalMinByTopKey = new Map<string, number>();
    const adjustedMinByTopKey = new Map<string, number>();
    for (const node of topAlignedLayoutResult.nodes) {
      if (!node.parentId) continue;
      const topKey = topKeyByNodeId.get(node.id);
      const originalAbs = absoluteById.get(node.id);
      const adjustedAbs = adjustedAbsYById.get(node.id);
      if (!topKey || originalAbs === undefined || adjustedAbs === undefined) continue;
      const originalMin = originalMinByTopKey.get(topKey);
      const adjustedMin = adjustedMinByTopKey.get(topKey);
      originalMinByTopKey.set(topKey, originalMin === undefined ? originalAbs.y : Math.min(originalMin, originalAbs.y));
      adjustedMinByTopKey.set(topKey, adjustedMin === undefined ? adjustedAbs : Math.min(adjustedMin, adjustedAbs));
    }

    const topCorrectionByTopKey = new Map<string, number>();
    for (const [topKey, originalMin] of originalMinByTopKey.entries()) {
      const adjustedMin = adjustedMinByTopKey.get(topKey);
      if (adjustedMin === undefined) continue;
      if (adjustedMin < originalMin - 0.5) {
        topCorrectionByTopKey.set(topKey, originalMin - adjustedMin);
      }
    }

    if (topCorrectionByTopKey.size > 0) {
      for (const node of topAlignedLayoutResult.nodes) {
        if (!node.parentId) continue;
        const topKey = topKeyByNodeId.get(node.id);
        if (!topKey) continue;
        const correction = topCorrectionByTopKey.get(topKey);
        if (!correction) continue;
        const prev = adjustedAbsYById.get(node.id);
        if (prev === undefined) continue;
        adjustedAbsYById.set(node.id, prev + correction);
      }
    }

    const nodes = topAlignedLayoutResult.nodes.map((node) => {
      const adjustedAbsY = adjustedAbsYById.get(node.id);
      if (adjustedAbsY === undefined) return node;
      if (!node.parentId) return node;
      const adjustedParentAbsY = adjustedAbsYById.get(node.parentId);
      if (adjustedParentAbsY === undefined) return node;
      const nextRelativeY = adjustedAbsY - adjustedParentAbsY;
      if (Math.abs(nextRelativeY - node.position.y) < 0.5) return node;
      return { ...node, position: { ...node.position, y: nextRelativeY } };
    });

    return { nodes, edges: topAlignedLayoutResult.edges };
  }, [alignmentBreakpoints, isLogic, side, topAlignedLayoutResult, topKeyByNodeId]);

  const positionedNodeById = useMemo(
    () => new Map(positionedLayoutResult.nodes.map((node) => [node.id, node])),
    [positionedLayoutResult.nodes],
  );

  const nodeIdsByMatchKey = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const node of positionedLayoutResult.nodes) {
      const matchKey = nodeMatchKeyById.get(node.id);
      if (!matchKey) continue;
      const list = map.get(matchKey) ?? [];
      list.push(node.id);
      map.set(matchKey, list);
    }
    return map;
  }, [nodeMatchKeyById, positionedLayoutResult.nodes]);

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
    if (graphNode.kind === "group") return "";
    return candidateId;
  }, [graphNodeById, hoveredNodeId, hoveredNodeMatchKey, nodeIdsByMatchKey, positionedNodeById]);

  const hoverNeighborhoodByNodeId = useMemo(() => {
    const neighborNodeIdsByNode = new Map<string, Set<string>>();
    const incidentEdgeIdsByNode = new Map<string, Set<string>>();
    for (const node of positionedLayoutResult.nodes) {
      if (!nodeMatchKeyById.has(node.id)) continue;
      neighborNodeIdsByNode.set(node.id, new Set());
      incidentEdgeIdsByNode.set(node.id, new Set());
    }

    for (const edge of positionedLayoutResult.edges) {
      if (neighborNodeIdsByNode.has(edge.source)) {
        neighborNodeIdsByNode.get(edge.source)?.add(edge.target);
        incidentEdgeIdsByNode.get(edge.source)?.add(edge.id);
      }
      if (neighborNodeIdsByNode.has(edge.target)) {
        neighborNodeIdsByNode.get(edge.target)?.add(edge.source);
        incidentEdgeIdsByNode.get(edge.target)?.add(edge.id);
      }
    }

    const index = new Map<string, { keepNodeIds: Set<string>; keepEdgeIds: Set<string> }>();
    for (const nodeId of neighborNodeIdsByNode.keys()) {
      const keepNodeIds = new Set<string>([nodeId]);
      for (const neighborId of neighborNodeIdsByNode.get(nodeId) ?? []) {
        if (nodeMatchKeyById.has(neighborId)) {
          keepNodeIds.add(neighborId);
        }
      }
      const keepEdgeIds = new Set<string>();
      for (const edge of positionedLayoutResult.edges) {
        if (keepNodeIds.has(edge.source) && keepNodeIds.has(edge.target)) {
          keepEdgeIds.add(edge.id);
        }
      }
      index.set(nodeId, { keepNodeIds, keepEdgeIds });
    }
    return index;
  }, [nodeMatchKeyById, positionedLayoutResult.edges, positionedLayoutResult.nodes]);

  const hoverNeighborhood = useMemo(() => {
    if (!hoveredNodeIdForPanel) return null;
    return hoverNeighborhoodByNodeId.get(hoveredNodeIdForPanel) ?? null;
  }, [hoverNeighborhoodByNodeId, hoveredNodeIdForPanel]);

  const flowElements = useMemo(() => {
    const hasNodeHighlights = Boolean(selectedNodeId || highlightedNodeId || store.searchHighlightedNodeId);
    const hasHoverNeighborhood = hoverNeighborhood !== null;
    const hasEdgeHover = store.hoveredEdgeId.length > 0;
    if (!hasNodeHighlights && !hasEdgeHover && !hasHoverNeighborhood) return positionedLayoutResult;

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
            : { ...node, style: { ...(node.style ?? {}), border: "3px solid #38bdf8", boxShadow: "0 0 12px #38bdf8" } };
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

    const edges = (hasEdgeHover || hasHoverNeighborhood)
      ? positionedLayoutResult.edges.map((edge) => {
        const isHovered = edge.id === store.hoveredEdgeId;
        const isInHoverNeighborhood = Boolean(hasHoverNeighborhood && hoverNeighborhood?.keepEdgeIds.has(edge.id));
        if (!isHovered && !isInHoverNeighborhood && !hasEdgeHover) return edge;
        const baseStyle = edge.style ?? {};
        const baseLabelStyle = edge.labelStyle ?? {};
        const baseLabelBgStyle = edge.labelBgStyle ?? {};
        const baseStrokeWidth =
          typeof baseStyle.strokeWidth === "number"
            ? baseStyle.strokeWidth
            : Number(baseStyle.strokeWidth ?? 1.5);
        const nextStrokeWidth = isHovered
          ? Math.max(baseStrokeWidth + 1.8, 3)
          : isInHoverNeighborhood
            ? Math.max(baseStrokeWidth + 0.8, 2.2)
            : baseStrokeWidth;
        const nextStrokeOpacity = isHovered
          ? 1
          : isInHoverNeighborhood
            ? 1
            : 0.24;
        const nextLabelOpacity = isHovered
          ? 1
          : isInHoverNeighborhood
            ? 1
            : 0.35;
        const nextStroke = isHovered
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
            filter: isHovered
              ? "drop-shadow(0 0 6px rgba(248,250,252,0.9))"
              : isInHoverNeighborhood
                ? "drop-shadow(0 0 6px rgba(192,132,252,0.8))"
                : baseStyle.filter,
          },
          labelStyle: {
            ...baseLabelStyle,
            fill: isHovered ? "#ffffff" : isInHoverNeighborhood ? "#f3e8ff" : baseLabelStyle.fill,
            opacity: nextLabelOpacity,
          },
          labelBgStyle: {
            ...baseLabelBgStyle,
            fillOpacity: isHovered ? 0.98 : isInHoverNeighborhood ? 0.68 : 0.5,
            stroke: isHovered ? "#f8fafc" : isInHoverNeighborhood ? "#c084fc" : baseLabelBgStyle.stroke,
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
    store.hoveredEdgeId,
    store.searchHighlightedNodeId,
  ]);

  const searchMatches = useMemo(() => {
    if (!store.searchQuery || store.searchQuery.length < 2) return [];
    const q = store.searchQuery.toLowerCase();
    return flowElements.nodes.filter((n) => {
      const gn = graph.nodes.find((g) => g.id === n.id);
      const text = `${gn?.label ?? ""} ${gn?.filePath ?? ""} ${gn?.kind ?? ""}`.toLowerCase();
      const matches = text.includes(q);
      return store.searchExclude ? !matches : matches;
    });
  }, [store.searchQuery, store.searchExclude, flowElements.nodes, graph.nodes]);

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

  const nodeTypesForFlow = isLogic ? logicNodeTypes : knowledgeNodeTypes;
  const hasInputNodes = graph.nodes.length > 0;
  const hasRenderedNodes = positionedLayoutResult.nodes.length > 0;
  const showLayoutStatus = hasInputNodes && !hasRenderedNodes && store.layoutPending;

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
    if (searchMatches.length === 0) return;
    const next = (store.searchIdx + 1) % searchMatches.length;
    store.setSearchIdx(next);
    const target = searchMatches[next];
    if (target) {
      flashSearchTarget(target.id);
      onViewportChange(viewportForNode(target));
    }
  }, [searchMatches, store, flashSearchTarget, onViewportChange, viewportForNode]);

  const handleSearchPrev = useCallback(() => {
    if (searchMatches.length === 0) return;
    const prev = (store.searchIdx - 1 + searchMatches.length) % searchMatches.length;
    store.setSearchIdx(prev);
    const target = searchMatches[prev];
    if (target) {
      flashSearchTarget(target.id);
      onViewportChange(viewportForNode(target));
    }
  }, [searchMatches, store, flashSearchTarget, onViewportChange, viewportForNode]);

  const handleNodeClick = useCallback<NodeMouseHandler>((_event, node) => {
    onNodeSelect(node.id, side);
  }, [onNodeSelect, side]);

  const handleNodeMouseEnter = useCallback<NodeMouseHandler>((_event, node) => {
    const graphNode = graphNodeById.get(node.id);
    if (!graphNode || graphNode.kind === "group") return;
    onNodeHoverChange(side, node.id, nodeMatchKeyById.get(node.id) ?? "");
  }, [graphNodeById, nodeMatchKeyById, onNodeHoverChange, side]);

  const handleNodeMouseLeave = useCallback<NodeMouseHandler>(() => {
    onNodeHoverChange(side, "", "");
  }, [onNodeHoverChange, side]);

  const handleEdgeMouseEnter = useCallback<EdgeMouseHandler>((_event, edge) => {
    store.setHoveredEdgeId(edge.id);
  }, [store]);

  const handleEdgeMouseLeave = useCallback<EdgeMouseHandler>(() => {
    store.setHoveredEdgeId("");
  }, [store]);

  const handlePaneMouseLeave = useCallback(() => {
    store.setHoveredEdgeId("");
    onNodeHoverChange(side, "", "");
  }, [onNodeHoverChange, side, store]);

  const handleMove = useCallback((_event: MouseEvent | TouchEvent | null, nextViewport: Viewport) => {
    onViewportChange({ x: nextViewport.x, y: nextViewport.y, zoom: nextViewport.zoom });
  }, [onViewportChange]);

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
  }, []);

  useEffect(() => {
    if (!focusFilePath || !focusedViewport || focusFileTick <= 0) return;
    if (focusFileTick === lastAppliedFocusFileTickRef.current) return;
    lastAppliedFocusFileTickRef.current = focusFileTick;
    onViewportChange(focusedViewport);
  }, [focusFilePath, focusFileTick, focusedViewport, onViewportChange]);

  const isNodeVisibleInViewport = useCallback((node: Node): boolean => {
    return computeIsNodeVisibleInViewport(node, flowNodeById, store.flowSize, viewport);
  }, [flowNodeById, store.flowSize, viewport]);

  useEffect(() => {
    if (!isViewportPrimary) return;
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
    const target = (
      flowElements.nodes.find((node) => node.id === preferredId)
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
    viewportForNode,
  ]);

  useEffect(() => {
    if (!focusNodeId) return;
    if ((focusNodeTick ?? 0) <= 0) return;
    if (focusSourceSide && focusSourceSide !== side) return;
    if (store.layoutPending) return;
    if ((focusNodeTick ?? 0) === lastAppliedFocusNodeTickRef.current) return;
    const target = flowElements.nodes.find((node) => node.id === focusNodeId);
    if (!target) return;
    onViewportChange(viewportForNode(target));
    lastAppliedFocusNodeTickRef.current = focusNodeTick ?? 0;
  }, [
    focusNodeId,
    focusNodeTick,
    focusSourceSide,
    flowElements.nodes,
    onViewportChange,
    side,
    store.layoutPending,
    viewportForNode,
  ]);

  useEffect(() => {
    store.setHoveredEdgeId("");
  }, [graph.nodes, graph.edges, viewType, showCalls, store]);

  return (
    <section className={store.searchHighlightedNodeId ? "panel panelSearchFlash" : "panel"}>
      <GraphPanelHeader
        title={title}
        isOld={isOld}
        stats={stats}
        searchMatchCount={searchMatches.length}
        searchIndex={store.searchIdx}
        onSearch={handleSearch}
        onSearchNext={handleSearchNext}
        onSearchPrev={handleSearchPrev}
      />
      {showLayoutStatus && (
        <div className="layoutStatusBanner" role="status" aria-live="polite">
          <div className="spinner layoutStatusSpinner" />
          <span className="dimText">Building graph layout...</span>
        </div>
      )}
      {!showLayoutStatus && !hasInputNodes && (
        <p className="dimText" style={{ marginTop: 6, marginBottom: 0 }}>No nodes for current file/filters.</p>
      )}
      <GraphCanvas
        side={side}
        isOld={isOld}
        nodes={searchResultNodes.nodes}
        edges={searchResultNodes.edges}
        nodeTypes={nodeTypesForFlow}
        viewport={viewport}
        flowContainerRef={flowContainerRef}
        minimapNodeColor={minimapNodeColor}
        minimapNodeStrokeColor={minimapNodeStrokeColor}
        onNodeClick={handleNodeClick}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
        onEdgeMouseEnter={handleEdgeMouseEnter}
        onEdgeMouseLeave={handleEdgeMouseLeave}
        onPaneMouseLeave={handlePaneMouseLeave}
        onMove={handleMove}
      />
    </section>
  );
});
