import { useMemo, useCallback, useEffect, useRef, useState } from "react";
import {
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeMouseHandler,
  type Viewport,
} from "@xyflow/react";
import { observer } from "mobx-react-lite";
import { GraphCanvas } from "./splitGraph/GraphCanvas";
import GraphLogicTreeModal from "./GraphLogicTreeModal";
import { useSplitGraphRuntime } from "./splitGraph/context";
import { GraphPanelHeader } from "./splitGraph/GraphPanelHeader";
import {
  buildIndexedMatchKeyByNodeId,
  hasActivePointerEvent,
  hasDebugEdgesFlag,
  hasViewportDelta,
  isGroupHeaderTarget,
  isWheelEvent,
  oneLine,
  structuralAnchorKey,
  type PanelViewport,
} from "./splitGraph/helpers";
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
import { resolveSiblingBlockOverlaps } from "./splitGraph/overlapLayout";
import { useDebouncedValue } from "./useDebouncedValue";
import { SplitGraphPanelStore } from "./splitGraph/store";
import { useSplitGraphDerivedWorker } from "./splitGraph/useSplitGraphDerivedWorker";
import { useFlowContainerSize } from "./splitGraph/useFlowContainerSize";
import { useSplitGraphLayoutWorker } from "./splitGraph/useSplitGraphLayoutWorker";
import {
  computeNodeAbsolutePosition,
  computeViewportForNode,
  isNodeVisibleInViewport as computeIsNodeVisibleInViewport,
} from "./splitGraph/viewport";
import { EdgeDebugOverlay } from "./splitGraph/EdgeDebugOverlay";
import { EdgeTooltipOverlay } from "./splitGraph/EdgeTooltipOverlay";
import { useAskLlmPrompt } from "./splitGraph/useAskLlmPrompt";
import { useFlowElementsHighlighting, SEARCH_FLASH_STYLE } from "./splitGraph/useFlowElementsHighlighting";
import { useSplitGraphPanelSearch } from "./splitGraph/useSplitGraphPanelSearch";
import type { GraphDiffTarget, InternalNodeAnchor, SplitGraphPanelProps, TopLevelAnchor } from "./splitGraph/types";

export type { AlignmentBreakpoint, GraphDiffTarget, InternalNodeAnchor, TopLevelAnchor } from "./splitGraph/types";

const EDGE_CLICK_HIGHLIGHT_MS = 5000;

export const SplitGraphPanel = observer(({
  title,
  side,
  graph,
  counterpartGraph,
  showCalls = true,
  fileContentMap,
  counterpartFileContentMap,
  alignmentOffset,
  alignmentAnchors,
  alignmentBreakpoints,
  isViewportPrimary = true,
}: SplitGraphPanelProps) => {
  const { state: runtimeState, actions: runtimeActions } = useSplitGraphRuntime();
  const {
    viewport,
    viewType,
    pullRequestDescriptionExcerpt,
    diffStats,
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
    areNodesSelected,
    hoveredNodeId,
    hoveredNodeMatchKey,
    hoveredNodeSide,
    hoveredFilePathFromList: _hoveredFilePathFromList,
  } = runtimeState;
  const {
    onInteractionClick,
    onGraphNodeFocus,
    onNodeSelect,
    onOpenCodeLogicTree,
    onNodeHoverChange,
    onViewportChange,
    onDiffTargetsChange,
    onTopLevelAnchorsChange,
    onNodeAnchorsChange,
    onLayoutPendingChange,
    onSearchStateChange,
  } = runtimeActions;
  const store = useMemo(() => SplitGraphPanelStore.create({}), []);
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
  const [graphLogicTreeModal, setGraphLogicTreeModal] = useState<{
    openerNodeId: string;
    nodes: Node[];
    edges: Edge[];
  } | null>(null);
  const layoutResult = store.layoutResult;
  const effectiveViewport = viewportOverride ?? viewport;
  const debouncedSearchQuery = useDebouncedValue(store.searchQuery, 200);

  const isLogic = viewType === "logic";
  const isOld = side === "old";
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
  const counterpartNodes = useMemo(
    () => counterpartGraph?.nodes ?? [],
    [counterpartGraph?.nodes],
  );
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

  const askLlmParams = useMemo(
    () => ({
      side,
      graph,
      graphNodeById,
      counterpartNodeById,
      indexedMatchKeyByNodeId,
      counterpartNodeIdByIndexedMatchKey,
      fileContentMap,
      counterpartFileContentMap: counterpartFileContentMap ?? new Map(),
      fileLinesCacheRef,
      counterpartFileLinesCacheRef,
      pullRequestDescriptionExcerpt: pullRequestDescriptionExcerpt ?? "",
    }),
    [
      side,
      graph,
      graphNodeById,
      counterpartNodeById,
      indexedMatchKeyByNodeId,
      counterpartNodeIdByIndexedMatchKey,
      fileContentMap,
      counterpartFileContentMap,
      fileLinesCacheRef,
      counterpartFileLinesCacheRef,
      pullRequestDescriptionExcerpt,
    ],
  );
  const { handleAskLlmForNode, handleAskLlmHrefForNode } = useAskLlmPrompt(askLlmParams);

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
  }, [alignmentBreakpoints, isLogic, side, topAlignedLayoutResult]);

  const positionedNodeById = useMemo(
    () => new Map(positionedLayoutResult.nodes.map((node) => [node.id, node])),
    [positionedLayoutResult.nodes],
  );

  const graphEdgeById = useMemo(
    () => new Map(graph.edges.map((edge) => [edge.id, edge])),
    [graph.edges],
  );

  const splitGraphDerivedInput = useMemo(
    () => ({
      graphNodes: graph.nodes,
      positionedNodeIds: positionedLayoutResult.nodes.map((node) => node.id),
      positionedEdges: positionedLayoutResult.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        relation: graphEdgeById.get(edge.id)?.relation,
      })),
      searchQuery: debouncedSearchQuery,
      searchExclude: store.searchExclude,
    }),
    [debouncedSearchQuery, graph.nodes, graphEdgeById, positionedLayoutResult.edges, positionedLayoutResult.nodes, store.searchExclude],
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

  const handleGroupHeaderHoverChange = useCallback((nodeId: string, isHovering: boolean) => {
    const graphNode = graphNodeById.get(nodeId);
    if (!graphNode || graphNode.kind !== "group") return;
    if (isHovering) {
      onNodeHoverChange(side, nodeId, nodeMatchKeyById.get(nodeId) ?? "");
      return;
    }
    if (hoveredNodeId === nodeId) {
      onNodeHoverChange(side, "", "");
    }
  }, [graphNodeById, hoveredNodeId, nodeMatchKeyById, onNodeHoverChange, side]);

  const hoverNeighborhoodByNodeId = useMemo(() => {
    const map = new Map<string, {
      keepNodeIds: Set<string>;
      keepEdgeIds: Set<string>;
      directNodeIds: Set<string>;
      directEdgeIds: Set<string>;
      ancestorNodeIds: Set<string>;
      ancestorEdgeIds: Set<string>;
    }>();
    for (const entry of splitGraphDerived.hoverNeighborhoodByNodeIdEntries) {
      map.set(entry.nodeId, {
        keepNodeIds: new Set(entry.keepNodeIds),
        keepEdgeIds: new Set(entry.keepEdgeIds),
        directNodeIds: new Set(entry.directNodeIds),
        directEdgeIds: new Set(entry.directEdgeIds),
        ancestorNodeIds: new Set(entry.ancestorNodeIds),
        ancestorEdgeIds: new Set(entry.ancestorEdgeIds),
      });
    }
    return map;
  }, [splitGraphDerived.hoverNeighborhoodByNodeIdEntries]);

  const hoverNeighborhoodSeedId = useMemo(() => {
    if (hoveredNodeIdForPanel) return hoveredNodeIdForPanel;
    const searchNodeId = store.searchHighlightedNodeId;
    if (searchNodeId && positionedNodeById.has(searchNodeId)) return searchNodeId;
    if (highlightedNodeId && positionedNodeById.has(highlightedNodeId)) return highlightedNodeId;
    if (selectedNodeId && positionedNodeById.has(selectedNodeId)) return selectedNodeId;
    return "";
  }, [highlightedNodeId, hoveredNodeIdForPanel, positionedNodeById, selectedNodeId, store.searchHighlightedNodeId]);

  const hoverNeighborhood = useMemo(() => {
    if (!hoverNeighborhoodSeedId) return null;
    return hoverNeighborhoodByNodeId.get(hoverNeighborhoodSeedId) ?? null;
  }, [hoverNeighborhoodByNodeId, hoverNeighborhoodSeedId]);

  const logicTreeNodeIdsForNode = useCallback((nodeId: string): string[] => {
    const seedNode = graphNodeById.get(nodeId);
    if (!seedNode) return [];

    const relatedIds = new Set<string>([nodeId]);
    const neighborhood = hoverNeighborhoodByNodeId.get(nodeId);
    if (neighborhood) {
      for (const directId of neighborhood.directNodeIds) relatedIds.add(directId);
      for (const ancestorId of neighborhood.ancestorNodeIds) relatedIds.add(ancestorId);
    }

    const queue = [...relatedIds];
    while (queue.length > 0) {
      const currentId = queue.pop();
      if (!currentId) continue;
      const parentId = graphNodeById.get(currentId)?.parentId;
      if (!parentId || relatedIds.has(parentId)) continue;
      relatedIds.add(parentId);
      queue.push(parentId);
    }

    return [...relatedIds];
  }, [graphNodeById, hoverNeighborhoodByNodeId]);

  const codeLogicTreeLinesForNode = useCallback((nodeId: string): number[] => {
    const seedNode = graphNodeById.get(nodeId);
    if (!seedNode) return [];
    const targetFilePath = normPath(seedNode.filePath);
    if (!targetFilePath) return [];

    const relatedIds = logicTreeNodeIdsForNode(nodeId);

    const lines = new Set<number>();
    for (const relatedId of relatedIds) {
      const relatedNode = graphNodeById.get(relatedId);
      if (!relatedNode || relatedNode.kind === "group") continue;
      if (normPath(relatedNode.filePath) !== targetFilePath) continue;
      const start = relatedNode.startLine ?? 0;
      if (start < 1) continue;
      const end = Math.max(start, relatedNode.endLine ?? start);
      for (let line = start; line <= end; line += 1) {
        lines.add(line);
      }
    }

    return [...lines].sort((a, b) => a - b);
  }, [graphNodeById, logicTreeNodeIdsForNode]);

  const handleShowCodeLogicTreeForNode = useCallback((nodeId: string) => {
    if (!onOpenCodeLogicTree) return;
    const lineNumbers = codeLogicTreeLinesForNode(nodeId);
    onOpenCodeLogicTree(nodeId, side, lineNumbers);
  }, [codeLogicTreeLinesForNode, onOpenCodeLogicTree, side]);

  const handleShowGraphLogicTreeForNode = useCallback((nodeId: string) => {
    const logicTreeNodeIds = logicTreeNodeIdsForNode(nodeId);
    if (logicTreeNodeIds.length === 0) return;
    const logicTreeNodeIdSet = new Set(logicTreeNodeIds);
    const treeGraph = {
      nodes: graph.nodes.filter((node) => logicTreeNodeIdSet.has(node.id)),
      edges: graph.edges.filter((edge) => logicTreeNodeIdSet.has(edge.source) && logicTreeNodeIdSet.has(edge.target)),
    };
    if (treeGraph.nodes.length === 0) return;
    const treeLayout = computeLayoutByView(viewType, treeGraph, nodeId, fileContentMap, showCalls);
    const modalNodes = treeLayout.nodes.map((node) => ({
      ...node,
      data: {
        ...(node.data as Record<string, unknown>),
        hideCodeTooltip: false,
      },
    }));
    setGraphLogicTreeModal({
      openerNodeId: nodeId,
      nodes: modalNodes,
      edges: treeLayout.edges,
    });
  }, [fileContentMap, graph.edges, graph.nodes, logicTreeNodeIdsForNode, showCalls, viewType]);

  const closeGraphLogicTreeModal = useCallback(() => {
    setGraphLogicTreeModal(null);
  }, []);

  const handleGraphLogicTreeNodeClick = useCallback(() => {
    if (!graphLogicTreeModal) return;
    setGraphLogicTreeModal(null);
    onNodeSelect(graphLogicTreeModal.openerNodeId, side);
  }, [graphLogicTreeModal, onNodeSelect, side]);

  const hoveredFileNodeIds = useMemo(() => {
    // Commented out: file list hover not working correctly
    // if (!hoveredFilePathFromList) return new Set<string>();
    // const normalizedFilePath = normPath(hoveredFilePathFromList);
    // return new Set(
    //   graph.nodes
    //     .filter((gn) => normPath(gn.filePath) === normalizedFilePath)
    //     .map((gn) => gn.id),
    // );
    return new Set<string>();
  }, []);

  const flowElements = useFlowElementsHighlighting({
    positionedLayoutResult,
    graphNodeById,
    selectedNodeId: selectedNodeId ?? "",
    highlightedNodeId: highlightedNodeId ?? "",
    searchHighlightedNodeId: store.searchHighlightedNodeId,
    hoveredNodeIdForPanel,
    hoveredFileNodeIds,
    hoverNeighborhood,
    hoveredEdgeId: store.hoveredEdgeId,
    clickedEdgeId: store.clickedEdgeId,
  });

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
    if (!debouncedSearchQuery || debouncedSearchQuery.length < 2) return flowElements;
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
  }, [debouncedSearchQuery, flowElements, searchMatches, store.searchExclude, store.searchHighlightedNodeId]);

  const graphCanvasNodes = useMemo(
    () => searchResultNodes.nodes.map((node) => ({
      ...node,
      data: {
        ...(node.data as Record<string, unknown>),
        hideCodeTooltip: areNodesSelected,
        askLlmNodeId: node.id,
        onAskLlmForNode: handleAskLlmForNode,
        onAskLlmHrefForNode: handleAskLlmHrefForNode,
        onShowGraphLogicTreeForNode: handleShowGraphLogicTreeForNode,
        onShowCodeLogicTreeForNode: handleShowCodeLogicTreeForNode,
        onGroupHeaderHoverChange: handleGroupHeaderHoverChange,
      },
    })),
    [
      handleAskLlmForNode,
      handleAskLlmHrefForNode,
      handleShowGraphLogicTreeForNode,
      handleShowCodeLogicTreeForNode,
      handleGroupHeaderHoverChange,
      areNodesSelected,
      searchResultNodes.nodes,
    ],
  );

  const flowNodeById = useMemo(() => new Map(flowElements.nodes.map((n) => [n.id, n])), [flowElements.nodes]);

  const nodeAbsolutePosition = useCallback((node: Node): { x: number; y: number } => {
    return computeNodeAbsolutePosition(node, flowNodeById);
  }, [flowNodeById]);

  const viewportForNode = useCallback((node: Node): { x: number; y: number; zoom: number } => {
    return computeViewportForNode(node, flowNodeById, store.flowSize);
  }, [flowNodeById, store.flowSize]);

  const {
    flashSearchTarget,
    handleSearch,
    handleSearchNext,
    handleSearchPrev,
    searchHighlightTimerRef,
  } = useSplitGraphPanelSearch({
    store,
    searchMatches,
    viewportForNode,
    onViewportChange,
    onInteractionClick,
  });

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
  const debouncedHoveredEdgeId = useDebouncedValue(store.hoveredEdgeId, 500);

  const hoveredEdgeTooltip = useMemo(() => {
    const edgeId = debouncedHoveredEdgeId;
    if (!edgeId) return null;
    const edge = flowElements.edges.find((candidate) => candidate.id === edgeId);
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
  }, [debouncedHoveredEdgeId, flowElements.edges, graphNodeById]);

  const nodeTypesForFlow = isLogic ? logicNodeTypes : knowledgeNodeTypes;
  const showEdgeDebugOverlay = useMemo(() => hasDebugEdgesFlag(), []);
  const graphEdgeByIdForDebug = useMemo(
    () => new Map(graph.edges.map((e) => [e.id, e])),
    [graph.edges],
  );
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

  // Commented out: file list hover not working correctly
  // const hoveredFileViewport = useMemo(() => { ... }, []);
  // const viewportBeforeFileHoverRef = useRef<PanelViewport | null>(null);

  const handleNodeClick = useCallback<NodeMouseHandler>((_event, node) => {
    const graphNode = graphNodeById.get(node.id);
    if (graphNode?.kind === "group" && !isGroupHeaderTarget(_event)) return;
    onNodeSelect(node.id, side);
  }, [graphNodeById, onNodeSelect, side]);

  const handleNodeMouseEnter = useCallback<NodeMouseHandler>((_event, node) => {
    store.clearHoveredEdge();
    const graphNode = graphNodeById.get(node.id);
    if (!graphNode) return;
    if (graphNode.kind === "group") return;
    onNodeHoverChange(side, node.id, nodeMatchKeyById.get(node.id) ?? "");
  }, [graphNodeById, nodeMatchKeyById, onNodeHoverChange, side, store]);

  const handleNodeMouseMove = useCallback<NodeMouseHandler>((_event, node) => {
    const graphNode = graphNodeById.get(node.id);
    if (!graphNode || graphNode.kind === "group") return;
  }, [graphNodeById]);

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
    if (!debouncedSearchQuery || debouncedSearchQuery.length < 2 || searchMatches.length === 0) return;
    const searchKey = `${store.searchExclude ? "exclude" : "include"}:${debouncedSearchQuery.toLowerCase()}`;
    if (store.lastAutoFocusSearchKey === searchKey) return;
    store.setLastAutoFocusSearchKey(searchKey);
    store.setSearchIdx(0);
    const first = searchMatches[0];
    flashSearchTarget(first.id);
    onViewportChange(viewportForNode(first));
  }, [debouncedSearchQuery, store, searchMatches, onViewportChange, flashSearchTarget, viewportForNode]);

  useEffect(
    () => () => {
      if (searchHighlightTimerRef.current !== null) {
        window.clearTimeout(searchHighlightTimerRef.current);
      }
      if (edgeClickHighlightTimerRef.current !== null) {
        window.clearTimeout(edgeClickHighlightTimerRef.current);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable; cleanup runs only on unmount
    [],
  );

  useEffect(() => {
    if (!focusFilePath || !focusedViewport || focusFileTick <= 0) return;
    if (focusFileTick === lastAppliedFocusFileTickRef.current) return;
    lastAppliedFocusFileTickRef.current = focusFileTick;
    onViewportChange(focusedViewport);
  }, [focusFilePath, focusFileTick, focusedViewport, onViewportChange]);

  // Commented out: file list hover not working correctly
  // useEffect(() => {
  //   if (!isViewportPrimary) return;
  //   if (hoveredFilePathFromList && hoveredFileViewport) {
  //     if (viewportBeforeFileHoverRef.current === null) {
  //       viewportBeforeFileHoverRef.current = viewport;
  //     }
  //     onViewportChange(hoveredFileViewport);
  //   } else if (!hoveredFilePathFromList && viewportBeforeFileHoverRef.current !== null) {
  //     onViewportChange(viewportBeforeFileHoverRef.current);
  //     viewportBeforeFileHoverRef.current = null;
  //   }
  // }, [hoveredFilePathFromList, hoveredFileViewport, isViewportPrimary, onViewportChange, viewport]);

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
    store.flowSize,
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
    setGraphLogicTreeModal(null);
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
      {hoveredEdgeTooltip && (
        <EdgeTooltipOverlay
          pointerX={store.hoveredEdgePointerX}
          pointerY={store.hoveredEdgePointerY}
          sourceText={hoveredEdgeTooltip.sourceText}
          targetText={hoveredEdgeTooltip.targetText}
        />
      )}
      {showEdgeDebugOverlay && (
        <EdgeDebugOverlay
          edges={positionedLayoutResult.edges}
          graphEdgeById={graphEdgeByIdForDebug}
        />
      )}
      {graphLogicTreeModal && (
        <GraphLogicTreeModal
          open
          side={side}
          nodes={graphLogicTreeModal.nodes}
          edges={graphLogicTreeModal.edges}
          nodeTypes={nodeTypesForFlow}
          onClose={closeGraphLogicTreeModal}
          onNodeClick={handleGraphLogicTreeNodeClick}
        />
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
