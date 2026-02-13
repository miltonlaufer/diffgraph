import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const includeHierarchyNeighbors = (graph: ViewGraph, seedIds: Set<string>): Set<string> => {
  const keepIds = new Set(seedIds);
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...keepIds]) {
      const node = nodeById.get(id);
      if (node?.parentId && !keepIds.has(node.parentId)) {
        keepIds.add(node.parentId);
        changed = true;
      }
    }
    for (const node of graph.nodes) {
      if (node.parentId && keepIds.has(node.parentId) && !keepIds.has(node.id)) {
        keepIds.add(node.id);
        changed = true;
      }
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
  const [graphDiffIdx, setGraphDiffIdx] = useState(0);
  const [highlightedNodeId, setHighlightedNodeId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const codeDiffSectionRef = useRef<HTMLDivElement>(null);
  const highlightTimerRef = useRef<number | null>(null);

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
    let keepIds = includeHierarchyNeighbors(filteredOldGraph, changedIds);
    if (viewType === "logic") {
      keepIds = includeInvokeNeighbors(filteredOldGraph, keepIds);
      keepIds = includeHierarchyNeighbors(filteredOldGraph, keepIds);
    }
    return {
      nodes: filteredOldGraph.nodes.filter((n) => keepIds.has(n.id)),
      edges: filteredOldGraph.edges.filter((e) => keepIds.has(e.source) && keepIds.has(e.target)),
    };
  }, [filteredOldGraph, showChangesOnly, viewType]);

  const visibleNewGraph = useMemo(() => {
    if (!showChangesOnly) return filteredNewGraph;
    const changedIds = new Set(filteredNewGraph.nodes.filter((n) => n.diffStatus !== "unchanged").map((n) => n.id));
    let keepIds = includeHierarchyNeighbors(filteredNewGraph, changedIds);
    if (viewType === "logic") {
      keepIds = includeInvokeNeighbors(filteredNewGraph, keepIds);
      keepIds = includeHierarchyNeighbors(filteredNewGraph, keepIds);
    }
    return {
      nodes: filteredNewGraph.nodes.filter((n) => keepIds.has(n.id)),
      edges: filteredNewGraph.edges.filter((e) => keepIds.has(e.source) && keepIds.has(e.target)),
    };
  }, [filteredNewGraph, showChangesOnly, viewType]);

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
      nodeIds = includeHierarchyNeighbors(visibleOldGraph, nodeIds);
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
      nodeIds = includeHierarchyNeighbors(visibleNewGraph, nodeIds);
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
  const handleNodeSelect = useCallback(
    (nodeId: string, sourceSide: "old" | "new") => {
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
    },
    [oldGraph.nodes, newGraph.nodes],
  );

  const handleFileSelect = useCallback((filePath: string) => {
    setSelectedFilePath(filePath);
  }, []);

  const handleSymbolClick = useCallback((startLine: number) => {
    setTargetLine(startLine);
    setTargetSide("new");
    setScrollTick((prev) => prev + 1);
  }, []);

  const handleViewportChange = useCallback((vp: ViewportState) => {
    setSharedViewport(vp);
  }, []);

  const handleShowCallsChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setShowCalls(e.target.checked);
  }, []);

  const handleDiffTargetsChange = useCallback((side: "old" | "new", targets: GraphDiffTarget[]) => {
    if (side === "old") {
      setOldDiffTargets(targets);
      return;
    }
    setNewDiffTargets(targets);
  }, []);

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
    Promise.all([fetchView(diffId, viewType), fetchDiffFiles(diffId)])
      .then(([payload, files]) => {
        if (!mounted) return;
        setOldGraph(payload.oldGraph);
        setNewGraph(payload.newGraph);
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

  useEffect(() => () => {
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
    }
  }, []);

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

  return (
    <section className="viewContainer">
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
          focusFilePath={selectedFilePath}
          fileContentMap={oldFileContentMap}
          onDiffTargetsChange={handleDiffTargetsChange}
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
          focusFilePath={selectedFilePath}
          diffStats={diffStats}
          fileContentMap={newFileContentMap}
          onDiffTargetsChange={handleDiffTargetsChange}
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
        <CodeDiffDrawer file={selectedFile} targetLine={targetLine} targetSide={targetSide} scrollTick={scrollTick} />
      </div>
    </section>
  );
};
