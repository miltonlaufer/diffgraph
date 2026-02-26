import type { Edge, Node } from "@xyflow/react";
import { types } from "mobx-state-tree";

interface LayoutResult {
  nodes: Node[];
  edges: Edge[];
}

interface FlowSize {
  width: number;
  height: number;
}

const FlowSizeModel = types.frozen<FlowSize>();
const LayoutResultModel = types.frozen<LayoutResult>();

export const SplitGraphPanelStore = types
  .model("SplitGraphPanelStore", {
    searchQuery: types.optional(types.string, ""),
    searchExclude: types.optional(types.boolean, false),
    searchIdx: types.optional(types.number, 0),
    searchHighlightedNodeId: types.optional(types.string, ""),
    hoveredEdgeId: types.optional(types.string, ""),
    clickedEdgeId: types.optional(types.string, ""),
    hoveredEdgePointerX: types.optional(types.number, 0),
    hoveredEdgePointerY: types.optional(types.number, 0),
    flowSize: types.optional(FlowSizeModel, { width: 800, height: 500 }),
    layoutResult: types.optional(LayoutResultModel, { nodes: [], edges: [] }),
    workerReady: types.optional(types.boolean, false),
    workerFailed: types.optional(types.boolean, false),
    layoutPending: types.optional(types.boolean, false),
    lastAutoFocusSearchKey: types.optional(types.string, ""),
  })
  .actions((self) => ({
    setSearch(query: string, exclude: boolean) {
      self.searchQuery = query;
      self.searchExclude = exclude;
      self.searchIdx = 0;
    },

    setSearchIdx(idx: number) {
      self.searchIdx = idx;
    },

    setSearchHighlightedNodeId(nodeId: string) {
      self.searchHighlightedNodeId = nodeId;
    },

    clearSearchHighlight() {
      self.searchHighlightedNodeId = "";
    },

    setHoveredEdgeId(edgeId: string) {
      self.hoveredEdgeId = edgeId;
    },

    setClickedEdgeId(edgeId: string) {
      self.clickedEdgeId = edgeId;
    },

    setHoveredEdge(edgeId: string, pointerX: number, pointerY: number) {
      self.hoveredEdgeId = edgeId;
      self.hoveredEdgePointerX = pointerX;
      self.hoveredEdgePointerY = pointerY;
    },

    setHoveredEdgePointer(pointerX: number, pointerY: number) {
      if (Math.abs(self.hoveredEdgePointerX - pointerX) < 1 && Math.abs(self.hoveredEdgePointerY - pointerY) < 1) {
        return;
      }
      self.hoveredEdgePointerX = pointerX;
      self.hoveredEdgePointerY = pointerY;
    },

    clearHoveredEdge() {
      self.hoveredEdgeId = "";
    },

    clearClickedEdge() {
      self.clickedEdgeId = "";
    },

    setFlowSize(flowSize: FlowSize) {
      self.flowSize = flowSize;
    },

    setLayoutResult(layoutResult: LayoutResult) {
      self.layoutResult = layoutResult;
    },

    setWorkerReady(ready: boolean) {
      self.workerReady = ready;
    },

    setWorkerFailed(failed: boolean) {
      self.workerFailed = failed;
    },

    setLayoutPending(pending: boolean) {
      self.layoutPending = pending;
    },

    setLastAutoFocusSearchKey(key: string) {
      self.lastAutoFocusSearchKey = key;
    },
  }));

export type SplitGraphPanelStoreInstance = typeof SplitGraphPanelStore.Type;
