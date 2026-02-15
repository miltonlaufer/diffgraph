import type { Edge, Node } from "@xyflow/react";
import { makeAutoObservable, observable } from "mobx";

interface LayoutResult {
  nodes: Node[];
  edges: Edge[];
}

interface FlowSize {
  width: number;
  height: number;
}

export class SplitGraphPanelStore {
  searchQuery = "";
  searchExclude = false;
  searchIdx = 0;
  searchHighlightedNodeId = "";
  hoveredEdgeId = "";
  clickedEdgeId = "";
  hoveredEdgePointerX = 0;
  hoveredEdgePointerY = 0;
  flowSize: FlowSize = { width: 800, height: 500 };
  layoutResult: LayoutResult = { nodes: [], edges: [] };
  workerReady = false;
  workerFailed = false;
  layoutPending = false;
  lastAutoFocusSearchKey = "";

  constructor() {
    makeAutoObservable(this, {
      flowSize: observable.ref,
      layoutResult: observable.ref,
    }, { autoBind: true });
  }

  setSearch(query: string, exclude: boolean): void {
    this.searchQuery = query;
    this.searchExclude = exclude;
    this.searchIdx = 0;
  }

  setSearchIdx(idx: number): void {
    this.searchIdx = idx;
  }

  setSearchHighlightedNodeId(nodeId: string): void {
    this.searchHighlightedNodeId = nodeId;
  }

  clearSearchHighlight(): void {
    this.searchHighlightedNodeId = "";
  }

  setHoveredEdgeId(edgeId: string): void {
    this.hoveredEdgeId = edgeId;
  }

  setClickedEdgeId(edgeId: string): void {
    this.clickedEdgeId = edgeId;
  }

  setHoveredEdge(edgeId: string, pointerX: number, pointerY: number): void {
    this.hoveredEdgeId = edgeId;
    this.hoveredEdgePointerX = pointerX;
    this.hoveredEdgePointerY = pointerY;
  }

  setHoveredEdgePointer(pointerX: number, pointerY: number): void {
    // Ignore tiny movements to reduce unnecessary re-renders on dense graphs.
    if (Math.abs(this.hoveredEdgePointerX - pointerX) < 1 && Math.abs(this.hoveredEdgePointerY - pointerY) < 1) {
      return;
    }
    this.hoveredEdgePointerX = pointerX;
    this.hoveredEdgePointerY = pointerY;
  }

  clearHoveredEdge(): void {
    this.hoveredEdgeId = "";
  }

  clearClickedEdge(): void {
    this.clickedEdgeId = "";
  }

  setFlowSize(flowSize: FlowSize): void {
    this.flowSize = flowSize;
  }

  setLayoutResult(layoutResult: LayoutResult): void {
    this.layoutResult = layoutResult;
  }

  setWorkerReady(ready: boolean): void {
    this.workerReady = ready;
  }

  setWorkerFailed(failed: boolean): void {
    this.workerFailed = failed;
  }

  setLayoutPending(pending: boolean): void {
    this.layoutPending = pending;
  }

  setLastAutoFocusSearchKey(key: string): void {
    this.lastAutoFocusSearchKey = key;
  }
}
