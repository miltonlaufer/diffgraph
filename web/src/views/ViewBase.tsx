import { useCallback, useEffect, useMemo, useRef } from "react";
import { observer, useLocalObservable } from "mobx-react-lite";
import { CodeDiffDrawer } from "../components/CodeDiffDrawer";
import { FileListPanel } from "../components/FileListPanel";
import { SplitGraphPanel, type GraphDiffTarget, type InternalNodeAnchor, type TopLevelAnchor } from "../components/SplitGraphPanel";
import { SplitGraphRuntimeProvider, type SplitGraphRuntimeContextValue } from "../components/splitGraph/context";
import { SymbolListPanel } from "../components/SymbolListPanel";
import type { FileSymbol, ViewportState } from "../types/graph";
import { LogicToolbar } from "./viewBase/LogicToolbar";
import {
  commandCodeLineClick,
  commandCodeLineDoubleClick,
  commandFocusGraphNode,
  commandGoToGraphDiff,
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
}

export const ViewBase = observer(({ diffId, viewType, showChangesOnly }: ViewBaseProps) => {
  const store = useLocalObservable(() => new ViewBaseStore());
  const graphSectionRef = useRef<HTMLDivElement>(null);
  const codeDiffSectionRef = useRef<HTMLDivElement>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const { isUiPending, commandContext } = useInteractiveUpdate(store);

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

  const viewBaseRuntime = useMemo<ViewBaseRuntimeContextValue>(() => ({
    state: {
      files: store.fileDiffs,
      selectedFilePath: store.selectedFilePath,
      selectedFile,
      targetLine: store.targetLine,
      targetSide: store.targetSide,
      scrollTick: store.scrollTick,
      codeSearchNavDirection: store.codeSearchNavDirection,
      codeSearchNavTick: store.codeSearchNavTick,
    },
    actions: {
      onFileSelect: handleFileSelect,
      onCodeLineClick: handleCodeLineClick,
      onCodeLineDoubleClick: handleCodeLineDoubleClick,
      onCodeSearchStateChange: handleCodeSearchStateChange,
    },
  }), [
    handleCodeLineClick,
    handleCodeLineDoubleClick,
    handleCodeSearchStateChange,
    handleFileSelect,
    store.codeSearchNavDirection,
    store.codeSearchNavTick,
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
          <div ref={graphSectionRef} className="splitLayout">
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
              alignmentBreakpoints={alignmentBreakpoints}
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
