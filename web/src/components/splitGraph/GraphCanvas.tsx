import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
  type Viewport,
} from "@xyflow/react";
import type { MutableRefObject } from "react";
import type { ViewportState } from "../../types/graph";

interface GraphCanvasProps {
  side: "old" | "new";
  isOld: boolean;
  nodes: Node[];
  edges: Edge[];
  nodeTypes: NodeTypes;
  viewport: ViewportState;
  flowContainerRef: MutableRefObject<HTMLDivElement | null>;
  minimapNodeColor: (node: Node) => string;
  minimapNodeStrokeColor: (node: Node) => string;
  onNodeClick: NodeMouseHandler;
  onNodeMouseEnter: NodeMouseHandler;
  onNodeMouseMove: NodeMouseHandler;
  onNodeMouseLeave: NodeMouseHandler;
  onEdgeClick: EdgeMouseHandler;
  onEdgeMouseEnter: EdgeMouseHandler;
  onEdgeMouseMove: EdgeMouseHandler;
  onEdgeMouseLeave: EdgeMouseHandler;
  onPaneMouseLeave: () => void;
  onMoveStart: (event: MouseEvent | TouchEvent | null, viewport: Viewport) => void;
  onMove: (event: MouseEvent | TouchEvent | null, viewport: Viewport) => void;
  onMoveEnd: (event: MouseEvent | TouchEvent | null, viewport: Viewport) => void;
}

export const GraphCanvas = ({
  side,
  isOld,
  nodes,
  edges,
  nodeTypes,
  viewport,
  flowContainerRef,
  minimapNodeColor,
  minimapNodeStrokeColor,
  onNodeClick,
  onNodeMouseEnter,
  onNodeMouseMove,
  onNodeMouseLeave,
  onEdgeClick,
  onEdgeMouseEnter,
  onEdgeMouseMove,
  onEdgeMouseLeave,
  onPaneMouseLeave,
  onMoveStart,
  onMove,
  onMoveEnd,
}: GraphCanvasProps) => (
  <div className="flowContainer" ref={flowContainerRef}>
    <ReactFlow
      id={`reactflow-${side}`}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={onNodeClick}
      onNodeMouseEnter={onNodeMouseEnter}
      onNodeMouseMove={onNodeMouseMove}
      onNodeMouseLeave={onNodeMouseLeave}
      onEdgeClick={onEdgeClick}
      onEdgeMouseEnter={onEdgeMouseEnter}
      onEdgeMouseMove={onEdgeMouseMove}
      onEdgeMouseLeave={onEdgeMouseLeave}
      onPaneMouseLeave={onPaneMouseLeave}
      onMoveStart={onMoveStart}
      viewport={viewport}
      onMove={onMove}
      onMoveEnd={onMoveEnd}
      style={{ width: "100%", height: "100%" }}
      onlyRenderVisibleElements
      minZoom={0.01}
      maxZoom={2}
      nodesDraggable={false}
      panOnDrag
      selectionOnDrag={false}
    >
      <Background />
      {!isOld && <Controls />}
      <MiniMap
        pannable
        zoomable
        bgColor="#0b1120"
        maskColor="rgba(148, 163, 184, 0.2)"
        maskStrokeColor="#cbd5e1"
        nodeColor={minimapNodeColor}
        nodeStrokeColor={minimapNodeStrokeColor}
        nodeStrokeWidth={2}
      />
    </ReactFlow>
  </div>
);
