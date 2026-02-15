import { useCallback, useMemo, useRef } from "react";
import { observer, useLocalObservable } from "mobx-react-lite";
import { CodeDiffDrawer } from "../components/CodeDiffDrawer";
import { FileListPanel } from "../components/FileListPanel";
import { SplitGraphPanel, type GraphDiffTarget, type TopLevelAnchor } from "../components/SplitGraphPanel";
import { SplitGraphRuntimeProvider, type SplitGraphRuntimeContextValue } from "../components/splitGraph/context";
import { SymbolListPanel } from "../components/SymbolListPanel";
import type { FileSymbol, ViewportState } from "../types/graph";
import { LogicToolbar } from "./viewBase/LogicToolbar";
import {
  commandCodeLineClick,
  commandGoToGraphDiff,
  commandSelectFile,
  commandSelectNode,
  commandSelectSymbol,
  commandSetDiffTargets,
  commandSetTopLevelAnchors,
  commandSetViewport,
  commandToggleShowCalls,
} from "./viewBase/commands";
import { ViewBaseStore } from "./viewBase/store";
import { ViewBaseRuntimeProvider, type ViewBaseRuntimeContextValue } from "./viewBase/runtime";
import type { ViewType } from "./viewBase/types";
import { useInteractiveUpdate } from "./viewBase/useInteractiveUpdate";
import { useViewBaseEffects } from "./viewBase/useViewBaseEffects";
import {
  buildFileContentMap,
  computeAlignedTopAnchors,
  computeChangedNodeCount,
  computeDiffStats,
  computeDisplayGraph,
  computeFilteredNewGraph,
  computeFilteredOldGraph,
  computeNewAlignmentOffset,
  computeVisibleGraph,
  normalizePath,
} from "./viewBase/selectors";

interface ViewBaseProps {
  diffId: string;
  viewType: ViewType;
  showChangesOnly: boolean;
}

export const ViewBase = observer(({ diffId, viewType, showChangesOnly }: ViewBaseProps) => {
  const store = useLocalObservable(() => new ViewBaseStore());
  const codeDiffSectionRef = useRef<HTMLDivElement>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const { isUiPending, commandContext } = useInteractiveUpdate(store);

  const filteredOldGraph = useMemo(
    () => computeFilteredOldGraph(store.oldGraph),
    [store.oldGraph],
  );

  const filteredNewGraph = useMemo(
    () => computeFilteredNewGraph(store.newGraph),
    [store.newGraph],
  );

  const visibleOldGraph = useMemo(
    () => computeVisibleGraph(filteredOldGraph, filteredNewGraph, showChangesOnly, viewType),
    [filteredOldGraph, filteredNewGraph, showChangesOnly, viewType],
  );

  const visibleNewGraph = useMemo(
    () => computeVisibleGraph(filteredNewGraph, filteredOldGraph, showChangesOnly, viewType),
    [filteredOldGraph, filteredNewGraph, showChangesOnly, viewType],
  );

  const diffStats = useMemo(
    () => computeDiffStats(store.oldGraph, store.newGraph, store.selectedFilePath),
    [store.oldGraph, store.newGraph, store.selectedFilePath],
  );

  const displayOldGraph = useMemo(
    () => computeDisplayGraph(visibleOldGraph, store.selectedFilePath, viewType),
    [visibleOldGraph, store.selectedFilePath, viewType],
  );

  const displayNewGraph = useMemo(
    () => computeDisplayGraph(visibleNewGraph, store.selectedFilePath, viewType),
    [visibleNewGraph, store.selectedFilePath, viewType],
  );

  const isEmptyView = useMemo(
    () => displayOldGraph.nodes.length === 0 && displayNewGraph.nodes.length === 0,
    [displayOldGraph.nodes.length, displayNewGraph.nodes.length],
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
    const merged = [...store.oldDiffTargets, ...store.newDiffTargets];
    return merged.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  }, [store.oldDiffTargets, store.newDiffTargets]);

  const displayOldChangedCount = useMemo(
    () => computeChangedNodeCount(displayOldGraph),
    [displayOldGraph],
  );

  const displayNewChangedCount = useMemo(
    () => computeChangedNodeCount(displayNewGraph),
    [displayNewGraph],
  );

  const newAlignmentOffset = useMemo(
    () => computeNewAlignmentOffset(viewType, store.oldTopAnchors, store.newTopAnchors),
    [viewType, store.oldTopAnchors, store.newTopAnchors],
  );

  const alignedTopAnchors = useMemo(
    () => computeAlignedTopAnchors(viewType, store.oldTopAnchors, store.newTopAnchors),
    [viewType, store.oldTopAnchors, store.newTopAnchors],
  );

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

  const handleFileSelect = useCallback(
    (filePath: string) => {
      commandSelectFile(commandContext, filePath);
    },
    [commandContext],
  );

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

  const handleLayoutPendingChange = useCallback(
    (side: "old" | "new", pending: boolean) => {
      store.setLayoutPending(side, pending);
    },
    [store],
  );

  const splitGraphRuntime = useMemo<SplitGraphRuntimeContextValue>(() => ({
    state: {
      viewport: store.sharedViewport,
      selectedNodeId: store.selectedNodeId,
      highlightedNodeId: store.highlightedNodeId,
      focusNodeId: store.focusNodeId,
      focusNodeTick: store.focusNodeTick,
      focusSourceSide: store.targetSide,
      focusFilePath: store.selectedFilePath,
      focusFileTick: store.focusFileTick,
    },
    actions: {
      onNodeSelect: handleNodeSelect,
      onViewportChange: handleViewportChange,
      onDiffTargetsChange: handleDiffTargetsChange,
      onTopLevelAnchorsChange: handleTopLevelAnchorsChange,
      onLayoutPendingChange: handleLayoutPendingChange,
    },
  }), [
    handleDiffTargetsChange,
    handleLayoutPendingChange,
    handleNodeSelect,
    handleTopLevelAnchorsChange,
    handleViewportChange,
    store.focusFileTick,
    store.focusNodeId,
    store.focusNodeTick,
    store.highlightedNodeId,
    store.selectedFilePath,
    store.selectedNodeId,
    store.sharedViewport,
    store.targetSide,
  ]);

  const handleCodeLineClick = useCallback(
    (line: number, side: "old" | "new") => {
      commandCodeLineClick(
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

  const viewBaseRuntime = useMemo<ViewBaseRuntimeContextValue>(() => ({
    state: {
      files: store.fileDiffs,
      selectedFilePath: store.selectedFilePath,
      selectedFile,
      targetLine: store.targetLine,
      targetSide: store.targetSide,
      scrollTick: store.scrollTick,
    },
    actions: {
      onFileSelect: handleFileSelect,
      onCodeLineClick: handleCodeLineClick,
    },
  }), [
    handleCodeLineClick,
    handleFileSelect,
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

  useViewBaseEffects({
    store,
    diffId,
    viewType,
    hasSelectedFile: selectedFile !== null,
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

  const isInteractionPending = store.interactionBusy || isUiPending;

  return (
    <ViewBaseRuntimeProvider value={viewBaseRuntime}>
      <section className="viewContainer">
        {isInteractionPending && (
          <div className="interactionOverlay interactionOverlayLocal" role="status" aria-live="polite">
            <div className="spinner" />
            <p className="dimText">Updating graph...</p>
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
          <div className="splitLayout">
            <SplitGraphPanel
              title="Old"
              side="old"
              graph={displayOldGraph}
              viewType={viewType}
              showCalls={viewType === "logic" ? store.showCalls : true}
              fileContentMap={oldFileContentMap}
              alignmentAnchors={alignedTopAnchors.old}
              isViewportPrimary={false}
            />

            <SplitGraphPanel
              title="New"
              side="new"
              graph={displayNewGraph}
              viewType={viewType}
              showCalls={viewType === "logic" ? store.showCalls : true}
              diffStats={diffStats}
              fileContentMap={newFileContentMap}
              alignmentOffset={newAlignmentOffset}
              alignmentAnchors={alignedTopAnchors.new}
              isViewportPrimary
            />
          </div>
        </SplitGraphRuntimeProvider>

        {isEmptyView && (
          <p className="errorText">
            {store.selectedFilePath
              ? "No nodes found for this file. Try the Knowledge tab, or disable Changes Only."
              : "No nodes found for this view. Try the Knowledge tab, or disable Changes Only."}
          </p>
        )}

        <FileListPanel />

        {selectedSymbols.length > 0 && (
          <SymbolListPanel symbols={selectedSymbols} onSymbolClick={handleSymbolClick} />
        )}

        <div ref={codeDiffSectionRef}>
          <CodeDiffDrawer />
        </div>
      </section>
    </ViewBaseRuntimeProvider>
  );
});
