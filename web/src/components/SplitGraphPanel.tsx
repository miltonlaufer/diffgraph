import { useMemo, useCallback, useEffect, useRef } from "react";
import {
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeMouseHandler,
  type Viewport,
} from "@xyflow/react";
import { observer, useLocalObservable } from "mobx-react-lite";
import type { LayoutWorkerRequest, LayoutWorkerResponse } from "../workers/layoutTypes";
import { GraphCanvas } from "./splitGraph/GraphCanvas";
import { GraphPanelHeader } from "./splitGraph/GraphPanelHeader";
import { computeLayoutByView, knowledgeNodeTypes, LEAF_H, LEAF_W, logicNodeTypes, normPath, stableNodeKey } from "./splitGraph/layout";
import { SplitGraphPanelStore } from "./splitGraph/store";
import type { GraphDiffTarget, SplitGraphPanelProps, TopLevelAnchor } from "./splitGraph/types";

export type { GraphDiffTarget, TopLevelAnchor } from "./splitGraph/types";

const SEARCH_FLASH_MS = 3200;
const SEARCH_FLASH_STYLE = {
  outline: "5px solid #ffffff",
  outlineOffset: "3px",
  boxShadow: "0 0 0 2px rgba(255,255,255,0.95), 0 0 28px rgba(255,255,255,0.92)",
  zIndex: 1000,
};

export const SplitGraphPanel = observer(({
  title,
  side,
  graph,
  viewType,
  showCalls = true,
  onNodeSelect,
  viewport,
  onViewportChange,
  selectedNodeId,
  highlightedNodeId,
  focusNodeId,
  focusNodeTick,
  focusFilePath,
  focusFileTick = 0,
  diffStats,
  fileContentMap,
  onDiffTargetsChange,
  alignmentOffset,
  alignmentAnchors,
  onTopLevelAnchorsChange,
}: SplitGraphPanelProps) => {
  const store = useLocalObservable(() => new SplitGraphPanelStore());
  const searchHighlightTimerRef = useRef<number | null>(null);
  const flowContainerRef = useRef<HTMLDivElement>(null);
  const layoutWorkerRef = useRef<Worker | null>(null);
  const layoutRequestIdRef = useRef(0);
  const layoutWatchdogTimerRef = useRef<number | null>(null);
  const lastAppliedFocusNodeSignatureRef = useRef("");
  const lastAppliedFocusFileTickRef = useRef(0);

  const isLogic = viewType === "logic";
  const isOld = side === "old";
  const fileEntries = useMemo(() => Array.from(fileContentMap.entries()), [fileContentMap]);

  const computeLayoutSync = useCallback(
    () => computeLayoutByView(viewType, graph, "", fileContentMap, showCalls),
    [viewType, graph, fileContentMap, showCalls],
  );

  const positionedLayoutResult = useMemo(() => {
    const { layoutResult } = store;
    if (!alignmentOffset && !alignmentAnchors) return layoutResult;
    const graphNodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    const nodes = layoutResult.nodes.map((node) => ({
      ...node,
      position: {
        x: (() => {
          if (node.parentId) return node.position.x;
          const graphNode = graphNodeById.get(node.id);
          if (graphNode && graphNode.kind === "group" && alignmentAnchors) {
            const anchored = alignmentAnchors[stableNodeKey(graphNode)];
            if (anchored) return anchored.x;
          }
          return alignmentOffset ? node.position.x + alignmentOffset.x : node.position.x;
        })(),
        y: (() => {
          if (node.parentId) return node.position.y;
          const graphNode = graphNodeById.get(node.id);
          if (graphNode && graphNode.kind === "group" && alignmentAnchors) {
            const anchored = alignmentAnchors[stableNodeKey(graphNode)];
            if (anchored) return anchored.y;
          }
          return alignmentOffset ? node.position.y + alignmentOffset.y : node.position.y;
        })(),
      },
    }));
    return { nodes, edges: layoutResult.edges };
  }, [store, alignmentAnchors, alignmentOffset, graph.nodes]);

  const flowElements = useMemo(() => {
    const hasNodeHighlights = Boolean(selectedNodeId || highlightedNodeId || store.searchHighlightedNodeId);
    const hasEdgeHover = store.hoveredEdgeId.length > 0;
    if (!hasNodeHighlights && !hasEdgeHover) return positionedLayoutResult;

    const nodes = hasNodeHighlights
      ? positionedLayoutResult.nodes.map((node) => {
        const isSearchTarget = node.id === store.searchHighlightedNodeId;
        const isSelected = node.id === selectedNodeId || node.id === highlightedNodeId || isSearchTarget;
        if (!isSelected) return node;
        const baseNode = (node.type === "scope" || node.type === "diamond" || node.type === "pill" || node.type === "process" || node.type === "knowledge")
          ? { ...node, data: { ...node.data, selected: true } }
          : { ...node, style: { ...(node.style ?? {}), border: "3px solid #38bdf8", boxShadow: "0 0 12px #38bdf8" } };
        if (!isSearchTarget) {
          return baseNode;
        }
        return { ...baseNode, style: { ...(baseNode.style ?? {}), ...SEARCH_FLASH_STYLE } };
      })
      : positionedLayoutResult.nodes;

    const edges = hasEdgeHover
      ? positionedLayoutResult.edges.map((edge) => {
        const isHovered = edge.id === store.hoveredEdgeId;
        const baseStyle = edge.style ?? {};
        const baseLabelStyle = edge.labelStyle ?? {};
        const baseLabelBgStyle = edge.labelBgStyle ?? {};
        const baseStrokeWidth =
          typeof baseStyle.strokeWidth === "number"
            ? baseStyle.strokeWidth
            : Number(baseStyle.strokeWidth ?? 1.5);
        return {
          ...edge,
          style: {
            ...baseStyle,
            stroke: isHovered ? "#f8fafc" : baseStyle.stroke,
            strokeWidth: isHovered ? Math.max(baseStrokeWidth + 1.8, 3) : baseStrokeWidth,
            strokeOpacity: isHovered ? 1 : 0.24,
            filter: isHovered ? "drop-shadow(0 0 6px rgba(248,250,252,0.9))" : baseStyle.filter,
          },
          labelStyle: {
            ...baseLabelStyle,
            fill: isHovered ? "#ffffff" : baseLabelStyle.fill,
            opacity: isHovered ? 1 : 0.35,
          },
          labelBgStyle: {
            ...baseLabelBgStyle,
            fillOpacity: isHovered ? 0.98 : 0.5,
            stroke: isHovered ? "#f8fafc" : baseLabelBgStyle.stroke,
          },
        };
      })
      : positionedLayoutResult.edges;

    return { nodes, edges };
  }, [positionedLayoutResult, selectedNodeId, highlightedNodeId, store.searchHighlightedNodeId, store.hoveredEdgeId]);

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
    if (node.type === "knowledge") return { width: 220, height: 56 };
    if (node.type === "scope") return { width: LEAF_W, height: LEAF_H };
    return { width: LEAF_W, height: LEAF_H };
  }, []);

  const viewportForNode = useCallback((node: Node): { x: number; y: number; zoom: number } => {
    const zoom = 0.9;
    const padding = 24;
    const abs = nodeAbsolutePosition(node);
    const size = nodeSize(node);
    const worldVisibleW = store.flowSize.width / zoom;
    const worldVisibleH = store.flowSize.height / zoom;
    const tooLarge = size.width > worldVisibleW * 0.8 || size.height > worldVisibleH * 0.8;

    if (tooLarge) {
      const centerX = abs.x + size.width / 2;
      const anchorWorldY = abs.y - padding;
      return {
        x: store.flowSize.width / 2 - centerX * zoom,
        y: padding - anchorWorldY * zoom,
        zoom,
      };
    }

    const centerX = abs.x + size.width / 2;
    const centerY = abs.y + size.height / 2;
    return {
      x: store.flowSize.width / 2 - centerX * zoom,
      y: store.flowSize.height / 2 - centerY * zoom,
      zoom,
    };
  }, [store.flowSize.width, store.flowSize.height, nodeAbsolutePosition, nodeSize]);

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

  const handleEdgeMouseEnter = useCallback<EdgeMouseHandler>((_event, edge) => {
    store.setHoveredEdgeId(edge.id);
  }, [store]);

  const handleEdgeMouseLeave = useCallback<EdgeMouseHandler>(() => {
    store.setHoveredEdgeId("");
  }, [store]);

  const handleMove = useCallback((_event: MouseEvent | TouchEvent | null, nextViewport: Viewport) => {
    onViewportChange({ x: nextViewport.x, y: nextViewport.y, zoom: nextViewport.zoom });
  }, [onViewportChange]);

  useEffect(() => {
    const worker = new Worker(new URL("../workers/layoutWorker.ts", import.meta.url), { type: "module" });
    layoutWorkerRef.current = worker;

    const handleMessage = (event: MessageEvent<LayoutWorkerResponse>): void => {
      const data = event.data;
      if (data.requestId !== layoutRequestIdRef.current) return;
      if (layoutWatchdogTimerRef.current !== null) {
        window.clearTimeout(layoutWatchdogTimerRef.current);
        layoutWatchdogTimerRef.current = null;
      }
      if (!data.ok) {
        store.setLayoutPending(false);
        store.setWorkerFailed(true);
        return;
      }
      store.setLayoutPending(false);
      store.setLayoutResult({ nodes: data.result.nodes as Node[], edges: data.result.edges as Edge[] });
    };

    const handleError = (): void => {
      if (layoutWatchdogTimerRef.current !== null) {
        window.clearTimeout(layoutWatchdogTimerRef.current);
        layoutWatchdogTimerRef.current = null;
      }
      store.setLayoutPending(false);
      store.setWorkerFailed(true);
    };

    worker.addEventListener("message", handleMessage as EventListener);
    worker.addEventListener("error", handleError as EventListener);
    store.setWorkerReady(true);

    return () => {
      worker.removeEventListener("message", handleMessage as EventListener);
      worker.removeEventListener("error", handleError as EventListener);
      worker.terminate();
      if (layoutWatchdogTimerRef.current !== null) {
        window.clearTimeout(layoutWatchdogTimerRef.current);
        layoutWatchdogTimerRef.current = null;
      }
      layoutWorkerRef.current = null;
      store.setWorkerReady(false);
    };
  }, [store]);

  useEffect(() => {
    const requestId = layoutRequestIdRef.current + 1;
    layoutRequestIdRef.current = requestId;

    if (store.workerFailed) {
      store.setLayoutPending(true);
      const fallbackTimer = window.setTimeout(() => {
        if (requestId !== layoutRequestIdRef.current) return;
        try {
          store.setLayoutResult(computeLayoutSync());
        } catch {
          store.setWorkerFailed(true);
        }
        store.setLayoutPending(false);
      }, 0);
      return () => {
        window.clearTimeout(fallbackTimer);
      };
    }

    if (!store.workerReady || !layoutWorkerRef.current) return;

    const payload: LayoutWorkerRequest = {
      requestId,
      graph,
      viewType,
      showCalls,
      fileEntries,
    };
    store.setLayoutPending(true);
    if (layoutWatchdogTimerRef.current !== null) {
      window.clearTimeout(layoutWatchdogTimerRef.current);
    }
    layoutWatchdogTimerRef.current = window.setTimeout(() => {
      if (requestId !== layoutRequestIdRef.current) return;
      if (store.layoutResult.nodes.length > 0) return;
      store.setLayoutPending(false);
      store.setWorkerFailed(true);
    }, 8000);
    layoutWorkerRef.current.postMessage(payload);
  }, [computeLayoutSync, fileEntries, graph, showCalls, store, viewType, store.workerFailed, store.workerReady]);

  useEffect(() => {
    const el = flowContainerRef.current;
    if (!el) return;
    const update = (): void => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        store.setFlowSize({ width: rect.width, height: rect.height });
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
  }, [store]);

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
          kind: gn.kind,
        } as GraphDiffTarget;
      })
      .filter((entry): entry is GraphDiffTarget => entry !== null);
    onDiffTargetsChange(side, targets);
  }, [onDiffTargetsChange, side, graph.nodes, flowElements.nodes, nodeAbsolutePosition, viewportForNode]);

  useEffect(() => {
    if (!onTopLevelAnchorsChange) return;
    const graphNodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    const anchors: Record<string, TopLevelAnchor> = {};
    for (const node of store.layoutResult.nodes) {
      if (node.parentId) continue;
      const gn = graphNodeById.get(node.id);
      if (!gn || gn.kind !== "group") continue;
      const width = typeof node.style?.width === "number" ? node.style.width : LEAF_W;
      const height = typeof node.style?.height === "number" ? node.style.height : LEAF_H;
      anchors[stableNodeKey(gn)] = { x: node.position.x, y: node.position.y, width, height };
    }
    onTopLevelAnchorsChange(side, anchors);
  }, [graph.nodes, store.layoutResult.nodes, onTopLevelAnchorsChange, side]);

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

  useEffect(() => {
    if (!focusNodeId) return;
    if ((focusNodeTick ?? 0) <= 0) return;
    const target = flowElements.nodes.find((node) => node.id === focusNodeId);
    if (!target) return;
    const abs = nodeAbsolutePosition(target);
    const signature = `${focusNodeTick ?? 0}:${focusNodeId}:${Math.round(abs.x)}:${Math.round(abs.y)}:${flowElements.nodes.length}`;
    if (signature === lastAppliedFocusNodeSignatureRef.current) return;
    lastAppliedFocusNodeSignatureRef.current = signature;
    onViewportChange(viewportForNode(target));
  }, [focusNodeId, focusNodeTick, flowElements.nodes, nodeAbsolutePosition, onViewportChange, viewportForNode]);

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
      {store.layoutPending && graph.nodes.length > 0 && (
        <p className="dimText" style={{ marginTop: 6, marginBottom: 0 }}>Laying out graph...</p>
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
        onEdgeMouseEnter={handleEdgeMouseEnter}
        onEdgeMouseLeave={handleEdgeMouseLeave}
        onPaneMouseLeave={() => store.setHoveredEdgeId("")}
        onMove={handleMove}
      />
    </section>
  );
});
