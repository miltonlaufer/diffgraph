import { useCallback, useEffect, useMemo, useRef, useTransition } from "react";
import { observer, useLocalObservable } from "mobx-react-lite";
import { fetchDiffFiles, fetchView } from "../api";
import { CodeDiffDrawer } from "../components/CodeDiffDrawer";
import { FileListPanel } from "../components/FileListPanel";
import { SplitGraphPanel, type GraphDiffTarget, type TopLevelAnchor } from "../components/SplitGraphPanel";
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
import type { ViewType } from "./viewBase/types";
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
  const [isUiPending, startUiTransition] = useTransition();
  const codeDiffSectionRef = useRef<HTMLDivElement>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const didAutoViewportRef = useRef(false);
  const startRafRef = useRef<number | null>(null);
  const endRafRef = useRef<number | null>(null);
  const autoViewportRafRef = useRef<number | null>(null);
  const graphDiffIdxRafRef = useRef<number | null>(null);

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

  const cancelPendingFrames = useCallback(() => {
    if (startRafRef.current !== null) {
      window.cancelAnimationFrame(startRafRef.current);
      startRafRef.current = null;
    }
    if (endRafRef.current !== null) {
      window.cancelAnimationFrame(endRafRef.current);
      endRafRef.current = null;
    }
  }, []);

  const runInteractiveUpdate = useCallback((update: () => void) => {
    store.setInteractionBusy(true);
    cancelPendingFrames();
    startRafRef.current = window.requestAnimationFrame(() => {
      startRafRef.current = null;
      startUiTransition(() => {
        update();
      });
      endRafRef.current = window.requestAnimationFrame(() => {
        endRafRef.current = null;
        store.setInteractionBusy(false);
      });
    });
  }, [cancelPendingFrames, startUiTransition, store]);

  const commandContext = useMemo(
    () => ({ store, runInteractiveUpdate }),
    [store, runInteractiveUpdate],
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
      if (event.key === "Escape") {
        store.clearSelection();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [store]);

  useEffect(() => {
    let mounted = true;
    store.beginLoading();
    didAutoViewportRef.current = false;

    Promise.all([fetchView(diffId, viewType), fetchDiffFiles(diffId)])
      .then(([payload, files]) => {
        if (!mounted) return;
        store.applyFetchedData(payload.oldGraph, payload.newGraph, files);
      })
      .catch((reason: unknown) => {
        if (!mounted) return;
        store.setError(String(reason));
      });

    return () => {
      mounted = false;
    };
  }, [diffId, viewType, store]);

  useEffect(() => {
    if (store.scrollTick <= 0 || !selectedFile) return;
    requestAnimationFrame(() => {
      codeDiffSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [store.scrollTick, selectedFile]);

  useEffect(() => {
    if (graphDiffIdxRafRef.current !== null) {
      window.cancelAnimationFrame(graphDiffIdxRafRef.current);
      graphDiffIdxRafRef.current = null;
    }

    if (graphDiffTargets.length === 0) {
      if (store.graphDiffIdx !== 0) {
        graphDiffIdxRafRef.current = window.requestAnimationFrame(() => {
          graphDiffIdxRafRef.current = null;
          store.setGraphDiffIdx(0);
        });
      }
      return;
    }

    if (store.graphDiffIdx >= graphDiffTargets.length) {
      graphDiffIdxRafRef.current = window.requestAnimationFrame(() => {
        graphDiffIdxRafRef.current = null;
        store.setGraphDiffIdx(0);
      });
    }

    return () => {
      if (graphDiffIdxRafRef.current !== null) {
        window.cancelAnimationFrame(graphDiffIdxRafRef.current);
        graphDiffIdxRafRef.current = null;
      }
    };
  }, [graphDiffTargets.length, store.graphDiffIdx, store]);

  useEffect(() => {
    if (autoViewportRafRef.current !== null) {
      window.cancelAnimationFrame(autoViewportRafRef.current);
      autoViewportRafRef.current = null;
    }

    if (store.loading || didAutoViewportRef.current) return;

    if (viewType === "logic") {
      const oldKeys = Object.keys(store.oldTopAnchors);
      const newKeys = Object.keys(store.newTopAnchors);
      const hasCommonAnchor = oldKeys.some((key) => store.newTopAnchors[key] !== undefined);
      if (oldKeys.length > 0 && newKeys.length > 0 && hasCommonAnchor && !newAlignmentOffset) {
        return;
      }
    }

    const oldTargetsReady = displayOldChangedCount === 0 || store.oldDiffTargets.length > 0;
    const newTargetsReady = displayNewChangedCount === 0 || store.newDiffTargets.length > 0;
    if (!oldTargetsReady || !newTargetsReady) return;

    const sortedTargets = graphDiffTargets.length > 0
      ? graphDiffTargets
      : [...store.oldDiffTargets, ...store.newDiffTargets].sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const preferredTarget = sortedTargets.find((target) => target.kind !== "group") ?? sortedTargets[0];
    if (!preferredTarget) return;

    autoViewportRafRef.current = window.requestAnimationFrame(() => {
      autoViewportRafRef.current = null;
      didAutoViewportRef.current = true;
      store.setSharedViewport({
        x: preferredTarget.viewportX,
        y: preferredTarget.viewportY,
        zoom: preferredTarget.viewportZoom,
      });
    });

    return () => {
      if (autoViewportRafRef.current !== null) {
        window.cancelAnimationFrame(autoViewportRafRef.current);
        autoViewportRafRef.current = null;
      }
    };
  }, [
    store.loading,
    store.newDiffTargets,
    store.oldDiffTargets,
    graphDiffTargets,
    viewType,
    store.oldTopAnchors,
    store.newTopAnchors,
    newAlignmentOffset,
    displayOldChangedCount,
    displayNewChangedCount,
    store,
  ]);

  useEffect(() => () => {
    cancelPendingFrames();
    if (autoViewportRafRef.current !== null) {
      window.cancelAnimationFrame(autoViewportRafRef.current);
      autoViewportRafRef.current = null;
    }
    if (graphDiffIdxRafRef.current !== null) {
      window.cancelAnimationFrame(graphDiffIdxRafRef.current);
      graphDiffIdxRafRef.current = null;
    }
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
    }
  }, [cancelPendingFrames]);

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

      <div className="splitLayout">
        <SplitGraphPanel
          title="Old"
          side="old"
          graph={displayOldGraph}
          viewType={viewType}
          showCalls={viewType === "logic" ? store.showCalls : true}
          onNodeSelect={handleNodeSelect}
          viewport={store.sharedViewport}
          onViewportChange={handleViewportChange}
          selectedNodeId={store.selectedNodeId}
          highlightedNodeId={store.highlightedNodeId}
          focusNodeId={store.focusNodeId}
          focusNodeTick={store.focusNodeTick}
          focusFilePath={store.selectedFilePath}
          focusFileTick={store.focusFileTick}
          fileContentMap={oldFileContentMap}
          onDiffTargetsChange={handleDiffTargetsChange}
          alignmentAnchors={alignedTopAnchors.old}
          onTopLevelAnchorsChange={handleTopLevelAnchorsChange}
        />

        <SplitGraphPanel
          title="New"
          side="new"
          graph={displayNewGraph}
          viewType={viewType}
          showCalls={viewType === "logic" ? store.showCalls : true}
          onNodeSelect={handleNodeSelect}
          viewport={store.sharedViewport}
          onViewportChange={handleViewportChange}
          selectedNodeId={store.selectedNodeId}
          highlightedNodeId={store.highlightedNodeId}
          focusNodeId={store.focusNodeId}
          focusNodeTick={store.focusNodeTick}
          focusFilePath={store.selectedFilePath}
          focusFileTick={store.focusFileTick}
          diffStats={diffStats}
          fileContentMap={newFileContentMap}
          onDiffTargetsChange={handleDiffTargetsChange}
          alignmentOffset={newAlignmentOffset}
          alignmentAnchors={alignedTopAnchors.new}
          onTopLevelAnchorsChange={handleTopLevelAnchorsChange}
        />
      </div>

      {isEmptyView && (
        <p className="errorText">
          {store.selectedFilePath
            ? "No nodes found for this file. Try the Knowledge tab, or disable Changes Only."
            : "No nodes found for this view. Try the Knowledge tab, or disable Changes Only."}
        </p>
      )}

      <FileListPanel
        files={store.fileDiffs}
        selectedFilePath={store.selectedFilePath}
        onFileSelect={handleFileSelect}
      />

      {selectedSymbols.length > 0 && (
        <SymbolListPanel symbols={selectedSymbols} onSymbolClick={handleSymbolClick} />
      )}

      <div ref={codeDiffSectionRef}>
        <CodeDiffDrawer
          file={selectedFile}
          targetLine={store.targetLine}
          targetSide={store.targetSide}
          scrollTick={store.scrollTick}
          onLineClick={handleCodeLineClick}
        />
      </div>
    </section>
  );
});
