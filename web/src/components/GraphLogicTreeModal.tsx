import { useCallback } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
} from "@xyflow/react";
import FullscreenModal from "./FullscreenModal";

interface GraphLogicTreeModalProps {
  open: boolean;
  side: "old" | "new";
  nodes: Node[];
  edges: Edge[];
  nodeTypes: NodeTypes;
  onClose: () => void;
  onNodeClick: () => void;
}

export const GraphLogicTreeModal = ({
  open,
  side,
  nodes,
  edges,
  nodeTypes,
  onClose,
  onNodeClick,
}: GraphLogicTreeModalProps) => {
  const handleNodeClick = useCallback<NodeMouseHandler>(() => {
    onNodeClick();
  }, [onNodeClick]);

  const minimapNodeColor = useCallback((node: Node): string => {
    const data = node.data as { bgColor?: unknown } | undefined;
    if (data && typeof data.bgColor === "string" && data.bgColor.length > 0) {
      return data.bgColor;
    }
    return "#94a3b8";
  }, []);

  const minimapNodeStrokeColor = useCallback((node: Node): string => {
    const data = node.data as { selected?: unknown } | undefined;
    return data?.selected ? "#f8fafc" : "#1e293b";
  }, []);

  return (
    <FullscreenModal
      open={open}
      onClose={onClose}
      ariaLabel="Graph logic tree"
      className="fullscreenModalSurfaceGraphLogicTree"
    >
      <div className="graphLogicTreeModal">
        <header className="graphLogicTreeModalHeader">
          <h3 className="graphLogicTreeModalTitle">
            Graph logic tree ({side})
          </h3>
          <button type="button" className="prDescriptionCloseBtn" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="graphLogicTreeModalHint">
          Click any node to close and return to the selected source node.
        </div>
        <div className="graphLogicTreeModalCanvas">
          <ReactFlow
            id={`logic-tree-modal-${side}`}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={handleNodeClick}
            fitView
            fitViewOptions={{ padding: 0.18 }}
            minZoom={0.05}
            maxZoom={2}
            nodesDraggable={false}
            panOnDrag
            selectionOnDrag={false}
            style={{ width: "100%", height: "100%" }}
            onlyRenderVisibleElements
          >
            <Background />
            <Controls />
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
      </div>
    </FullscreenModal>
  );
};

export default GraphLogicTreeModal;
