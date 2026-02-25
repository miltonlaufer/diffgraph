import { useCallback, useEffect, useMemo, useRef } from "react";
import { observer } from "mobx-react-lite";
import { Group, Panel, Separator } from "react-resizable-panels";
import { CodeDiffDrawer } from "../components/CodeDiffDrawer";
import { FileListPanel } from "../components/FileListPanel";
import { type GraphDiffTarget, type InternalNodeAnchor, type TopLevelAnchor } from "../components/SplitGraphPanel";
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
import { usePerformanceGuard } from "./viewBase/usePerformanceGuard";
import { useViewBaseKeyboardShortcuts } from "./viewBase/useViewBaseKeyboardShortcuts";
import { PerformanceGuardModal } from "./viewBase/PerformanceGuardModal";
import { GraphSection } from "./viewBase/GraphSection";
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

export const ViewBase = observer(({ diffId, viewType, showChangesOnly, pullRequestDescriptionExcerpt }: ViewBaseProps) => {
  const store = useMemo(() => ViewBaseStore.create({}), []);
  useEffect(() => {
    store.setViewConfig({
      diffId,
      viewType,
      showChangesOnly,
      pullRequestDescriptionExcerpt: pullRequestDescriptionExcerpt ?? "",
    });
  }, [store, diffId, viewType, showChangesOnly, pullRequestDescriptionExcerpt]);
  const graphSectionRef = useRef<HTMLDivElement>(null);
  const codeDiffSectionRef = useRef<HTMLDivElement>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const { isUiPending, commandContext } = useInteractiveUpdate(store);

  const handleShowCallsChange = useCallback(
    (nextChecked: boolean) => {
      commandToggleShowCalls(commandContext, nextChecked);
    },
    [commandContext],
  );

  const {
    performanceModalOpen,
    performanceGuardLevel,
    renderOldGraph,
    renderNewGraph,
    lastUiLagMs,
    handleDisableCallsForPerformance,
    handleRenderOldGraphToggle,
    handleRenderNewGraphToggle,
    closePerformanceModal,
  } = usePerformanceGuard({ store, onShowCallsChange: handleShowCallsChange });

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

  useViewBaseKeyboardShortcuts({
    store,
    commandContext,
    displayOldGraph,
    displayNewGraph,
    graphDiffTargetsLength: graphDiffTargets.length,
    goToPrevGraphDiff,
    goToNextGraphDiff,
  });

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
          <PerformanceGuardModal
            lastUiLagMs={lastUiLagMs}
            performanceGuardLevel={performanceGuardLevel}
            renderOldGraph={renderOldGraph}
            renderNewGraph={renderNewGraph}
            showCalls={store.showCalls}
            viewType={store.viewType}
            onClose={closePerformanceModal}
            onDisableCallsForPerformance={handleDisableCallsForPerformance}
            onRenderOldGraphToggle={handleRenderOldGraphToggle}
            onRenderNewGraphToggle={handleRenderNewGraphToggle}
          />
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
              <GraphSection
                graphSectionRef={graphSectionRef}
                loading={store.loading}
                isEmptyView={isEmptyView}
                selectedFilePath={store.selectedFilePath}
                renderOldGraph={renderOldGraph}
                renderNewGraph={renderNewGraph}
                displayOldGraph={displayOldGraph}
                displayNewGraph={displayNewGraph}
                oldFileContentMap={oldFileContentMap}
                newFileContentMap={newFileContentMap}
                alignedTopAnchors={alignedTopAnchors}
                newAlignmentOffset={newAlignmentOffset}
                alignmentBreakpoints={alignmentBreakpoints}
                store={store}
              />
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
