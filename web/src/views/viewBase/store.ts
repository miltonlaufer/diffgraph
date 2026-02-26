import { types } from "mobx-state-tree";
import type { FileDiffEntry, ViewGraph, ViewportState } from "#/types/graph";
import type { GraphDiffTarget, InternalNodeAnchor, TopLevelAnchor } from "#/components/SplitGraphPanel";
import type { ViewType } from "./types";

const EMPTY_GRAPH: ViewGraph = { nodes: [], edges: [] };

const ViewGraphModel = types.frozen<ViewGraph>();
const FileDiffsModel = types.frozen<FileDiffEntry[]>();
const ViewportModel = types.frozen<ViewportState>();
const GraphDiffTargetsModel = types.frozen<GraphDiffTarget[]>();
const TopAnchorsModel = types.frozen<Record<string, TopLevelAnchor>>();
const NodeAnchorsModel = types.frozen<Record<string, InternalNodeAnchor>>();

export const ViewBaseStore = types
  .model("ViewBaseStore", {
    oldGraph: types.optional(ViewGraphModel, EMPTY_GRAPH),
    newGraph: types.optional(ViewGraphModel, EMPTY_GRAPH),
    fileDiffs: types.optional(FileDiffsModel, []),
    selectedFilePath: types.optional(types.string, ""),
    selectedFilePathsForGraph: types.optional(types.array(types.string), []),
    areNodesSelected: types.optional(types.boolean, false),
    selectedNodeId: types.optional(types.string, ""),
    fileListCollapsed: types.optional(types.boolean, false),
    hoveredCodeLine: types.optional(types.number, 0),
    hoveredCodeSide: types.optional(types.enumeration(["old", "new"]), "new"),
    targetLine: types.optional(types.number, 0),
    targetSide: types.optional(types.enumeration(["old", "new"]), "new"),
    scrollTick: types.optional(types.number, 0),
    graphTopScrollTick: types.optional(types.number, 0),
    sharedViewport: types.optional(ViewportModel, { x: 0, y: 0, zoom: 0.8 }),
    showCalls: types.optional(types.boolean, true),
    oldDiffTargets: types.optional(GraphDiffTargetsModel, []),
    newDiffTargets: types.optional(GraphDiffTargetsModel, []),
    oldTopAnchors: types.optional(TopAnchorsModel, {}),
    newTopAnchors: types.optional(TopAnchorsModel, {}),
    oldNodeAnchors: types.optional(NodeAnchorsModel, {}),
    newNodeAnchors: types.optional(NodeAnchorsModel, {}),
    graphDiffIdx: types.optional(types.number, 0),
    highlightedNodeId: types.optional(types.string, ""),
    focusNodeId: types.optional(types.string, ""),
    focusSourceSide: types.optional(types.enumeration(["old", "new"]), "new"),
    focusNodeTick: types.optional(types.number, 0),
    focusFileTick: types.optional(types.number, 0),
    graphSearchSide: types.optional(types.enumeration(["old", "new"]), "new"),
    graphSearchQuery: types.optional(types.string, ""),
    graphSearchTick: types.optional(types.number, 0),
    oldGraphSearchActive: types.optional(types.boolean, false),
    newGraphSearchActive: types.optional(types.boolean, false),
    graphSearchNavSide: types.optional(types.enumeration(["old", "new"]), "new"),
    graphSearchNavDirection: types.optional(types.enumeration(["next", "prev"]), "next"),
    graphSearchNavTick: types.optional(types.number, 0),
    codeSearchActive: types.optional(types.boolean, false),
    codeSearchNavDirection: types.optional(types.enumeration(["next", "prev"]), "next"),
    codeSearchNavTick: types.optional(types.number, 0),
    codeLogicTreeRequestTick: types.optional(types.number, 0),
    codeLogicTreeRequestSide: types.optional(types.enumeration(["old", "new"]), "new"),
    codeLogicTreeRequestLines: types.optional(types.array(types.number), []),
    hoveredNodeId: types.optional(types.string, ""),
    hoveredNodeMatchKey: types.optional(types.string, ""),
    hoveredNodeSide: types.optional(types.enumeration(["old", "new", ""]), ""),
    oldLayoutPending: types.optional(types.boolean, false),
    newLayoutPending: types.optional(types.boolean, false),
    loading: types.optional(types.boolean, true),
    error: types.optional(types.string, ""),
    interactionBusy: types.optional(types.boolean, false),
    diffId: types.optional(types.string, ""),
    viewType: types.optional(types.enumeration(["logic", "knowledge", "react"]), "logic"),
    showChangesOnly: types.optional(types.boolean, true),
    pullRequestDescriptionExcerpt: types.optional(types.string, ""),
  })
  .views((self) => ({
    get hasSelectedNode() {
      return self.selectedNodeId.length > 0;
    },
    get hasSearchActive() {
      return self.codeSearchActive || self.oldGraphSearchActive || self.newGraphSearchActive;
    },
  }))
  .actions((self) => ({
    beginLoading() {
      self.loading = true;
      self.error = "";
    },

    applyFetchedData(oldGraph: ViewGraph, newGraph: ViewGraph, fileDiffs: FileDiffEntry[]) {
      self.oldGraph = oldGraph;
      self.newGraph = newGraph;
      self.oldDiffTargets = [];
      self.newDiffTargets = [];
      self.oldLayoutPending = false;
      self.newLayoutPending = false;
      self.graphDiffIdx = 0;
      self.oldTopAnchors = {};
      self.newTopAnchors = {};
      self.oldNodeAnchors = {};
      self.newNodeAnchors = {};
      self.hoveredNodeId = "";
      self.hoveredNodeMatchKey = "";
      self.hoveredNodeSide = "";
      self.fileDiffs = fileDiffs;
      self.selectedFilePath = "";
      self.selectedFilePathsForGraph.replace([]);
      self.areNodesSelected = false;
      self.fileListCollapsed = false;
      self.hoveredCodeLine = 0;
      self.hoveredCodeSide = "new";
      self.sharedViewport = { x: 20, y: 20, zoom: 0.5 };
      self.focusSourceSide = "new";
      self.graphSearchSide = "new";
      self.graphSearchQuery = "";
      self.graphSearchTick = 0;
      self.oldGraphSearchActive = false;
      self.newGraphSearchActive = false;
      self.graphSearchNavSide = "new";
      self.graphSearchNavDirection = "next";
      self.graphSearchNavTick = 0;
      self.codeSearchActive = false;
      self.codeSearchNavDirection = "next";
      self.codeSearchNavTick = 0;
      self.codeLogicTreeRequestTick = 0;
      self.codeLogicTreeRequestSide = "new";
      self.codeLogicTreeRequestLines.clear();
      self.graphTopScrollTick = 0;
      self.loading = false;
      self.error = "";
    },

    setError(message: string) {
      self.error = message;
      self.loading = false;
    },

    setInteractionBusy(busy: boolean) {
      self.interactionBusy = busy;
    },

    setSharedViewport(viewport: ViewportState) {
      self.sharedViewport = viewport;
    },

    setShowCalls(showCalls: boolean) {
      self.showCalls = showCalls;
    },

    setDiffTargets(side: "old" | "new", targets: GraphDiffTarget[]) {
      if (side === "old") {
        self.oldDiffTargets = targets;
        return;
      }
      self.newDiffTargets = targets;
    },

    setLayoutPending(side: "old" | "new", pending: boolean) {
      if (side === "old") {
        self.oldLayoutPending = pending;
        return;
      }
      self.newLayoutPending = pending;
    },

    setTopLevelAnchors(side: "old" | "new", anchors: Record<string, TopLevelAnchor>) {
      if (side === "old") {
        self.oldTopAnchors = anchors;
        return;
      }
      self.newTopAnchors = anchors;
    },

    setNodeAnchors(side: "old" | "new", anchors: Record<string, InternalNodeAnchor>) {
      if (side === "old") {
        self.oldNodeAnchors = anchors;
        return;
      }
      self.newNodeAnchors = anchors;
    },

    setSelectedFilePath(path: string) {
      self.selectedFilePath = path;
    },

    setHoveredCodeTarget(line: number, side: "old" | "new") {
      self.hoveredCodeLine = line;
      self.hoveredCodeSide = side;
    },

    clearHoveredCodeTarget() {
      self.hoveredCodeLine = 0;
    },

    setSelectedNodeId(nodeId: string) {
      self.selectedNodeId = nodeId;
    },

    setFileListCollapsed(collapsed: boolean) {
      self.fileListCollapsed = collapsed;
    },

    toggleFileListCollapsed() {
      self.fileListCollapsed = !self.fileListCollapsed;
    },

    focusNode(nodeId: string, sourceSide: "old" | "new") {
      self.focusNodeId = nodeId;
      self.focusSourceSide = sourceSide;
      self.focusNodeTick += 1;
    },

    setHoveredNode(side: "old" | "new", nodeId: string, matchKey: string) {
      self.hoveredNodeSide = side;
      self.hoveredNodeId = nodeId;
      self.hoveredNodeMatchKey = matchKey;
    },

    clearHoveredNode() {
      self.hoveredNodeSide = "";
      self.hoveredNodeId = "";
      self.hoveredNodeMatchKey = "";
    },

    bumpFocusFileTick() {
      self.focusFileTick += 1;
    },

    requestGraphSearch(side: "old" | "new", query: string) {
      self.graphSearchSide = side;
      self.graphSearchQuery = query;
      self.graphSearchTick += 1;
    },

    setGraphSearchActive(side: "old" | "new", active: boolean) {
      if (side === "old") {
        self.oldGraphSearchActive = active;
        return;
      }
      self.newGraphSearchActive = active;
    },

    requestGraphSearchNavigate(side: "old" | "new", direction: "next" | "prev") {
      self.graphSearchNavSide = side;
      self.graphSearchNavDirection = direction;
      self.graphSearchNavTick += 1;
    },

    setCodeSearchActive(active: boolean) {
      self.codeSearchActive = active;
    },

    requestCodeSearchNavigate(direction: "next" | "prev") {
      self.codeSearchNavDirection = direction;
      self.codeSearchNavTick += 1;
    },

    requestCodeLogicTree(side: "old" | "new", lineNumbers: number[]) {
      self.codeLogicTreeRequestSide = side;
      self.codeLogicTreeRequestLines.replace(lineNumbers);
      self.codeLogicTreeRequestTick += 1;
    },

    setTarget(line: number, side: "old" | "new") {
      self.targetLine = line;
      self.targetSide = side;
    },

    bumpScrollTick() {
      self.scrollTick += 1;
    },

    bumpGraphTopScrollTick() {
      self.graphTopScrollTick += 1;
    },

    setGraphDiffIdx(idx: number) {
      self.graphDiffIdx = idx;
    },

    setHighlightedNodeId(nodeId: string) {
      self.highlightedNodeId = nodeId;
    },

    clearHighlightedNode() {
      self.highlightedNodeId = "";
    },

    clearSelection() {
      self.selectedNodeId = "";
      self.selectedFilePath = "";
      self.targetLine = 0;
      self.hoveredNodeSide = "";
      self.hoveredNodeId = "";
      self.hoveredNodeMatchKey = "";
    },

    setSelectedFilePathsForGraph(paths: string[]) {
      self.selectedFilePathsForGraph.replace(paths);
    },

    toggleFileForGraph(filePath: string, allFilePaths: string[]) {
      const norm = filePath.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");
      const list = self.selectedFilePathsForGraph;
      const paths = allFilePaths.map((p) => p.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, ""));
      const isIncluded = list.length === 0 || list.some((p) => p === norm);
      if (isIncluded) {
        const next = list.length === 0
          ? paths.filter((p) => p !== norm)
          : list.filter((p) => p !== norm);
        self.selectedFilePathsForGraph.replace(next);
      } else {
        self.selectedFilePathsForGraph.replace([...list, norm]);
      }
      self.areNodesSelected = true;
    },

    selectFilesFromNode(filePath: string) {
      const norm = filePath.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");
      self.selectedFilePathsForGraph.replace([norm]);
      self.areNodesSelected = true;
    },

    resetToInitialState() {
      self.selectedFilePathsForGraph.replace([]);
      self.areNodesSelected = false;
      self.selectedNodeId = "";
      self.selectedFilePath = "";
      self.targetLine = 0;
      self.hoveredNodeSide = "";
      self.hoveredNodeId = "";
      self.hoveredNodeMatchKey = "";
      self.hoveredCodeLine = 0;
    },

    setViewConfig(config: {
      diffId: string;
      viewType: ViewType;
      showChangesOnly: boolean;
      pullRequestDescriptionExcerpt?: string;
    }) {
      self.diffId = config.diffId;
      self.viewType = config.viewType;
      self.showChangesOnly = config.showChangesOnly;
      self.pullRequestDescriptionExcerpt = config.pullRequestDescriptionExcerpt ?? "";
    },
  }));

export type ViewBaseStoreInstance = typeof ViewBaseStore.Type;
