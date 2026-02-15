import { makeAutoObservable, observable } from "mobx";
import type { FileDiffEntry, ViewGraph, ViewportState } from "../../types/graph";
import type { GraphDiffTarget, TopLevelAnchor } from "../../components/SplitGraphPanel";

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
  sharedViewport: ViewportState = { x: 0, y: 0, zoom: 0.8 };
  showCalls = true;
  oldDiffTargets: GraphDiffTarget[] = [];
  newDiffTargets: GraphDiffTarget[] = [];
  oldTopAnchors: Record<string, TopLevelAnchor> = {};
  newTopAnchors: Record<string, TopLevelAnchor> = {};
  graphDiffIdx = 0;
  highlightedNodeId = "";
  focusNodeId = "";
  focusNodeTick = 0;
  focusFileTick = 0;
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
    this.fileDiffs = fileDiffs;
    this.selectedFilePath = "";
    this.sharedViewport = { x: 20, y: 20, zoom: 0.5 };
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

  setSelectedFilePath(path: string): void {
    this.selectedFilePath = path;
  }

  setSelectedNodeId(nodeId: string): void {
    this.selectedNodeId = nodeId;
  }

  focusNode(nodeId: string): void {
    this.focusNodeId = nodeId;
    this.focusNodeTick += 1;
  }

  bumpFocusFileTick(): void {
    this.focusFileTick += 1;
  }

  setTarget(line: number, side: "old" | "new"): void {
    this.targetLine = line;
    this.targetSide = side;
  }

  bumpScrollTick(): void {
    this.scrollTick += 1;
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
  }
}
