import { useCallback, useEffect, useMemo, useRef, useTransition } from "react";
import { observer, useLocalObservable } from "mobx-react-lite";
import { fetchDiffFiles, fetchView } from "../api";
import { CodeDiffDrawer } from "../components/CodeDiffDrawer";
import { FileListPanel } from "../components/FileListPanel";
import { SplitGraphPanel, type GraphDiffTarget, type TopLevelAnchor } from "../components/SplitGraphPanel";
import { SymbolListPanel } from "../components/SymbolListPanel";
import type { FileSymbol, ViewportState } from "../types/graph";
import { LogicToolbar } from "./viewBase/LogicToolbar";
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

  const handleNodeSelect = useCallback(
    (nodeId: string, sourceSide: "old" | "new") => {
      runInteractiveUpdate(() => {
        store.setSelectedNodeId(nodeId);
        store.focusNode(nodeId);
        const matchedOld = store.oldGraph.nodes.find((n) => n.id === nodeId);
        const matchedNew = store.newGraph.nodes.find((n) => n.id === nodeId);
        const primary = sourceSide === "old" ? matchedOld : matchedNew;
        const fallback = sourceSide === "old" ? matchedNew : matchedOld;
        const filePath = primary?.filePath ?? fallback?.filePath ?? "";
        if (filePath.length > 0) {
          store.setSelectedFilePath(normalizePath(filePath));
        }
        const line = primary?.startLine ?? fallback?.startLine ?? 0;
        store.setTarget(line, sourceSide);
        store.bumpScrollTick();
      });
    },
    [runInteractiveUpdate, store],
  );

  const handleFileSelect = useCallback((filePath: string) => {
    runInteractiveUpdate(() => {
      store.setSelectedFilePath(filePath);
      store.bumpFocusFileTick();
    });
  }, [runInteractiveUpdate, store]);

  const handleSymbolClick = useCallback((startLine: number) => {
    store.setTarget(startLine, "new");
    store.bumpScrollTick();
  }, [store]);

  const handleViewportChange = useCallback((viewport: ViewportState) => {
    store.setSharedViewport(viewport);
  }, [store]);

  const handleShowCallsChange = useCallback((nextChecked: boolean) => {
    runInteractiveUpdate(() => {
      store.setShowCalls(nextChecked);
    });
  }, [runInteractiveUpdate, store]);

  const handleDiffTargetsChange = useCallback((side: "old" | "new", targets: GraphDiffTarget[]) => {
    store.setDiffTargets(side, targets);
  }, [store]);

  const handleTopLevelAnchorsChange = useCallback((side: "old" | "new", anchors: Record<string, TopLevelAnchor>) => {
    store.setTopLevelAnchors(side, anchors);
  }, [store]);

  const handleCodeLineClick = useCallback((line: number, side: "old" | "new") => {
    const filePath = normalizePath(selectedFile?.path ?? store.selectedFilePath);
    if (!filePath) return;

    const sideGraph = side === "old" ? displayOldGraph : displayNewGraph;
    const inFile = sideGraph.nodes.filter((n) => normalizePath(n.filePath) === filePath);
    if (inFile.length === 0) return;

    const withRange = inFile.filter(
      (n) =>
        (n.startLine ?? 0) > 0
        && (n.endLine ?? n.startLine ?? 0) >= (n.startLine ?? 0),
    );

    const containing = withRange.filter((n) => {
      const start = n.startLine ?? 0;
      const end = n.endLine ?? start;
      return line >= start && line <= end;
    });

    const candidates = containing.length > 0 ? containing : withRange;
    if (candidates.length === 0) return;

    candidates.sort((a, b) => {
      const aStart = a.startLine ?? 0;
      const aEnd = a.endLine ?? aStart;
      const bStart = b.startLine ?? 0;
      const bEnd = b.endLine ?? bStart;
      const aSpan = Math.max(1, aEnd - aStart + 1);
      const bSpan = Math.max(1, bEnd - bStart + 1);
      if (aSpan !== bSpan) return aSpan - bSpan;
      if (a.kind === "Branch" && b.kind !== "Branch") return -1;
      if (b.kind === "Branch" && a.kind !== "Branch") return 1;
      return Math.abs(aStart - line) - Math.abs(bStart - line);
    });

    const target = candidates[0];
    store.setSelectedNodeId(target.id);
    store.focusNode(target.id);
  }, [selectedFile, store, displayOldGraph, displayNewGraph]);

  const goToGraphDiff = useCallback((idx: number) => {
    if (graphDiffTargets.length === 0) return;
    const normalized = ((idx % graphDiffTargets.length) + graphDiffTargets.length) % graphDiffTargets.length;
    store.setGraphDiffIdx(normalized);
    const target = graphDiffTargets[normalized];
    store.setHighlightedNodeId(target.id);
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      store.clearHighlightedNode();
      highlightTimerRef.current = null;
    }, 1400);
    store.setSharedViewport({ x: target.viewportX, y: target.viewportY, zoom: target.viewportZoom });
  }, [graphDiffTargets, store]);

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
