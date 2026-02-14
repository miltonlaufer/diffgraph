import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { fetchDiffFiles, fetchView } from "../api";
import { CodeDiffDrawer } from "../components/CodeDiffDrawer";
import { FileListPanel } from "../components/FileListPanel";
import { SplitGraphPanel, type GraphDiffTarget } from "../components/SplitGraphPanel";
import { SymbolListPanel } from "../components/SymbolListPanel";
import type { FileDiffEntry, FileSymbol, ViewGraph, ViewportState } from "../types/graph";

interface ViewBaseProps {
  diffId: string;
  viewType: "logic" | "knowledge" | "react";
  showChangesOnly: boolean;
}

const normalizePath = (value: string): string =>
  value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");

const functionIdentityFromLabel = (label: string): string => {
  const noBadge = label.replace(/^\[[^\]]+\]\s*/, "").trim();
  const idx = noBadge.indexOf("(");
  return (idx >= 0 ? noBadge.slice(0, idx) : noBadge).trim().toLowerCase();
};

const includeHierarchyAncestors = (graph: ViewGraph, seedIds: Set<string>): Set<string> => {
  const keepIds = new Set(seedIds);
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const id of [...seedIds]) {
    let current = nodeById.get(id);
    while (current?.parentId) {
      if (keepIds.has(current.parentId)) break;
      keepIds.add(current.parentId);
      current = nodeById.get(current.parentId);
    }
  }
  return keepIds;
};

const includeInvokeNeighbors = (graph: ViewGraph, seedIds: Set<string>): Set<string> => {
  const keepIds = new Set(seedIds);
  for (const edge of graph.edges) {
    const isInvoke = edge.relation === "invoke";
    if (!isInvoke) continue;
    if (keepIds.has(edge.source) || keepIds.has(edge.target)) {
      keepIds.add(edge.source);
      keepIds.add(edge.target);
    }
  }
  return keepIds;
};

const includeHierarchyDescendants = (graph: ViewGraph, seedIds: Set<string>): Set<string> => {
  const keepIds = new Set(seedIds);
  const childrenByParent = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (!node.parentId) continue;
    if (!childrenByParent.has(node.parentId)) {
      childrenByParent.set(node.parentId, []);
    }
    childrenByParent.get(node.parentId)!.push(node.id);
  }
  const queue = [...seedIds];
  while (queue.length > 0) {
    const parentId = queue.shift();
    if (!parentId) continue;
    const children = childrenByParent.get(parentId) ?? [];
    for (const childId of children) {
      if (keepIds.has(childId)) continue;
      keepIds.add(childId);
      queue.push(childId);
    }
  }
  return keepIds;
};

const viewNodeKey = (node: ViewGraph["nodes"][number]): string =>
  `${node.kind}:${normalizePath(node.filePath)}:${(node.className ?? "").trim().toLowerCase()}:${functionIdentityFromLabel(node.label)}`;

export const ViewBase = ({ diffId, viewType, showChangesOnly }: ViewBaseProps) => {
  /******************* STORE ***********************/
  const [oldGraph, setOldGraph] = useState<ViewGraph>({ nodes: [], edges: [] });
  const [newGraph, setNewGraph] = useState<ViewGraph>({ nodes: [], edges: [] });
  const [fileDiffs, setFileDiffs] = useState<FileDiffEntry[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string>("");
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const [targetLine, setTargetLine] = useState<number>(0);
  const [targetSide, setTargetSide] = useState<"old" | "new">("new");
  const [scrollTick, setScrollTick] = useState<number>(0);
  const [sharedViewport, setSharedViewport] = useState<ViewportState>({ x: 0, y: 0, zoom: 0.8 });
  const [showCalls, setShowCalls] = useState(true);
  const [oldDiffTargets, setOldDiffTargets] = useState<GraphDiffTarget[]>([]);
  const [newDiffTargets, setNewDiffTargets] = useState<GraphDiffTarget[]>([]);
  const [oldTopAnchors, setOldTopAnchors] = useState<Record<string, { x: number; y: number }>>({});
  const [newTopAnchors, setNewTopAnchors] = useState<Record<string, { x: number; y: number }>>({});
  const [graphDiffIdx, setGraphDiffIdx] = useState(0);
  const [highlightedNodeId, setHighlightedNodeId] = useState<string>("");
  const [focusNodeId, setFocusNodeId] = useState<string>("");
  const [focusNodeTick, setFocusNodeTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [interactionBusy, setInteractionBusy] = useState(false);
  const [isUiPending, startUiTransition] = useTransition();
  const codeDiffSectionRef = useRef<HTMLDivElement>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const didAutoViewportRef = useRef(false);
  const startRafRef = useRef<number | null>(null);
  const endRafRef = useRef<number | null>(null);

  /******************* COMPUTED ***********************/
  const filteredOldGraph = useMemo(() => {
    const nodes = oldGraph.nodes.filter((n) => n.diffStatus !== "added");
    const nodeIds = new Set(nodes.map((n) => n.id));
    return {
      nodes,
      edges: oldGraph.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)),
    };
  }, [oldGraph]);

  const filteredNewGraph = useMemo(() => {
    const nodes = newGraph.nodes.filter((n) => n.diffStatus !== "removed");
    const nodeIds = new Set(nodes.map((n) => n.id));
    return {
      nodes,
      edges: newGraph.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)),
    };
  }, [newGraph]);

  const visibleOldGraph = useMemo(() => {
    if (!showChangesOnly) return filteredOldGraph;
    const changedIds = new Set(filteredOldGraph.nodes.filter((n) => n.diffStatus !== "unchanged").map((n) => n.id));
    const otherChangedKeys = new Set(
      filteredNewGraph.nodes.filter((n) => n.diffStatus === "modified").map((n) => viewNodeKey(n)),
    );
    const counterpartIds = new Set(
      filteredOldGraph.nodes.filter((n) => otherChangedKeys.has(viewNodeKey(n))).map((n) => n.id),
    );
    let keepIds = new Set([...changedIds, ...counterpartIds]);
    keepIds = includeHierarchyAncestors(filteredOldGraph, keepIds);
    if (viewType === "logic") {
      const groupSeedIds = new Set(
        filteredOldGraph.nodes.filter((n) => keepIds.has(n.id) && n.kind === "group").map((n) => n.id),
      );
      keepIds = includeHierarchyDescendants(filteredOldGraph, groupSeedIds);
      keepIds = includeHierarchyAncestors(filteredOldGraph, keepIds);
      keepIds = includeInvokeNeighbors(filteredOldGraph, keepIds);
      keepIds = includeHierarchyAncestors(filteredOldGraph, keepIds);
    }
    return {
      nodes: filteredOldGraph.nodes.filter((n) => keepIds.has(n.id)),
      edges: filteredOldGraph.edges.filter((e) => keepIds.has(e.source) && keepIds.has(e.target)),
    };
  }, [filteredOldGraph, filteredNewGraph, showChangesOnly, viewType]);

  const visibleNewGraph = useMemo(() => {
    if (!showChangesOnly) return filteredNewGraph;
    const changedIds = new Set(filteredNewGraph.nodes.filter((n) => n.diffStatus !== "unchanged").map((n) => n.id));
    const otherChangedKeys = new Set(
      filteredOldGraph.nodes.filter((n) => n.diffStatus === "modified").map((n) => viewNodeKey(n)),
    );
    const counterpartIds = new Set(
      filteredNewGraph.nodes.filter((n) => otherChangedKeys.has(viewNodeKey(n))).map((n) => n.id),
    );
    let keepIds = new Set([...changedIds, ...counterpartIds]);
    keepIds = includeHierarchyAncestors(filteredNewGraph, keepIds);
    if (viewType === "logic") {
      const groupSeedIds = new Set(
        filteredNewGraph.nodes.filter((n) => keepIds.has(n.id) && n.kind === "group").map((n) => n.id),
      );
      keepIds = includeHierarchyDescendants(filteredNewGraph, groupSeedIds);
      keepIds = includeHierarchyAncestors(filteredNewGraph, keepIds);
      keepIds = includeInvokeNeighbors(filteredNewGraph, keepIds);
      keepIds = includeHierarchyAncestors(filteredNewGraph, keepIds);
    }
    return {
      nodes: filteredNewGraph.nodes.filter((n) => keepIds.has(n.id)),
      edges: filteredNewGraph.edges.filter((e) => keepIds.has(e.source) && keepIds.has(e.target)),
    };
  }, [filteredOldGraph, filteredNewGraph, showChangesOnly, viewType]);

  const diffStats = useMemo(() => {
    let oldNodes = oldGraph.nodes;
    let newNodes = newGraph.nodes;
    if (selectedFilePath) {
      const target = normalizePath(selectedFilePath);
      oldNodes = oldNodes.filter((n) => normalizePath(n.filePath) === target);
      newNodes = newNodes.filter((n) => normalizePath(n.filePath) === target);
    }
    const allNodes = [...oldNodes, ...newNodes];
    return {
      added: allNodes.filter((n) => n.diffStatus === "added").length,
      removed: allNodes.filter((n) => n.diffStatus === "removed").length,
      modified: new Set(allNodes.filter((n) => n.diffStatus === "modified").map((n) => n.label)).size,
    };
  }, [oldGraph.nodes, newGraph.nodes, selectedFilePath]);

  const displayOldGraph = useMemo(() => {
    if (!selectedFilePath) return visibleOldGraph;
    const normalizedTarget = normalizePath(selectedFilePath);
    let nodeIds = new Set(
      visibleOldGraph.nodes
        .filter((n) => normalizePath(n.filePath) === normalizedTarget)
        .map((n) => n.id),
    );
    if (viewType === "logic") {
      nodeIds = includeInvokeNeighbors(visibleOldGraph, nodeIds);
      nodeIds = includeHierarchyAncestors(visibleOldGraph, nodeIds);
    }
    const nodes = visibleOldGraph.nodes.filter((n) => nodeIds.has(n.id));
    return {
      nodes,
      edges: visibleOldGraph.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)),
    };
  }, [selectedFilePath, visibleOldGraph, viewType]);

  const displayNewGraph = useMemo(() => {
    if (!selectedFilePath) return visibleNewGraph;
    const normalizedTarget = normalizePath(selectedFilePath);
    let nodeIds = new Set(
      visibleNewGraph.nodes
        .filter((n) => normalizePath(n.filePath) === normalizedTarget)
        .map((n) => n.id),
    );
    if (viewType === "logic") {
      nodeIds = includeInvokeNeighbors(visibleNewGraph, nodeIds);
      nodeIds = includeHierarchyAncestors(visibleNewGraph, nodeIds);
    }
    const nodes = visibleNewGraph.nodes.filter((n) => nodeIds.has(n.id));
    return {
      nodes,
      edges: visibleNewGraph.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)),
    };
  }, [selectedFilePath, visibleNewGraph, viewType]);

  const isEmptyView = useMemo(
    () => displayOldGraph.nodes.length === 0 && displayNewGraph.nodes.length === 0,
    [displayOldGraph.nodes.length, displayNewGraph.nodes.length],
  );

  const selectedFile = useMemo(
    () =>
      fileDiffs.find((entry) => normalizePath(entry.path) === normalizePath(selectedFilePath)) ?? null,
    [fileDiffs, selectedFilePath],
  );

  const selectedSymbols = useMemo<FileSymbol[]>(
    () => selectedFile?.symbols ?? [],
    [selectedFile],
  );

  const graphDiffTargets = useMemo(() => {
    const merged = [...oldDiffTargets, ...newDiffTargets];
    return merged.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  }, [oldDiffTargets, newDiffTargets]);
  const newAlignmentOffset = useMemo(() => {
    if (viewType !== "logic") return undefined;
    const keys = Object.keys(oldTopAnchors).filter((key) => newTopAnchors[key] !== undefined);
    if (keys.length === 0) return undefined;
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (const key of keys) {
      const oldPt = oldTopAnchors[key];
      const newPt = newTopAnchors[key];
      if (!oldPt || !newPt) continue;
      sumX += oldPt.x - newPt.x;
      sumY += oldPt.y - newPt.y;
      count += 1;
    }
    if (count === 0) return undefined;
    return {
      x: sumX / count,
      y: sumY / count,
    };
  }, [oldTopAnchors, newTopAnchors, viewType]);

  const oldFileContentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of fileDiffs) {
      map.set(normalizePath(f.path), f.oldContent);
    }
    return map;
  }, [fileDiffs]);

  const newFileContentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of fileDiffs) {
      map.set(normalizePath(f.path), f.newContent);
    }
    return map;
  }, [fileDiffs]);

  /******************* FUNCTIONS ***********************/
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
    setInteractionBusy(true);
    cancelPendingFrames();
    startRafRef.current = window.requestAnimationFrame(() => {
      startRafRef.current = null;
      startUiTransition(() => {
        update();
      });
      endRafRef.current = window.requestAnimationFrame(() => {
        endRafRef.current = null;
        setInteractionBusy(false);
      });
    });
  }, [cancelPendingFrames, startUiTransition]);

  const handleNodeSelect = useCallback(
    (nodeId: string, sourceSide: "old" | "new") => {
      runInteractiveUpdate(() => {
        setSelectedNodeId(nodeId);
        const matchedOld = oldGraph.nodes.find((n) => n.id === nodeId);
        const matchedNew = newGraph.nodes.find((n) => n.id === nodeId);
        const primary = sourceSide === "old" ? matchedOld : matchedNew;
        const fallback = sourceSide === "old" ? matchedNew : matchedOld;
        const filePath = primary?.filePath ?? fallback?.filePath ?? "";
        if (filePath.length > 0) {
          setSelectedFilePath(normalizePath(filePath));
        }
        const line = primary?.startLine ?? fallback?.startLine ?? 0;
        setTargetLine(line);
        setTargetSide(sourceSide);
        setScrollTick((prev) => prev + 1);
      });
    },
    [oldGraph.nodes, newGraph.nodes, runInteractiveUpdate],
  );

  const handleFileSelect = useCallback((filePath: string) => {
    runInteractiveUpdate(() => {
      setSelectedFilePath(filePath);
    });
  }, [runInteractiveUpdate]);

  const handleSymbolClick = useCallback((startLine: number) => {
    setTargetLine(startLine);
    setTargetSide("new");
    setScrollTick((prev) => prev + 1);
  }, []);

  const handleViewportChange = useCallback((vp: ViewportState) => {
    setSharedViewport(vp);
  }, []);

  const handleShowCallsChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const nextChecked = e.target.checked;
    runInteractiveUpdate(() => {
      setShowCalls(nextChecked);
    });
  }, [runInteractiveUpdate]);

  const handleDiffTargetsChange = useCallback((side: "old" | "new", targets: GraphDiffTarget[]) => {
    if (side === "old") {
      setOldDiffTargets(targets);
      return;
    }
    setNewDiffTargets(targets);
  }, []);
  const handleTopLevelAnchorsChange = useCallback((side: "old" | "new", anchors: Record<string, { x: number; y: number }>) => {
    if (side === "old") {
      setOldTopAnchors(anchors);
      return;
    }
    setNewTopAnchors(anchors);
  }, []);

  const handleCodeLineClick = useCallback((line: number, side: "old" | "new") => {
    const filePath = normalizePath(selectedFile?.path ?? selectedFilePath);
    if (!filePath) return;
    const sideGraph = side === "old" ? displayOldGraph : displayNewGraph;
    const inFile = sideGraph.nodes.filter((n) => normalizePath(n.filePath) === filePath);
    if (inFile.length === 0) return;

    const withRange = inFile.filter((n) => (n.startLine ?? 0) > 0 && (n.endLine ?? n.startLine ?? 0) >= (n.startLine ?? 0));
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
    setSelectedNodeId(target.id);
    setFocusNodeId(target.id);
    setFocusNodeTick((prev) => prev + 1);
  }, [selectedFile, selectedFilePath, displayOldGraph, displayNewGraph]);

  const goToGraphDiff = useCallback((idx: number) => {
    if (graphDiffTargets.length === 0) return;
    const normalized = ((idx % graphDiffTargets.length) + graphDiffTargets.length) % graphDiffTargets.length;
    setGraphDiffIdx(normalized);
    const target = graphDiffTargets[normalized];
    setHighlightedNodeId(target.id);
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedNodeId("");
      highlightTimerRef.current = null;
    }, 1400);
    setSharedViewport({ x: target.viewportX, y: target.viewportY, zoom: target.viewportZoom });
  }, [graphDiffTargets]);

  const goToPrevGraphDiff = useCallback(() => {
    goToGraphDiff(graphDiffIdx - 1);
  }, [goToGraphDiff, graphDiffIdx]);

  const goToNextGraphDiff = useCallback(() => {
    goToGraphDiff(graphDiffIdx + 1);
  }, [goToGraphDiff, graphDiffIdx]);

  /******************* USEEFFECTS ***********************/
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setSelectedNodeId("");
        setSelectedFilePath("");
        setTargetLine(0);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    didAutoViewportRef.current = false;
    Promise.all([fetchView(diffId, viewType), fetchDiffFiles(diffId)])
      .then(([payload, files]) => {
        if (!mounted) return;
        setOldGraph(payload.oldGraph);
        setNewGraph(payload.newGraph);
        setOldTopAnchors({});
        setNewTopAnchors({});
        setFileDiffs(files);
        setSelectedFilePath("");
        setSharedViewport({ x: 20, y: 20, zoom: 0.5 });
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (!mounted) return;
        setError(String(reason));
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [diffId, viewType]);

  useEffect(() => {
    if (scrollTick <= 0 || !selectedFile) return;
    requestAnimationFrame(() => {
      codeDiffSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [scrollTick, selectedFile]);

  useEffect(() => {
    if (graphDiffTargets.length === 0) {
      if (graphDiffIdx !== 0) setGraphDiffIdx(0);
      return;
    }
    if (graphDiffIdx >= graphDiffTargets.length) {
      setGraphDiffIdx(0);
    }
  }, [graphDiffTargets.length, graphDiffIdx]);

  useEffect(() => {
    if (loading || didAutoViewportRef.current) return;
    if (viewType === "logic") {
      const oldKeys = Object.keys(oldTopAnchors);
      const newKeys = Object.keys(newTopAnchors);
      const hasCommonAnchor = oldKeys.some((key) => newTopAnchors[key] !== undefined);
      if (oldKeys.length > 0 && newKeys.length > 0 && hasCommonAnchor && !newAlignmentOffset) {
        return;
      }
    }
    const preferredTarget = oldDiffTargets[0] ?? newDiffTargets[0] ?? graphDiffTargets[0];
    if (!preferredTarget) return;
    didAutoViewportRef.current = true;
    setSharedViewport({
      x: preferredTarget.viewportX,
      y: preferredTarget.viewportY,
      zoom: preferredTarget.viewportZoom,
    });
  }, [loading, newDiffTargets, oldDiffTargets, graphDiffTargets, viewType, oldTopAnchors, newTopAnchors, newAlignmentOffset]);

  useEffect(() => () => {
    cancelPendingFrames();
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
    }
  }, [cancelPendingFrames]);

  if (error) {
    return <p className="errorText">{error}</p>;
  }

  if (loading) {
    return (
      <section className="viewContainer">
        <div className="loadingContainer">
          <div className="spinner" />
          <p className="dimText">Analyzing code and building graphs...</p>
        </div>
      </section>
    );
  }

  const isInteractionPending = interactionBusy || isUiPending;

  return (
    <section className="viewContainer">
      {isInteractionPending && (
        <div className="interactionOverlay interactionOverlayLocal" role="status" aria-live="polite">
          <div className="spinner" />
          <p className="dimText">Updating graph...</p>
        </div>
      )}
      {viewType === "logic" && (
        <div className="logicToolbar">
          <label className="showCallsLabel">
            <input type="checkbox" checked={showCalls} onChange={handleShowCallsChange} className="showCallsCheckbox" />
            Show calls
          </label>
          <div className="graphDiffNav">
            <span className="diffCount">{graphDiffTargets.length > 0 ? `${graphDiffIdx + 1}/${graphDiffTargets.length}` : "0/0"}</span>
            <button type="button" className="diffNavBtn" onClick={goToPrevGraphDiff} disabled={graphDiffTargets.length === 0} title="Previous graph change">
              &#9650;
            </button>
            <button type="button" className="diffNavBtn" onClick={goToNextGraphDiff} disabled={graphDiffTargets.length === 0} title="Next graph change">
              &#9660;
            </button>
          </div>
        </div>
      )}

      <div className="splitLayout">
        <SplitGraphPanel
          title="Old"
          side="old"
          graph={displayOldGraph}
          viewType={viewType}
          showCalls={viewType === "logic" ? showCalls : true}
          onNodeSelect={handleNodeSelect}
          viewport={sharedViewport}
          onViewportChange={handleViewportChange}
          selectedNodeId={selectedNodeId}
          highlightedNodeId={highlightedNodeId}
          focusNodeId={focusNodeId}
          focusNodeTick={focusNodeTick}
          focusFilePath={selectedFilePath}
          fileContentMap={oldFileContentMap}
          onDiffTargetsChange={handleDiffTargetsChange}
          onTopLevelAnchorsChange={handleTopLevelAnchorsChange}
        />
        <SplitGraphPanel
          title="New"
          side="new"
          graph={displayNewGraph}
          viewType={viewType}
          showCalls={viewType === "logic" ? showCalls : true}
          onNodeSelect={handleNodeSelect}
          viewport={sharedViewport}
          onViewportChange={handleViewportChange}
          selectedNodeId={selectedNodeId}
          highlightedNodeId={highlightedNodeId}
          focusNodeId={focusNodeId}
          focusNodeTick={focusNodeTick}
          focusFilePath={selectedFilePath}
          diffStats={diffStats}
          fileContentMap={newFileContentMap}
          onDiffTargetsChange={handleDiffTargetsChange}
          alignmentOffset={newAlignmentOffset}
          alignmentAnchors={oldTopAnchors}
          onTopLevelAnchorsChange={handleTopLevelAnchorsChange}
        />
      </div>

      {isEmptyView && (
        <p className="errorText">
          {selectedFilePath
            ? "No nodes found for this file. Try the Knowledge tab, or disable Changes Only."
            : "No nodes found for this view. Try the Knowledge tab, or disable Changes Only."}
        </p>
      )}

      <FileListPanel
        files={fileDiffs}
        selectedFilePath={selectedFilePath}
        onFileSelect={handleFileSelect}
      />

      {selectedSymbols.length > 0 && (
        <SymbolListPanel symbols={selectedSymbols} onSymbolClick={handleSymbolClick} />
      )}

      <div ref={codeDiffSectionRef}>
        <CodeDiffDrawer file={selectedFile} targetLine={targetLine} targetSide={targetSide} scrollTick={scrollTick} onLineClick={handleCodeLineClick} />
      </div>
    </section>
  );
};
