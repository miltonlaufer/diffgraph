import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchDiffFiles, fetchView } from "../api";
import { CodeDiffDrawer } from "../components/CodeDiffDrawer";
import { FileListPanel } from "../components/FileListPanel";
import { SplitGraphPanel } from "../components/SplitGraphPanel";
import { SymbolListPanel } from "../components/SymbolListPanel";
import type { FileDiffEntry, FileSymbol, ViewGraph, ViewportState } from "../types/graph";

interface ViewBaseProps {
  diffId: string;
  viewType: "logic" | "knowledge" | "react";
  showChangesOnly: boolean;
}

const normalizePath = (value: string): string =>
  value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");

export const ViewBase = ({ diffId, viewType, showChangesOnly }: ViewBaseProps) => {
  /******************* STORE ***********************/
  const [oldGraph, setOldGraph] = useState<ViewGraph>({ nodes: [], edges: [] });
  const [newGraph, setNewGraph] = useState<ViewGraph>({ nodes: [], edges: [] });
  const [fileDiffs, setFileDiffs] = useState<FileDiffEntry[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string>("");
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const [targetLine, setTargetLine] = useState<number>(0);
  const [scrollTick, setScrollTick] = useState<number>(0);
  const [sharedViewport, setSharedViewport] = useState<ViewportState>({ x: 0, y: 0, zoom: 0.8 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  /******************* COMPUTED ***********************/
  const title = useMemo(() => {
    if (viewType === "logic") return "Logic Flow";
    if (viewType === "knowledge") return "Knowledge Graph";
    return "React Component Structure";
  }, [viewType]);

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
    const keepIds = new Set(changedIds);
    /* Walk up: keep all ancestors of changed nodes */
    const nodeById = new Map(filteredOldGraph.nodes.map((n) => [n.id, n]));
    for (const id of changedIds) {
      let current = nodeById.get(id);
      while (current?.parentId) {
        keepIds.add(current.parentId);
        current = nodeById.get(current.parentId);
      }
    }
    /* Walk down: keep all children of kept groups */
    for (const node of filteredOldGraph.nodes) {
      if (node.parentId && keepIds.has(node.parentId)) keepIds.add(node.id);
    }
    return {
      nodes: filteredOldGraph.nodes.filter((n) => keepIds.has(n.id)),
      edges: filteredOldGraph.edges.filter((e) => keepIds.has(e.source) && keepIds.has(e.target)),
    };
  }, [filteredOldGraph, showChangesOnly]);

  const visibleNewGraph = useMemo(() => {
    if (!showChangesOnly) return filteredNewGraph;
    const changedIds = new Set(filteredNewGraph.nodes.filter((n) => n.diffStatus !== "unchanged").map((n) => n.id));
    const keepIds = new Set(changedIds);
    const nodeById = new Map(filteredNewGraph.nodes.map((n) => [n.id, n]));
    for (const id of changedIds) {
      let current = nodeById.get(id);
      while (current?.parentId) {
        keepIds.add(current.parentId);
        current = nodeById.get(current.parentId);
      }
    }
    for (const node of filteredNewGraph.nodes) {
      if (node.parentId && keepIds.has(node.parentId)) keepIds.add(node.id);
    }
    return {
      nodes: filteredNewGraph.nodes.filter((n) => keepIds.has(n.id)),
      edges: filteredNewGraph.edges.filter((e) => keepIds.has(e.source) && keepIds.has(e.target)),
    };
  }, [filteredNewGraph, showChangesOnly]);

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
    const nodes = visibleOldGraph.nodes.filter((n) => normalizePath(n.filePath) === normalizedTarget);
    const nodeIds = new Set(nodes.map((n) => n.id));
    return {
      nodes,
      edges: visibleOldGraph.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)),
    };
  }, [selectedFilePath, visibleOldGraph]);

  const displayNewGraph = useMemo(() => {
    if (!selectedFilePath) return visibleNewGraph;
    const normalizedTarget = normalizePath(selectedFilePath);
    const nodes = visibleNewGraph.nodes.filter((n) => normalizePath(n.filePath) === normalizedTarget);
    const nodeIds = new Set(nodes.map((n) => n.id));
    return {
      nodes,
      edges: visibleNewGraph.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)),
    };
  }, [selectedFilePath, visibleNewGraph]);

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

  /******************* FUNCTIONS ***********************/
  const handleNodeSelect = useCallback(
    (nodeId: string) => {
      setSelectedNodeId(nodeId);
      const matchedOld = oldGraph.nodes.find((n) => n.id === nodeId);
      const matchedNew = newGraph.nodes.find((n) => n.id === nodeId);
      const filePath = matchedNew?.filePath ?? matchedOld?.filePath ?? "";
      if (filePath.length > 0) {
        setSelectedFilePath(normalizePath(filePath));
      }
      const line = matchedNew?.startLine ?? matchedOld?.startLine ?? 0;
      setTargetLine(line);
      setScrollTick((prev) => prev + 1);
    },
    [oldGraph.nodes, newGraph.nodes],
  );

  const handleFileSelect = useCallback((filePath: string) => {
    setSelectedFilePath(filePath);
  }, []);

  const handleSymbolClick = useCallback((startLine: number) => {
    setTargetLine(startLine);
    setScrollTick((prev) => prev + 1);
  }, []);

  const handleViewportChange = useCallback((vp: ViewportState) => {
    setSharedViewport(vp);
  }, []);

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

  if (error) {
    return <p className="errorText">{error}</p>;
  }

  if (loading) {
    return (
      <section className="viewContainer">
        <h2>{title}</h2>
        <div className="loadingContainer">
          <div className="spinner" />
          <p className="dimText">Analyzing code and building graphs...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="viewContainer">
      <h2>{title}</h2>

      <div className="splitLayout">
        <SplitGraphPanel
          title="Old"
          side="old"
          graph={displayOldGraph}
          viewType={viewType}
          onNodeSelect={handleNodeSelect}
          viewport={sharedViewport}
          onViewportChange={handleViewportChange}
          selectedNodeId={selectedNodeId}
          focusFilePath={selectedFilePath}
          fileDiffs={fileDiffs}
        />
        <SplitGraphPanel
          title="New"
          side="new"
          graph={displayNewGraph}
          viewType={viewType}
          onNodeSelect={handleNodeSelect}
          viewport={sharedViewport}
          onViewportChange={handleViewportChange}
          selectedNodeId={selectedNodeId}
          focusFilePath={selectedFilePath}
          diffStats={diffStats}
          fileDiffs={fileDiffs}
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

      <CodeDiffDrawer file={selectedFile} targetLine={targetLine} scrollTick={scrollTick} />
    </section>
  );
};
