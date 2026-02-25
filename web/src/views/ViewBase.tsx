import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import { Group, Panel, Separator } from "react-resizable-panels";
import { CodeDiffDrawer } from "../components/CodeDiffDrawer";
import { FileListPanel } from "../components/FileListPanel";
import { SplitGraphPanel, type GraphDiffTarget, type InternalNodeAnchor, type TopLevelAnchor } from "../components/SplitGraphPanel";
import { SplitGraphRuntimeProvider, type SplitGraphRuntimeContextValue } from "../components/splitGraph/context";
import { SymbolListPanel } from "../components/SymbolListPanel";
import type { FileSymbol, ViewportState } from "../types/graph";
import { LogicToolbar } from "./viewBase/LogicToolbar";
import {
  commandCodeLineClick,
  commandCodeLineHover,
  commandCodeLineHoverClear,
  commandCodeLineDoubleClick,
  commandFocusGraphNode,
  commandGoToGraphDiff,
  commandOpenCodeLogicTree,
  commandSelectFile,
  commandSelectNode,
  commandSelectSymbol,
  commandSetDiffTargets,
  commandSetHoveredNode,
  commandSetNodeAnchors,
  commandSetTopLevelAnchors,
  commandSetViewport,
  commandToggleShowCalls,
} from "./viewBase/commands";
import { ViewBaseStore } from "./viewBase/store";
import { ViewBaseRuntimeProvider, type ViewBaseRuntimeContextValue } from "./viewBase/runtime";
import type { ViewType } from "./viewBase/types";
import { useViewBaseDerivedWorker } from "./viewBase/useViewBaseDerivedWorker";
import { useInteractiveUpdate } from "./viewBase/useInteractiveUpdate";
import { useViewBaseEffects } from "./viewBase/useViewBaseEffects";
import {
  buildFileContentMap,
  computeAlignmentBreakpoints,
  computeAlignedTopAnchors,
  computeNewAlignmentOffset,
  normalizePath,
  resolveAdjacentLogicTreeNodeId,
} from "./viewBase/selectors";

interface ViewBaseProps {
  diffId: string;
  viewType: ViewType;
  showChangesOnly: boolean;
  pullRequestDescriptionExcerpt?: string;
}

type GraphRenderMode = "both" | "old" | "new";

const UI_LAG_SAMPLE_MS = 500;
const UI_LAG_THRESHOLD_MS = 4000;
const UI_GUARD_COOLDOWN_MS = 12000;

export const ViewBase = observer(({ diffId, viewType, showChangesOnly, pullRequestDescriptionExcerpt }: ViewBaseProps) => {
  const store = useMemo(() => ViewBaseStore.create({}), []);
  store.setViewConfig({
    diffId,
    viewType,
    showChangesOnly,
    pullRequestDescriptionExcerpt: pullRequestDescriptionExcerpt ?? "",
  });
  const graphSectionRef = useRef<HTMLDivElement>(null);
  const codeDiffSectionRef = useRef<HTMLDivElement>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const { isUiPending, commandContext } = useInteractiveUpdate(store);
  const [performanceModalOpen, setPerformanceModalOpen] = useState(false);
  const [performanceGuardLevel, setPerformanceGuardLevel] = useState<0 | 1 | 2>(0);
  const [graphRenderMode, setGraphRenderMode] = useState<GraphRenderMode>("both");
  const [lastUiLagMs, setLastUiLagMs] = useState(0);
  const guardCooldownUntilRef = useRef(0);

  const derivedInput = useMemo(
    () => ({
      oldGraph: store.oldGraph,
      newGraph: store.newGraph,
      selectedFilePath: store.selectedFilePath,
      showChangesOnly: store.showChangesOnly,
      viewType: store.viewType as "logic" | "knowledge" | "react",
    }),
    [
      store.showChangesOnly,
      store.newGraph,
      store.oldGraph,
      store.selectedFilePath,
      store.viewType,
    ],
  );

  const {
    displayOldGraph,
    displayNewGraph,
    diffStats,
    displayOldChangedCount,
    displayNewChangedCount,
  } = useViewBaseDerivedWorker(derivedInput);

  const renderOldGraph = graphRenderMode !== "new";
  const renderNewGraph = graphRenderMode !== "old";

  const newAlignmentOffset = useMemo(
    () => computeNewAlignmentOffset(store.viewType as "logic" | "knowledge" | "react", store.oldTopAnchors, store.newTopAnchors),
    [store.viewType, store.oldTopAnchors, store.newTopAnchors],
  );

  const alignedTopAnchors = useMemo(
    () => computeAlignedTopAnchors(store.viewType as "logic" | "knowledge" | "react", store.oldTopAnchors, store.newTopAnchors),
    [store.viewType, store.oldTopAnchors, store.newTopAnchors],
  );

  const alignmentBreakpoints = useMemo(
    () => computeAlignmentBreakpoints(store.viewType as "logic" | "knowledge" | "react", store.oldNodeAnchors, store.newNodeAnchors),
    [store.viewType, store.oldNodeAnchors, store.newNodeAnchors],
  );

  const isEmptyView = useMemo(
    () =>
      (!renderOldGraph || displayOldGraph.nodes.length === 0)
      && (!renderNewGraph || displayNewGraph.nodes.length === 0),
    [displayOldGraph.nodes.length, displayNewGraph.nodes.length, renderNewGraph, renderOldGraph],
  );

  const selectedFile = useMemo(
    () =>
      store.fileDiffs.find((entry) => normalizePath(entry.path) === normalizePath(store.selectedFilePath)) ?? null,
    [store.fileDiffs, store.selectedFilePath],
  );

  const selectedSymbols = useMemo<FileSymbol[]>(
    () => selectedFile?.symbols ?? [],
    [selectedFile],
  );

  const graphDiffTargets = useMemo(() => {
    const merged = [
      ...(renderOldGraph ? store.oldDiffTargets : []),
      ...(renderNewGraph ? store.newDiffTargets : []),
    ];
    return merged.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  }, [renderNewGraph, renderOldGraph, store.oldDiffTargets, store.newDiffTargets]);

  const oldFileContentMap = useMemo(
    () => buildFileContentMap(store.fileDiffs, "old"),
    [store.fileDiffs],
  );

  const newFileContentMap = useMemo(
    () => buildFileContentMap(store.fileDiffs, "new"),
    [store.fileDiffs],
  );

  const handleNodeSelect = useCallback(
    (nodeId: string, sourceSide: "old" | "new") => {
      commandSelectNode(commandContext, nodeId, sourceSide);
    },
    [commandContext],
  );

  const handleOpenCodeLogicTree = useCallback(
    (nodeId: string, sourceSide: "old" | "new", lineNumbers: number[]) => {
      commandOpenCodeLogicTree(commandContext, nodeId, sourceSide, lineNumbers);
    },
    [commandContext],
  );

  const handleGraphNodeFocus = useCallback(
    (nodeId: string, sourceSide: "old" | "new") => {
      commandFocusGraphNode(commandContext, nodeId, sourceSide);
    },
    [commandContext],
  );

  const handleFileSelect = useCallback(
    (filePath: string) => {
      commandSelectFile(commandContext, filePath);
    },
    [commandContext],
  );

  const handleToggleFileListCollapsed = useCallback(() => {
    store.toggleFileListCollapsed();
  }, [store]);

  const handleSymbolClick = useCallback(
    (startLine: number) => {
      commandSelectSymbol(commandContext, startLine);
    },
    [commandContext],
  );

  const handleViewportChange = useCallback(
    (viewport: ViewportState) => {
      commandSetViewport(commandContext, viewport);
    },
    [commandContext],
  );

  const handleShowCallsChange = useCallback(
    (nextChecked: boolean) => {
      commandToggleShowCalls(commandContext, nextChecked);
    },
    [commandContext],
  );

  const handleDisableCallsForPerformance = useCallback(() => {
    if (store.viewType === "logic" && store.showCalls) {
      handleShowCallsChange(false);
    }
    setPerformanceModalOpen(false);
  }, [handleShowCallsChange, store.showCalls, store.viewType]);

  const handleRenderOldGraphToggle = useCallback((nextChecked: boolean) => {
    setGraphRenderMode((prev) => {
      const prevNew = prev !== "old";
      const nextOld = nextChecked;
      const nextNew = prevNew;
      if (!nextOld && !nextNew) return prev;
      if (nextOld && nextNew) return "both";
      return nextOld ? "old" : "new";
    });
  }, []);

  const handleRenderNewGraphToggle = useCallback((nextChecked: boolean) => {
    setGraphRenderMode((prev) => {
      const prevOld = prev !== "new";
      const nextOld = prevOld;
      const nextNew = nextChecked;
      if (!nextOld && !nextNew) return prev;
      if (nextOld && nextNew) return "both";
      return nextOld ? "old" : "new";
    });
  }, []);

  const closePerformanceModal = useCallback(() => {
    setPerformanceModalOpen(false);
  }, []);

  useEffect(() => {
    if (!performanceModalOpen) return undefined;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      closePerformanceModal();
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [closePerformanceModal, performanceModalOpen]);

  useEffect(() => {
    setPerformanceModalOpen(false);
    setPerformanceGuardLevel(0);
    setGraphRenderMode("both");
    setLastUiLagMs(0);
    guardCooldownUntilRef.current = 0;
  }, [store.diffId, store.viewType]);

  useEffect(() => {
    setPerformanceModalOpen(false);
  }, [store.selectedFilePath]);

  useEffect(() => {
    if (store.loading) return;
    let lastTick = performance.now();
    let skipNextVisibleSample = false;

    const resetLagBaseline = (): void => {
      lastTick = performance.now();
      skipNextVisibleSample = true;
    };

    const handleVisibilityChange = (): void => {
      resetLagBaseline();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        resetLagBaseline();
        return;
      }

      if (skipNextVisibleSample) {
        skipNextVisibleSample = false;
        lastTick = performance.now();
        return;
      }

      const now = performance.now();
      const lagMs = now - lastTick - UI_LAG_SAMPLE_MS;
      lastTick = now;
      if (lagMs <= UI_LAG_THRESHOLD_MS) return;

      setLastUiLagMs(Math.round(lagMs));
      const nowEpoch = Date.now();
      if (nowEpoch < guardCooldownUntilRef.current) return;

      if (performanceGuardLevel === 0) {
        setPerformanceGuardLevel(1);
        setPerformanceModalOpen(true);
        guardCooldownUntilRef.current = nowEpoch + UI_GUARD_COOLDOWN_MS;
        return;
      }

      if (performanceGuardLevel === 1 && store.viewType === "logic" && !store.showCalls) {
        setPerformanceGuardLevel(2);
        setPerformanceModalOpen(true);
        guardCooldownUntilRef.current = nowEpoch + UI_GUARD_COOLDOWN_MS;
        return;
      }

      setPerformanceModalOpen(true);
      guardCooldownUntilRef.current = nowEpoch + UI_GUARD_COOLDOWN_MS;
    }, UI_LAG_SAMPLE_MS);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [performanceGuardLevel, store.loading, store.showCalls, store.viewType]);

  const handleDiffTargetsChange = useCallback(
    (side: "old" | "new", targets: GraphDiffTarget[]) => {
      commandSetDiffTargets(commandContext, side, targets);
    },
    [commandContext],
  );

  const handleTopLevelAnchorsChange = useCallback(
    (side: "old" | "new", anchors: Record<string, TopLevelAnchor>) => {
      commandSetTopLevelAnchors(commandContext, side, anchors);
    },
    [commandContext],
  );

  const handleNodeAnchorsChange = useCallback(
    (side: "old" | "new", anchors: Record<string, InternalNodeAnchor>) => {
      commandSetNodeAnchors(commandContext, side, anchors);
    },
    [commandContext],
  );

  const handleLayoutPendingChange = useCallback(
    (side: "old" | "new", pending: boolean) => {
      store.setLayoutPending(side, pending);
    },
    [store],
  );

  const handleSearchStateChange = useCallback(
    (side: "old" | "new", active: boolean) => {
      store.setGraphSearchActive(side, active);
    },
    [store],
  );

  const handleNodeHoverChange = useCallback(
    (side: "old" | "new", nodeId: string, matchKey: string) => {
      commandSetHoveredNode(commandContext, side, nodeId, matchKey);
    },
    [commandContext],
  );

  const handleInteractionClick = useCallback(() => {
    commandContext.runInteractiveUpdate(() => {});
  }, [commandContext]);

  const splitGraphRuntime = useMemo<SplitGraphRuntimeContextValue>(() => ({
    state: {
      viewport: store.sharedViewport,
      viewType: store.viewType as "logic" | "knowledge" | "react",
      pullRequestDescriptionExcerpt: store.pullRequestDescriptionExcerpt,
      diffStats,
      selectedNodeId: store.selectedNodeId,
      highlightedNodeId: store.highlightedNodeId,
      focusNodeId: store.focusNodeId,
      focusNodeTick: store.focusNodeTick,
      focusSourceSide: store.focusSourceSide as "old" | "new",
      graphSearchSide: store.graphSearchSide as "old" | "new",
      graphSearchQuery: store.graphSearchQuery,
      graphSearchTick: store.graphSearchTick,
      graphSearchNavSide: store.graphSearchNavSide as "old" | "new",
      graphSearchNavDirection: store.graphSearchNavDirection as "next" | "prev",
      graphSearchNavTick: store.graphSearchNavTick,
      focusFilePath: store.selectedFilePath,
      focusFileTick: store.focusFileTick,
      hoveredNodeId: store.hoveredNodeId,
      hoveredNodeMatchKey: store.hoveredNodeMatchKey,
      hoveredNodeSide: store.hoveredNodeSide as "old" | "new" | "",
    },
    actions: {
      onInteractionClick: handleInteractionClick,
      onGraphNodeFocus: handleGraphNodeFocus,
      onNodeSelect: handleNodeSelect,
      onOpenCodeLogicTree: handleOpenCodeLogicTree,
      onNodeHoverChange: handleNodeHoverChange,
      onViewportChange: handleViewportChange,
      onDiffTargetsChange: handleDiffTargetsChange,
      onTopLevelAnchorsChange: handleTopLevelAnchorsChange,
      onNodeAnchorsChange: handleNodeAnchorsChange,
      onLayoutPendingChange: handleLayoutPendingChange,
      onSearchStateChange: handleSearchStateChange,
    },
  }), [
    handleDiffTargetsChange,
    handleGraphNodeFocus,
    handleInteractionClick,
    handleLayoutPendingChange,
    handleOpenCodeLogicTree,
    handleSearchStateChange,
    handleNodeHoverChange,
    handleNodeSelect,
    handleNodeAnchorsChange,
    handleTopLevelAnchorsChange,
    handleViewportChange,
    diffStats,
    store.focusFileTick,
    store.focusNodeId,
    store.focusSourceSide,
    store.focusNodeTick,
    store.graphSearchQuery,
    store.graphSearchSide,
    store.graphSearchTick,
    store.graphSearchNavDirection,
    store.graphSearchNavSide,
    store.graphSearchNavTick,
    store.hoveredNodeId,
    store.hoveredNodeMatchKey,
    store.hoveredNodeSide,
    store.highlightedNodeId,
    store.pullRequestDescriptionExcerpt,
    store.selectedFilePath,
    store.selectedNodeId,
    store.sharedViewport,
    store.viewType,
  ]);

  const handleCodeLineClick = useCallback(
    (line: number, side: "old" | "new") => {
      commandCodeLineClick(
        {
          ...commandContext,
          selectedFilePath: selectedFile?.path ?? store.selectedFilePath,
          displayOldGraph,
          displayNewGraph,
          highlightTimerRef,
        },
        line,
        side,
      );
    },
    [commandContext, selectedFile?.path, store.selectedFilePath, displayOldGraph, displayNewGraph, highlightTimerRef],
  );

  const handleCodeLineDoubleClick = useCallback(
    (_line: number, side: "old" | "new", word: string) => {
      commandCodeLineDoubleClick(commandContext, side, word);
    },
    [commandContext],
  );

  const handleCodeSearchStateChange = useCallback(
    (active: boolean) => {
      store.setCodeSearchActive(active);
    },
    [store],
  );

  const handleCodeLineHover = useCallback(
    (line: number, side: "old" | "new") => {
      commandCodeLineHover(
        {
          ...commandContext,
          selectedFilePath: selectedFile?.path ?? store.selectedFilePath,
          displayOldGraph,
          displayNewGraph,
        },
        line,
        side,
      );
    },
    [commandContext, selectedFile?.path, store.selectedFilePath, displayOldGraph, displayNewGraph],
  );

  const handleCodeLineHoverClear = useCallback(() => {
    commandCodeLineHoverClear(commandContext);
  }, [commandContext]);

  const viewBaseRuntime = useMemo<ViewBaseRuntimeContextValue>(() => ({
    state: {
      files: store.fileDiffs,
      selectedFilePath: store.selectedFilePath,
      fileListCollapsed: store.fileListCollapsed,
      hoveredCodeLine: store.hoveredCodeLine,
      hoveredCodeSide: store.hoveredCodeSide as "old" | "new",
      selectedFile,
      targetLine: store.targetLine,
      targetSide: store.targetSide as "old" | "new",
      scrollTick: store.scrollTick,
      codeSearchNavDirection: store.codeSearchNavDirection as "next" | "prev",
      codeSearchNavTick: store.codeSearchNavTick,
      codeLogicTreeRequestTick: store.codeLogicTreeRequestTick,
      codeLogicTreeRequestSide: store.codeLogicTreeRequestSide as "old" | "new",
      codeLogicTreeRequestLines: store.codeLogicTreeRequestLines,
    },
    actions: {
      onFileSelect: handleFileSelect,
      onToggleFileListCollapsed: handleToggleFileListCollapsed,
      onCodeLineClick: handleCodeLineClick,
      onCodeLineHover: handleCodeLineHover,
      onCodeLineHoverClear: handleCodeLineHoverClear,
      onCodeLineDoubleClick: handleCodeLineDoubleClick,
      onCodeSearchStateChange: handleCodeSearchStateChange,
    },
  }), [
    handleCodeLineClick,
    handleCodeLineHover,
    handleCodeLineHoverClear,
    handleCodeLineDoubleClick,
    handleCodeSearchStateChange,
    handleFileSelect,
    handleToggleFileListCollapsed,
    store.codeSearchNavDirection,
    store.codeSearchNavTick,
    store.codeLogicTreeRequestTick,
    store.codeLogicTreeRequestSide,
    store.codeLogicTreeRequestLines,
    store.fileListCollapsed,
    store.hoveredCodeLine,
    store.hoveredCodeSide,
    selectedFile,
    store.fileDiffs,
    store.scrollTick,
    store.selectedFilePath,
    store.targetLine,
    store.targetSide,
  ]);

  const goToGraphDiff = useCallback(
    (idx: number) => {
      commandGoToGraphDiff(
        {
          ...commandContext,
          graphDiffTargets,
          highlightTimerRef,
        },
        idx,
      );
    },
    [commandContext, graphDiffTargets],
  );

  const goToPrevGraphDiff = useCallback(() => {
    goToGraphDiff(store.graphDiffIdx - 1);
  }, [goToGraphDiff, store.graphDiffIdx]);

  const goToNextGraphDiff = useCallback(() => {
    goToGraphDiff(store.graphDiffIdx + 1);
  }, [goToGraphDiff, store.graphDiffIdx]);

  const selectAdjacentLogicNode = useCallback((direction: "next" | "prev"): boolean => {
    if (store.viewType !== "logic") return false;
    const selectedNodeId = store.selectedNodeId;
    if (!selectedNodeId) return false;

    const resolveTarget = (side: "old" | "new"): { nodeId: string; side: "old" | "new" } | null => {
      const graph = side === "old" ? displayOldGraph : displayNewGraph;
      const adjacentNodeId = resolveAdjacentLogicTreeNodeId(graph, selectedNodeId, direction);
      if (!adjacentNodeId) return null;
      return { nodeId: adjacentNodeId, side };
    };

    const preferredSide = store.focusSourceSide as "old" | "new";
    const fallbackSide: "old" | "new" = preferredSide === "old" ? "new" : "old";
    const target = resolveTarget(preferredSide) ?? resolveTarget(fallbackSide);
    if (!target) return false;

    commandSelectNode(commandContext, target.nodeId, target.side);
    return true;
  }, [
    commandContext,
    displayNewGraph,
    displayOldGraph,
    store.focusSourceSide,
    store.selectedNodeId,
    store.viewType as "logic" | "knowledge" | "react",
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const isVerticalArrow = event.key === "ArrowDown" || event.key === "ArrowUp";
      const isHorizontalArrow = event.key === "ArrowLeft" || event.key === "ArrowRight";
      if (!isVerticalArrow && !isHorizontalArrow) return;

      if (isHorizontalArrow) {
        const target = event.target;
        const isEditableTarget = target instanceof HTMLInputElement
          || target instanceof HTMLTextAreaElement
          || target instanceof HTMLSelectElement
          || (target instanceof HTMLElement && target.isContentEditable);
        if (isEditableTarget) return;
        const direction: "next" | "prev" = event.key === "ArrowRight" ? "next" : "prev";
        if (!selectAdjacentLogicNode(direction)) return;
        event.preventDefault();
        return;
      }

      const direction: "next" | "prev" = event.key === "ArrowDown" ? "next" : "prev";
      if (store.codeSearchActive) {
        store.requestCodeSearchNavigate(direction);
        event.preventDefault();
        return;
      }
      const hasGraphSearchActive = store.oldGraphSearchActive || store.newGraphSearchActive;
      if (hasGraphSearchActive) {
        const side: "old" | "new" = store.newGraphSearchActive ? "new" : "old";
        store.requestGraphSearchNavigate(side, direction);
        event.preventDefault();
        return;
      }

      if (store.viewType !== "logic" || graphDiffTargets.length === 0) return;
      if (direction === "next") {
        goToNextGraphDiff();
      } else {
        goToPrevGraphDiff();
      }
      event.preventDefault();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    goToNextGraphDiff,
    goToPrevGraphDiff,
    graphDiffTargets.length,
    selectAdjacentLogicNode,
    store,
    store.codeSearchActive,
    store.newGraphSearchActive,
    store.oldGraphSearchActive,
    store.viewType as "logic" | "knowledge" | "react",
  ]);

  useViewBaseEffects({
    store,
    hasSelectedFile: selectedFile !== null,
    graphSectionRef,
    codeDiffSectionRef,
    graphDiffTargets,
    displayOldChangedCount,
    displayNewChangedCount,
    highlightTimerRef,
  });

  if (store.error) {
    return <p className="errorText">{store.error}</p>;
  }

  const isGraphLayoutPending = store.oldLayoutPending || store.newLayoutPending;
  const isInteractionPending =
    !store.loading && (store.interactionBusy || isUiPending || isGraphLayoutPending);

  return (
    <ViewBaseRuntimeProvider value={viewBaseRuntime}>
      <section className="viewContainer">
        {isInteractionPending && (
          <div className="interactionOverlay interactionOverlayLocal" role="status" aria-live="polite">
            <div className="spinner" />
            <p className="dimText">Updating graph...</p>
          </div>
        )}

        {performanceModalOpen && (
          <div className="performanceGuardBackdrop" role="presentation">
            <section
              className="performanceGuardModal"
              role="dialog"
              aria-modal="true"
              aria-label="Performance protection"
            >
              <header className="performanceGuardHeader">
                <h3 className="performanceGuardTitle">UI performance protection</h3>
                <button type="button" className="prDescriptionCloseBtn" onClick={closePerformanceModal}>
                  Close
                </button>
              </header>
              <div className="performanceGuardBody">
                <p className="dimText">
                  The graph UI showed a long stall ({lastUiLagMs}ms). We can reduce rendering load progressively.
                </p>
                <p className="performanceGuardEscHint">
                  <strong>ESC to dismiss this modal</strong>
                </p>

                {store.viewType === "logic" && store.showCalls && (
                  <button type="button" className="performanceGuardPrimaryBtn" onClick={handleDisableCallsForPerformance}>
                    Hide call edges (recommended)
                  </button>
                )}

                {performanceGuardLevel >= 2 && (
                  <div className="performanceGuardOptions">
                    <div className="dimText">Advanced reduction (shown after repeated stalls):</div>
                    <label className="showCallsLabel">
                      <input
                        type="checkbox"
                        className="showCallsCheckbox"
                        checked={renderOldGraph}
                        onChange={(event) => handleRenderOldGraphToggle(event.target.checked)}
                      />
                      Render old graph
                    </label>
                    <label className="showCallsLabel">
                      <input
                        type="checkbox"
                        className="showCallsCheckbox"
                        checked={renderNewGraph}
                        onChange={(event) => handleRenderNewGraphToggle(event.target.checked)}
                      />
                      Render new graph
                    </label>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {store.viewType === "logic" && (
          <LogicToolbar
            showCalls={store.showCalls}
            diffCountLabel={graphDiffTargets.length > 0 ? `${store.graphDiffIdx + 1}/${graphDiffTargets.length}` : "0/0"}
            canNavigate={graphDiffTargets.length > 0}
            hasSelectedNode={store.hasSelectedNode}
            searchActive={store.hasSearchActive}
            onShowCallsChange={handleShowCallsChange}
            onPrev={goToPrevGraphDiff}
            onNext={goToNextGraphDiff}
          />
        )}

        <SplitGraphRuntimeProvider value={splitGraphRuntime}>
          <Group
            id="view-resizable"
            orientation="vertical"
            className="viewResizableGroup"
          >
            <Panel id="graph" defaultSize={50} minSize={25} className="viewResizablePanel">
              <div ref={graphSectionRef} className="viewResizablePanelInner">
                {store.loading && (
                  <div className="loadingContainer">
                    <div className="spinner" />
                    <p className="dimText">Analyzing code and building graphs...</p>
                  </div>
                )}
                {!store.loading && isEmptyView && (
                  <p className="errorText">
                    {store.selectedFilePath
                      ? "No nodes found for this file. Try the Knowledge tab, or disable Changes Only."
                      : "No nodes found for this view. Try the Knowledge tab, or disable Changes Only."}
                  </p>
                )}
                {!store.loading && !isEmptyView && renderOldGraph && renderNewGraph && (
                  <Group id="graph-split" orientation="horizontal" className="splitLayoutResizable">
                    <Panel id="old" defaultSize={50} minSize={20} className="viewResizablePanel">
                      <div className="splitLayoutPanelInner">
                        <SplitGraphPanel
                          title="Old"
                          side="old"
                          graph={displayOldGraph}
                          counterpartGraph={displayNewGraph}
                          showCalls={store.viewType === "logic" ? store.showCalls : true}
                          fileContentMap={oldFileContentMap}
                          counterpartFileContentMap={newFileContentMap}
                          alignmentAnchors={alignedTopAnchors.old}
                          isViewportPrimary={!renderNewGraph}
                        />
                      </div>
                    </Panel>
                    <Separator id="graph-separator" className="viewResizeSeparator viewResizeSeparatorHorizontal" />
                    <Panel id="new" defaultSize={50} minSize={20} className="viewResizablePanel">
                      <div className="splitLayoutPanelInner">
                        <SplitGraphPanel
                          title="New"
                          side="new"
                          graph={displayNewGraph}
                          counterpartGraph={displayOldGraph}
                          showCalls={store.viewType === "logic" ? store.showCalls : true}
                          fileContentMap={newFileContentMap}
                          counterpartFileContentMap={oldFileContentMap}
                          alignmentOffset={newAlignmentOffset}
                          alignmentAnchors={alignedTopAnchors.new}
                          alignmentBreakpoints={alignmentBreakpoints}
                          isViewportPrimary
                        />
                      </div>
                    </Panel>
                  </Group>
                )}
                {!store.loading && !isEmptyView && (renderOldGraph !== renderNewGraph) && (
                  <div className={renderOldGraph && renderNewGraph ? "splitLayout" : "splitLayout splitLayoutSingle"}>
                    {renderOldGraph && (
                      <SplitGraphPanel
                        title="Old"
                        side="old"
                        graph={displayOldGraph}
                        counterpartGraph={displayNewGraph}
                        showCalls={store.viewType === "logic" ? store.showCalls : true}
                        fileContentMap={oldFileContentMap}
                        counterpartFileContentMap={newFileContentMap}
                        alignmentAnchors={alignedTopAnchors.old}
                        isViewportPrimary={!renderNewGraph}
                      />
                    )}
                    {renderNewGraph && (
                      <SplitGraphPanel
                        title="New"
                        side="new"
                        graph={displayNewGraph}
                        counterpartGraph={displayOldGraph}
                        showCalls={store.viewType === "logic" ? store.showCalls : true}
                        fileContentMap={newFileContentMap}
                        counterpartFileContentMap={oldFileContentMap}
                        alignmentOffset={newAlignmentOffset}
                        alignmentAnchors={alignedTopAnchors.new}
                        alignmentBreakpoints={alignmentBreakpoints}
                        isViewportPrimary
                      />
                    )}
                  </div>
                )}
              </div>
            </Panel>
            <Separator id="file-panel-separator" className="viewResizeSeparator viewResizeSeparatorVertical" />
            <Panel id="details" defaultSize={50} minSize={20} className="viewResizablePanel">
              <div className="viewResizablePanelInner viewResizableDetailsPanel">
                <div className="viewResizableFilePanel">
                  <FileListPanel />
                  {selectedSymbols.length > 0 && (
                    <SymbolListPanel symbols={selectedSymbols} onSymbolClick={handleSymbolClick} />
                  )}
                </div>
                <div className="viewResizableCodePanel">
                  <div ref={codeDiffSectionRef} className="viewResizableCodeDiffWrapper">
                    <CodeDiffDrawer />
                  </div>
                </div>
              </div>
            </Panel>
          </Group>
        </SplitGraphRuntimeProvider>

        {__INTERNAL_DEBUG__ && (
          <div
            className="internalDebugZoom"
            style={{
              position: "fixed",
              bottom: 8,
              left: 8,
              padding: "4px 8px",
              fontSize: 12,
              backgroundColor: "rgba(0,0,0,0.7)",
              color: "#ccc",
              fontFamily: "monospace",
              borderRadius: 4,
              zIndex: 9999,
            }}
          >
            zoom: {store.sharedViewport.zoom.toFixed(2)}
          </div>
        )}
      </section>
    </ViewBaseRuntimeProvider>
  );
});
