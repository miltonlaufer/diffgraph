import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer, useLocalObservable } from "mobx-react-lite";
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
  const store = useLocalObservable(() => new ViewBaseStore());
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
      showChangesOnly,
      viewType,
    }),
    [
      showChangesOnly,
      store.newGraph,
      store.oldGraph,
      store.selectedFilePath,
      viewType,
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
    () => computeNewAlignmentOffset(viewType, store.oldTopAnchors, store.newTopAnchors),
    [viewType, store.oldTopAnchors, store.newTopAnchors],
  );

  const alignedTopAnchors = useMemo(
    () => computeAlignedTopAnchors(viewType, store.oldTopAnchors, store.newTopAnchors),
    [viewType, store.oldTopAnchors, store.newTopAnchors],
  );

  const alignmentBreakpoints = useMemo(
    () => computeAlignmentBreakpoints(viewType, store.oldNodeAnchors, store.newNodeAnchors),
    [viewType, store.oldNodeAnchors, store.newNodeAnchors],
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
    if (viewType === "logic" && store.showCalls) {
      handleShowCallsChange(false);
    }
    setPerformanceModalOpen(false);
  }, [handleShowCallsChange, store.showCalls, viewType]);

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
  }, [diffId, viewType]);

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

      if (performanceGuardLevel === 1 && viewType === "logic" && !store.showCalls) {
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
  }, [performanceGuardLevel, store.loading, store.showCalls, viewType]);

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
      selectedNodeId: store.selectedNodeId,
      highlightedNodeId: store.highlightedNodeId,
      focusNodeId: store.focusNodeId,
      focusNodeTick: store.focusNodeTick,
      focusSourceSide: store.focusSourceSide,
      graphSearchSide: store.graphSearchSide,
      graphSearchQuery: store.graphSearchQuery,
      graphSearchTick: store.graphSearchTick,
      graphSearchNavSide: store.graphSearchNavSide,
      graphSearchNavDirection: store.graphSearchNavDirection,
      graphSearchNavTick: store.graphSearchNavTick,
      focusFilePath: store.selectedFilePath,
      focusFileTick: store.focusFileTick,
      hoveredNodeId: store.hoveredNodeId,
      hoveredNodeMatchKey: store.hoveredNodeMatchKey,
      hoveredNodeSide: store.hoveredNodeSide,
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
    store.selectedFilePath,
    store.selectedNodeId,
    store.sharedViewport,
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
      hoveredCodeSide: store.hoveredCodeSide,
      selectedFile,
      targetLine: store.targetLine,
      targetSide: store.targetSide,
      scrollTick: store.scrollTick,
      codeSearchNavDirection: store.codeSearchNavDirection,
      codeSearchNavTick: store.codeSearchNavTick,
      codeLogicTreeRequestTick: store.codeLogicTreeRequestTick,
      codeLogicTreeRequestSide: store.codeLogicTreeRequestSide,
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

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

      if (viewType !== "logic" || graphDiffTargets.length === 0) return;
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
    store,
    store.codeSearchActive,
    store.newGraphSearchActive,
    store.oldGraphSearchActive,
    viewType,
  ]);

  useViewBaseEffects({
    store,
    diffId,
    viewType,
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

  if (store.loading) {
    return (
      <section className="viewContainer">
        <div className="loadingContainer">
          <div className="spinner" />
          <p className="dimText">Analyzing code and building graphs...</p>
        </div>
      </section>
    );
  }

  const isGraphLayoutPending = store.oldLayoutPending || store.newLayoutPending;
  const isInteractionPending = store.interactionBusy || isUiPending || isGraphLayoutPending;

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

                {viewType === "logic" && store.showCalls && (
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

        {viewType === "logic" && (
          <LogicToolbar
            showCalls={store.showCalls}
            diffCountLabel={graphDiffTargets.length > 0 ? `${store.graphDiffIdx + 1}/${graphDiffTargets.length}` : "0/0"}
            canNavigate={graphDiffTargets.length > 0}
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
                {isEmptyView && (
                  <p className="errorText">
                    {store.selectedFilePath
                      ? "No nodes found for this file. Try the Knowledge tab, or disable Changes Only."
                      : "No nodes found for this view. Try the Knowledge tab, or disable Changes Only."}
                  </p>
                )}
                {!isEmptyView && renderOldGraph && renderNewGraph && (
                  <Group id="graph-split" orientation="horizontal" className="splitLayoutResizable">
                    <Panel id="old" defaultSize={50} minSize={20} className="viewResizablePanel">
                      <div className="splitLayoutPanelInner">
                        <SplitGraphPanel
                          title="Old"
                          side="old"
                          graph={displayOldGraph}
                          counterpartGraph={displayNewGraph}
                          viewType={viewType}
                          showCalls={viewType === "logic" ? store.showCalls : true}
                          fileContentMap={oldFileContentMap}
                          counterpartFileContentMap={newFileContentMap}
                          alignmentAnchors={alignedTopAnchors.old}
                          pullRequestDescriptionExcerpt={pullRequestDescriptionExcerpt}
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
                          viewType={viewType}
                          showCalls={viewType === "logic" ? store.showCalls : true}
                          diffStats={diffStats}
                          fileContentMap={newFileContentMap}
                          counterpartFileContentMap={oldFileContentMap}
                          alignmentOffset={newAlignmentOffset}
                          alignmentAnchors={alignedTopAnchors.new}
                          alignmentBreakpoints={alignmentBreakpoints}
                          pullRequestDescriptionExcerpt={pullRequestDescriptionExcerpt}
                          isViewportPrimary
                        />
                      </div>
                    </Panel>
                  </Group>
                )}
                {!isEmptyView && (renderOldGraph !== renderNewGraph) && (
                  <div className={renderOldGraph && renderNewGraph ? "splitLayout" : "splitLayout splitLayoutSingle"}>
                    {renderOldGraph && (
                      <SplitGraphPanel
                        title="Old"
                        side="old"
                        graph={displayOldGraph}
                        counterpartGraph={displayNewGraph}
                        viewType={viewType}
                        showCalls={viewType === "logic" ? store.showCalls : true}
                        fileContentMap={oldFileContentMap}
                        counterpartFileContentMap={newFileContentMap}
                        alignmentAnchors={alignedTopAnchors.old}
                        pullRequestDescriptionExcerpt={pullRequestDescriptionExcerpt}
                        isViewportPrimary={!renderNewGraph}
                      />
                    )}
                    {renderNewGraph && (
                      <SplitGraphPanel
                        title="New"
                        side="new"
                        graph={displayNewGraph}
                        counterpartGraph={displayOldGraph}
                        viewType={viewType}
                        showCalls={viewType === "logic" ? store.showCalls : true}
                        diffStats={diffStats}
                        fileContentMap={newFileContentMap}
                        counterpartFileContentMap={oldFileContentMap}
                        alignmentOffset={newAlignmentOffset}
                        alignmentAnchors={alignedTopAnchors.new}
                        alignmentBreakpoints={alignmentBreakpoints}
                        pullRequestDescriptionExcerpt={pullRequestDescriptionExcerpt}
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
      </section>
    </ViewBaseRuntimeProvider>
  );
});
