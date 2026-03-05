import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import { Group, Panel, Separator } from "react-resizable-panels";
import { CodeDiffDrawer } from "../components/CodeDiffDrawer";
import { ConfirmModal } from "../components/ConfirmModal";
import { FileListPanel } from "../components/FileListPanel";
import PullRequestConversationModal from "../components/PullRequestConversationModal";
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
import { fetchPullRequestReviewThreads, type PullRequestReviewThread } from "#/api";
import { getCachedReviewThreads, setCachedReviewThreads } from "#/lib/diffPrefetch";

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
  const [pendingNodeSelect, setPendingNodeSelect] = useState<{
    nodeId: string;
    sourceSide: "old" | "new";
  } | null>(null);
  const [pullRequestReviewThreads, setPullRequestReviewThreads] = useState<PullRequestReviewThread[]>([]);
  const [activeReviewThreadIds, setActiveReviewThreadIds] = useState<string[]>([]);
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

  const selectedFilePathsForGraphSnapshot = [...store.selectedFilePathsForGraph].sort().join("\0");
  const derivedInput = useMemo(
    () => ({
      oldGraph: store.oldGraph,
      newGraph: store.newGraph,
      selectedFilePathsForGraph: [...store.selectedFilePathsForGraph],
      showChangesOnly: store.showChangesOnly,
      viewType: store.viewType as "logic" | "knowledge" | "react",
    }),
    [
      store.showChangesOnly,
      store.newGraph,
      store.oldGraph,
      selectedFilePathsForGraphSnapshot,
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

  const hoveredNodeFilePath = useMemo(() => {
    if (!store.hoveredNodeId || !store.areNodesSelected) return "";
    const sourceGraph = store.hoveredNodeSide === "old" ? store.oldGraph : store.newGraph;
    const node = sourceGraph.nodes.find((n) => n.id === store.hoveredNodeId);
    return node?.filePath ?? "";
  }, [
    store.areNodesSelected,
    store.hoveredNodeId,
    store.hoveredNodeSide,
    store.newGraph,
    store.oldGraph,
  ]);

  const effectiveFilePathForDiff = useMemo(() => {
    if (!store.areNodesSelected) return "";
    if (hoveredNodeFilePath) return hoveredNodeFilePath;
    return store.selectedFilePath;
  }, [store.areNodesSelected, store.selectedFilePath, hoveredNodeFilePath]);

  const selectedFile = useMemo(
    () =>
      effectiveFilePathForDiff
        ? store.fileDiffs.find((entry) => normalizePath(entry.path) === normalizePath(effectiveFilePathForDiff)) ?? null
        : null,
    [store.fileDiffs, effectiveFilePathForDiff],
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
  const pathAliasesByPath = useMemo(() => {
    const aliasSets = new Map<string, Set<string>>();
    const normalizedPathSet = new Set<string>();
    const addPathAliases = (paths: string[]): void => {
      const normalizedPaths = [...new Set(
        paths
          .map((path) => normalizePath(path))
          .filter((path) => path.length > 0),
      )];
      if (normalizedPaths.length <= 1) return;
      for (const path of normalizedPaths) {
        const aliases = aliasSets.get(path) ?? new Set<string>();
        for (const alias of normalizedPaths) {
          if (alias === path) continue;
          aliases.add(alias);
        }
        aliasSets.set(path, aliases);
      }
    };
    const hasSharedPathSuffix = (a: string, b: string): boolean => {
      const aParts = a.split("/").filter((part) => part.length > 0);
      const bParts = b.split("/").filter((part) => part.length > 0);
      let sharedCount = 0;
      while (
        sharedCount < aParts.length
        && sharedCount < bParts.length
        && aParts[aParts.length - 1 - sharedCount] === bParts[bParts.length - 1 - sharedCount]
      ) {
        sharedCount += 1;
      }
      return sharedCount >= 2;
    };

    for (const file of store.fileDiffs) {
      addPathAliases([file.path, file.oldPath ?? "", file.newPath ?? ""]);
      const normalizedPath = normalizePath(file.path);
      if (normalizedPath.length > 0) normalizedPathSet.add(normalizedPath);
      const normalizedOldPath = normalizePath(file.oldPath ?? "");
      if (normalizedOldPath.length > 0) normalizedPathSet.add(normalizedOldPath);
      const normalizedNewPath = normalizePath(file.newPath ?? "");
      if (normalizedNewPath.length > 0) normalizedPathSet.add(normalizedNewPath);
    }

    const pathsByBasename = new Map<string, string[]>();
    for (const path of normalizedPathSet) {
      const segments = path.split("/");
      const basename = segments[segments.length - 1]?.trim() ?? "";
      if (!basename) continue;
      const group = pathsByBasename.get(basename);
      if (group) {
        group.push(path);
      } else {
        pathsByBasename.set(basename, [path]);
      }
    }

    for (const paths of pathsByBasename.values()) {
      if (paths.length < 2 || paths.length > 4) continue;
      for (let index = 0; index < paths.length; index += 1) {
        for (let otherIndex = index + 1; otherIndex < paths.length; otherIndex += 1) {
          const a = paths[index];
          const b = paths[otherIndex];
          if (!hasSharedPathSuffix(a, b)) continue;
          addPathAliases([a, b]);
        }
      }
    }

    return new Map(
      [...aliasSets.entries()].map(([path, aliases]) => [path, [...aliases]]),
    );
  }, [store.fileDiffs]);

  const handleNodeSelect = useCallback(
    (nodeId: string, sourceSide: "old" | "new") => {
      const multiFileSelected =
        store.areNodesSelected && store.selectedFilePathsForGraph.length > 1;
      if (multiFileSelected) {
        setPendingNodeSelect({ nodeId, sourceSide });
        return;
      }
      commandSelectNode(commandContext, nodeId, sourceSide);
    },
    [commandContext, store.areNodesSelected, store.selectedFilePathsForGraph.length],
  );

  const handleConfirmNodeSelect = useCallback(() => {
    if (!pendingNodeSelect) return;
    commandSelectNode(commandContext, pendingNodeSelect.nodeId, pendingNodeSelect.sourceSide);
    setPendingNodeSelect(null);
  }, [commandContext, pendingNodeSelect]);

  const handleCancelNodeSelect = useCallback(() => {
    setPendingNodeSelect(null);
  }, []);

  const handleOpenReviewThreads = useCallback((threadIds: string[]) => {
    const deduplicated = [...new Set(threadIds)].filter((threadId) => threadId.length > 0);
    if (deduplicated.length === 0) return;
    setActiveReviewThreadIds(deduplicated);
  }, []);

  const handleCloseReviewThreads = useCallback(() => {
    setActiveReviewThreadIds([]);
  }, []);

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

  const handleFileHover = useCallback(() => {
    // Commented out: file list hover not working correctly
    // store.setHoveredFilePathFromList(filePath);
  }, []);

  const handleFileHoverClear = useCallback(() => {
    // Commented out: file list hover not working correctly
    // store.setHoveredFilePathFromList("");
  }, []);

  const handleToggleFileForGraph = useCallback(
    (filePath: string) => {
      commandContext.runInteractiveUpdate(() => {
        const allPaths = store.fileDiffs.map((f) =>
          f.path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, ""),
        );
        store.toggleFileForGraph(filePath, allPaths);
      });
    },
    [commandContext, store],
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
      areNodesSelected: store.areNodesSelected,
      hoveredNodeId: store.hoveredNodeId,
      hoveredNodeMatchKey: store.hoveredNodeMatchKey,
      hoveredNodeSide: store.hoveredNodeSide as "old" | "new" | "",
      hoveredFilePathFromList: store.hoveredFilePathFromList,
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
    store.areNodesSelected,
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
    store.hoveredFilePathFromList,
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
      selectedFilePathsForGraph: [...store.selectedFilePathsForGraph],
      areNodesSelected: store.areNodesSelected,
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
      onFileHover: handleFileHover,
      onFileHoverClear: handleFileHoverClear,
      onToggleFileForGraph: handleToggleFileForGraph,
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
    handleFileHover,
    handleFileHoverClear,
    handleFileSelect,
    handleToggleFileForGraph,
    handleToggleFileListCollapsed,
    store.codeSearchNavDirection,
    store.codeSearchNavTick,
    store.codeLogicTreeRequestTick,
    store.codeLogicTreeRequestSide,
    store.codeLogicTreeRequestLines,
    store.areNodesSelected,
    store.fileListCollapsed,
    selectedFilePathsForGraphSnapshot,
    store.hoveredCodeLine,
    store.hoveredCodeSide,
    selectedFile,
    store.fileDiffs,
    store.scrollTick,
    store.selectedFilePath,
    store.targetLine,
    store.targetSide,
  ]);

  const activeReviewThreads = useMemo(() => {
    if (activeReviewThreadIds.length === 0 || pullRequestReviewThreads.length === 0) return [];
    const threadById = new Map(pullRequestReviewThreads.map((thread) => [thread.id, thread]));
    return activeReviewThreadIds
      .map((threadId) => threadById.get(threadId))
      .filter((thread): thread is PullRequestReviewThread => thread !== undefined);
  }, [activeReviewThreadIds, pullRequestReviewThreads]);

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

  useEffect(() => {
    let mounted = true;
    setPullRequestReviewThreads([]);
    setActiveReviewThreadIds([]);
    const cachedReviewThreads = getCachedReviewThreads(diffId);
    if (cachedReviewThreads) {
      setPullRequestReviewThreads(cachedReviewThreads);
      return () => {
        mounted = false;
      };
    }
    fetchPullRequestReviewThreads(diffId)
      .then((threads) => {
        if (!mounted) return;
        setCachedReviewThreads(diffId, threads);
        setPullRequestReviewThreads(threads);
      })
      .catch(() => {
        if (!mounted) return;
        setPullRequestReviewThreads([]);
      });
    return () => {
      mounted = false;
    };
  }, [diffId]);

  useEffect(() => {
    if (activeReviewThreadIds.length === 0) return;
    const validThreadIds = new Set(pullRequestReviewThreads.map((thread) => thread.id));
    const filtered = activeReviewThreadIds.filter((threadId) => validThreadIds.has(threadId));
    if (filtered.length === activeReviewThreadIds.length) return;
    setActiveReviewThreadIds(filtered);
  }, [activeReviewThreadIds, pullRequestReviewThreads]);

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

        <ConfirmModal
          open={pendingNodeSelect !== null}
          title="Select single file"
          message="This will de-select all the other files that are currently selected and select only the file and the nodes related to the one you clicked. Are you sure you want to proceed?"
          onConfirm={handleConfirmNodeSelect}
          onCancel={handleCancelNodeSelect}
          confirmLabel="OK"
          cancelLabel="Cancel"
          ariaLabel="Confirm single file selection"
        />

        {store.viewType === "logic" && (
          <LogicToolbar
            showCalls={store.showCalls}
            diffCountLabel={graphDiffTargets.length > 0 ? `${store.graphDiffIdx + 1}/${graphDiffTargets.length}` : "0/0"}
            canNavigate={graphDiffTargets.length > 0}
            hasSelectedNode={store.hasSelectedNode}
            searchActive={store.hasSearchActive}
            multipleFilesSelected={store.selectedFilePathsForGraph.length > 1}
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
                pathAliasesByPath={pathAliasesByPath}
                store={store}
                pullRequestReviewThreads={pullRequestReviewThreads}
                onOpenReviewThreads={handleOpenReviewThreads}
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
                    <CodeDiffDrawer
                      pathAliasesByPath={pathAliasesByPath}
                      pullRequestReviewThreads={pullRequestReviewThreads}
                      onOpenReviewThreads={handleOpenReviewThreads}
                    />
                  </div>
                </div>
              </div>
            </Panel>
          </Group>
        </SplitGraphRuntimeProvider>

        <PullRequestConversationModal
          open={activeReviewThreads.length > 0}
          threads={activeReviewThreads}
          onClose={handleCloseReviewThreads}
        />

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
