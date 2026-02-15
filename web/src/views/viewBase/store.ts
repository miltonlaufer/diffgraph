import { makeAutoObservable, observable } from "mobx";
import type { FileDiffEntry, ViewGraph, ViewportState } from "#/types/graph";
import type { GraphDiffTarget, InternalNodeAnchor, TopLevelAnchor } from "#/components/SplitGraphPanel";

const EMPTY_GRAPH: ViewGraph = { nodes: [], edges: [] };

export class ViewBaseStore {
  oldGraph: ViewGraph = EMPTY_GRAPH;
  newGraph: ViewGraph = EMPTY_GRAPH;
  fileDiffs: FileDiffEntry[] = [];
  selectedFilePath = "";
  selectedNodeId = "";
  targetLine = 0;
  targetSide: "old" | "new" = "new";
  scrollTick = 0;
  graphTopScrollTick = 0;
  sharedViewport: ViewportState = { x: 0, y: 0, zoom: 0.8 };
  showCalls = true;
  oldDiffTargets: GraphDiffTarget[] = [];
  newDiffTargets: GraphDiffTarget[] = [];
  oldTopAnchors: Record<string, TopLevelAnchor> = {};
  newTopAnchors: Record<string, TopLevelAnchor> = {};
  oldNodeAnchors: Record<string, InternalNodeAnchor> = {};
  newNodeAnchors: Record<string, InternalNodeAnchor> = {};
  graphDiffIdx = 0;
  highlightedNodeId = "";
  focusNodeId = "";
  focusSourceSide: "old" | "new" = "new";
  focusNodeTick = 0;
  focusFileTick = 0;
  graphSearchSide: "old" | "new" = "new";
  graphSearchQuery = "";
  graphSearchTick = 0;
  oldGraphSearchActive = false;
  newGraphSearchActive = false;
  graphSearchNavSide: "old" | "new" = "new";
  graphSearchNavDirection: "next" | "prev" = "next";
  graphSearchNavTick = 0;
  codeSearchActive = false;
  codeSearchNavDirection: "next" | "prev" = "next";
  codeSearchNavTick = 0;
  hoveredNodeId = "";
  hoveredNodeMatchKey = "";
  oldLayoutPending = false;
  newLayoutPending = false;
  loading = true;
  error = "";
  interactionBusy = false;

  constructor() {
    makeAutoObservable(this, {
      oldGraph: observable.ref,
      newGraph: observable.ref,
      fileDiffs: observable.ref,
      oldDiffTargets: observable.ref,
      newDiffTargets: observable.ref,
      oldTopAnchors: observable.ref,
      newTopAnchors: observable.ref,
      oldNodeAnchors: observable.ref,
      newNodeAnchors: observable.ref,
      sharedViewport: observable.ref,
    }, { autoBind: true });
  }

  beginLoading(): void {
    this.loading = true;
    this.error = "";
  }

  applyFetchedData(oldGraph: ViewGraph, newGraph: ViewGraph, fileDiffs: FileDiffEntry[]): void {
    this.oldGraph = oldGraph;
    this.newGraph = newGraph;
    this.oldDiffTargets = [];
    this.newDiffTargets = [];
    this.oldLayoutPending = false;
    this.newLayoutPending = false;
    this.graphDiffIdx = 0;
    this.oldTopAnchors = {};
    this.newTopAnchors = {};
    this.oldNodeAnchors = {};
    this.newNodeAnchors = {};
    this.hoveredNodeId = "";
    this.hoveredNodeMatchKey = "";
    this.fileDiffs = fileDiffs;
    this.selectedFilePath = "";
    this.sharedViewport = { x: 20, y: 20, zoom: 0.5 };
    this.focusSourceSide = "new";
    this.graphSearchSide = "new";
    this.graphSearchQuery = "";
    this.graphSearchTick = 0;
    this.oldGraphSearchActive = false;
    this.newGraphSearchActive = false;
    this.graphSearchNavSide = "new";
    this.graphSearchNavDirection = "next";
    this.graphSearchNavTick = 0;
    this.codeSearchActive = false;
    this.codeSearchNavDirection = "next";
    this.codeSearchNavTick = 0;
    this.graphTopScrollTick = 0;
    this.loading = false;
    this.error = "";
  }

  setError(message: string): void {
    this.error = message;
    this.loading = false;
  }

  setInteractionBusy(busy: boolean): void {
    this.interactionBusy = busy;
  }

  setSharedViewport(viewport: ViewportState): void {
    this.sharedViewport = viewport;
  }

  setShowCalls(showCalls: boolean): void {
    this.showCalls = showCalls;
  }

  setDiffTargets(side: "old" | "new", targets: GraphDiffTarget[]): void {
    if (side === "old") {
      this.oldDiffTargets = targets;
      return;
    }
    this.newDiffTargets = targets;
  }

  setLayoutPending(side: "old" | "new", pending: boolean): void {
    if (side === "old") {
      this.oldLayoutPending = pending;
      return;
    }
    this.newLayoutPending = pending;
  }

  setTopLevelAnchors(side: "old" | "new", anchors: Record<string, TopLevelAnchor>): void {
    if (side === "old") {
      this.oldTopAnchors = anchors;
      return;
    }
    this.newTopAnchors = anchors;
  }

  setNodeAnchors(side: "old" | "new", anchors: Record<string, InternalNodeAnchor>): void {
    if (side === "old") {
      this.oldNodeAnchors = anchors;
      return;
    }
    this.newNodeAnchors = anchors;
  }

  setSelectedFilePath(path: string): void {
    this.selectedFilePath = path;
  }

  setSelectedNodeId(nodeId: string): void {
    this.selectedNodeId = nodeId;
  }

  focusNode(nodeId: string, sourceSide: "old" | "new"): void {
    this.focusNodeId = nodeId;
    this.focusSourceSide = sourceSide;
    this.focusNodeTick += 1;
  }

  setHoveredNode(nodeId: string, matchKey: string): void {
    this.hoveredNodeId = nodeId;
    this.hoveredNodeMatchKey = matchKey;
  }

  clearHoveredNode(): void {
    this.hoveredNodeId = "";
    this.hoveredNodeMatchKey = "";
  }

  bumpFocusFileTick(): void {
    this.focusFileTick += 1;
  }

  requestGraphSearch(side: "old" | "new", query: string): void {
    this.graphSearchSide = side;
    this.graphSearchQuery = query;
    this.graphSearchTick += 1;
  }

  setGraphSearchActive(side: "old" | "new", active: boolean): void {
    if (side === "old") {
      this.oldGraphSearchActive = active;
      return;
    }
    this.newGraphSearchActive = active;
  }

  requestGraphSearchNavigate(side: "old" | "new", direction: "next" | "prev"): void {
    this.graphSearchNavSide = side;
    this.graphSearchNavDirection = direction;
    this.graphSearchNavTick += 1;
  }

  setCodeSearchActive(active: boolean): void {
    this.codeSearchActive = active;
  }

  requestCodeSearchNavigate(direction: "next" | "prev"): void {
    this.codeSearchNavDirection = direction;
    this.codeSearchNavTick += 1;
  }

  setTarget(line: number, side: "old" | "new"): void {
    this.targetLine = line;
    this.targetSide = side;
  }

  bumpScrollTick(): void {
    this.scrollTick += 1;
  }

  bumpGraphTopScrollTick(): void {
    this.graphTopScrollTick += 1;
  }

  setGraphDiffIdx(idx: number): void {
    this.graphDiffIdx = idx;
  }

  setHighlightedNodeId(nodeId: string): void {
    this.highlightedNodeId = nodeId;
  }

  clearHighlightedNode(): void {
    this.highlightedNodeId = "";
  }

  clearSelection(): void {
    this.selectedNodeId = "";
    this.selectedFilePath = "";
    this.targetLine = 0;
    this.clearHoveredNode();
  }
}
