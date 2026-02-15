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
  flowSize: FlowSize = { width: 800, height: 500 };
  layoutResult: LayoutResult = { nodes: [], edges: [] };
  workerReady = false;
  workerFailed = false;
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

  setLastAutoFocusSearchKey(key: string): void {
    this.lastAutoFocusSearchKey = key;
  }
}
