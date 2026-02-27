import { useMemo } from "react";
import type { Edge, Node } from "@xyflow/react";
import type { ViewGraphNode } from "#/types/graph";

export const SEARCH_FLASH_STYLE = {
  outline: "5px solid #ffffff",
  outlineOffset: "3px",
  boxShadow:
    "0 0 0 2px rgba(255,255,255,0.95), 0 0 28px rgba(255,255,255,0.92)",
  zIndex: 1000,
};

interface HoverNeighborhood {
  keepNodeIds: Set<string>;
  keepEdgeIds: Set<string>;
  directNodeIds: Set<string>;
  directEdgeIds: Set<string>;
  ancestorNodeIds: Set<string>;
  ancestorEdgeIds: Set<string>;
}

interface UseFlowElementsHighlightingParams {
  positionedLayoutResult: { nodes: Node[]; edges: Edge[] };
  graphNodeById: Map<string, ViewGraphNode>;
  selectedNodeId: string;
  highlightedNodeId: string;
  searchHighlightedNodeId: string;
  hoveredNodeIdForPanel: string;
  hoveredFileNodeIds: Set<string>;
  hoverNeighborhood: HoverNeighborhood | null;
  hoveredEdgeId: string;
  clickedEdgeId: string;
}

export const useFlowElementsHighlighting = ({
  positionedLayoutResult,
  graphNodeById,
  selectedNodeId,
  highlightedNodeId,
  searchHighlightedNodeId,
  hoveredNodeIdForPanel,
  hoveredFileNodeIds,
  hoverNeighborhood,
  hoveredEdgeId,
  clickedEdgeId,
}: UseFlowElementsHighlightingParams): { nodes: Node[]; edges: Edge[] } => {
  return useMemo(() => {
    const hasNodeHighlights = Boolean(
      selectedNodeId || highlightedNodeId || searchHighlightedNodeId || hoveredFileNodeIds.size > 0,
    );
    const hasHoverNeighborhood = hoverNeighborhood !== null;
    const hasEdgeEmphasis = hoveredEdgeId.length > 0 || clickedEdgeId.length > 0;
    if (
      !hasNodeHighlights &&
      !hasEdgeEmphasis &&
      !hasHoverNeighborhood
    ) {
      return positionedLayoutResult;
    }

    const nodes =
      hasNodeHighlights || hasHoverNeighborhood
        ? positionedLayoutResult.nodes.map((node) => {
            const isSearchTarget = node.id === searchHighlightedNodeId;
            const isHoveredNode = node.id === hoveredNodeIdForPanel;
            const graphNode = graphNodeById.get(node.id);
            const isHoverDirect =
              Boolean(
                hasHoverNeighborhood &&
                  hoverNeighborhood?.directNodeIds.has(node.id),
              ) && graphNode?.kind !== "group";
            const isHoverAncestor =
              Boolean(
                hasHoverNeighborhood &&
                  hoverNeighborhood?.ancestorNodeIds.has(node.id),
              ) && graphNode?.kind !== "group";
            const isHoveredFromFileList = hoveredFileNodeIds.has(node.id) && graphNode?.kind !== "group";
            const isPrimarySelected =
              node.id === selectedNodeId ||
              node.id === highlightedNodeId ||
              isSearchTarget ||
              isHoveredFromFileList;
            let nextNode = node;
            if (isPrimarySelected || isHoveredNode) {
              nextNode =
                node.type === "scope" ||
                node.type === "diamond" ||
                node.type === "pill" ||
                node.type === "process" ||
                node.type === "knowledge"
                  ? { ...node, data: { ...node.data, selected: true } }
                  : {
                      ...node,
                      style: {
                        ...(node.style ?? {}),
                        border: "5px solid #f8fafc",
                        boxShadow:
                          "0 0 0 2px rgba(56, 189, 248, 0.95), 0 0 22px rgba(56, 189, 248, 0.85)",
                      },
                    };
            }
            if (isSearchTarget) {
              nextNode = {
                ...nextNode,
                style: { ...(nextNode.style ?? {}), ...SEARCH_FLASH_STYLE },
              };
            }
            if (
              isHoverAncestor &&
              !isHoverDirect &&
              !isPrimarySelected &&
              !isHoveredNode
            ) {
              nextNode = {
                ...nextNode,
                style: {
                  ...(nextNode.style ?? {}),
                  outline: "2px solid #60a5fa",
                  outlineOffset: "2px",
                  boxShadow:
                    "0 0 0 1px rgba(96,165,250,0.9), 0 0 14px rgba(96,165,250,0.55)",
                },
              };
            }
            if (
              isHoverDirect &&
              !isPrimarySelected &&
              !isHoveredNode
            ) {
              nextNode = {
                ...nextNode,
                style: {
                  ...(nextNode.style ?? {}),
                  outline: "2px solid #c084fc",
                  outlineOffset: "2px",
                  boxShadow:
                    "0 0 0 1px rgba(192,132,252,0.9), 0 0 14px rgba(192,132,252,0.55)",
                },
              };
            }
            if (isHoveredNode) {
              nextNode = {
                ...nextNode,
                style: {
                  ...(nextNode.style ?? {}),
                  outline: "3px solid #fbbf24",
                  outlineOffset: "2px",
                  boxShadow:
                    "0 0 0 2px rgba(251,191,36,0.92), 0 0 22px rgba(251,191,36,0.5)",
                },
              };
            }
            return nextNode;
          })
        : positionedLayoutResult.nodes;

    const edges =
      hasEdgeEmphasis || hasHoverNeighborhood
        ? positionedLayoutResult.edges.map((edge) => {
            const isHovered = edge.id === hoveredEdgeId;
            const isClicked = edge.id === clickedEdgeId;
            const isPrimaryEdge = isHovered || isClicked;
            const isHoverDirectEdge = Boolean(
              hasHoverNeighborhood &&
                hoverNeighborhood?.directEdgeIds.has(edge.id),
            );
            const isHoverAncestorEdge = Boolean(
              hasHoverNeighborhood &&
                hoverNeighborhood?.ancestorEdgeIds.has(edge.id),
            );
            const isInHoverNeighborhood =
              isHoverDirectEdge || isHoverAncestorEdge;
            if (
              !isPrimaryEdge &&
              !isInHoverNeighborhood &&
              !hasEdgeEmphasis
            ) {
              return edge;
            }
            const baseStyle = edge.style ?? {};
            const baseLabelStyle = edge.labelStyle ?? {};
            const baseLabelBgStyle = edge.labelBgStyle ?? {};
            const baseStrokeWidth =
              typeof baseStyle.strokeWidth === "number"
                ? baseStyle.strokeWidth
                : Number(baseStyle.strokeWidth ?? 1.5);
            const nextStrokeWidth = isPrimaryEdge
              ? Math.max(baseStrokeWidth + 2.6, 4.2)
              : isHoverDirectEdge
                ? Math.max(baseStrokeWidth + 1.8, 3.2)
                : isHoverAncestorEdge
                  ? Math.max(baseStrokeWidth + 2.1, 3.6)
                  : baseStrokeWidth;
            const nextStrokeOpacity = isPrimaryEdge
              ? 1
              : isInHoverNeighborhood
                ? 1
                : 0.24;
            const nextLabelOpacity = isPrimaryEdge
              ? 1
              : isInHoverNeighborhood
                ? 1
                : 0.35;
            const nextStroke = isPrimaryEdge
              ? "#f8fafc"
              : isHoverDirectEdge
                ? "#c084fc"
                : isHoverAncestorEdge
                  ? "#60a5fa"
                  : baseStyle.stroke;
            return {
              ...edge,
              style: {
                ...baseStyle,
                stroke: nextStroke,
                strokeWidth: nextStrokeWidth,
                strokeOpacity: nextStrokeOpacity,
                filter: isPrimaryEdge
                  ? "drop-shadow(0 0 8px rgba(248,250,252,0.95))"
                  : isHoverDirectEdge
                    ? "drop-shadow(0 0 7px rgba(192,132,252,0.9))"
                    : isHoverAncestorEdge
                      ? "drop-shadow(0 0 7px rgba(96,165,250,0.9))"
                      : baseStyle.filter,
              },
              labelStyle: {
                ...baseLabelStyle,
                fill: isPrimaryEdge
                  ? "#ffffff"
                  : isHoverDirectEdge
                    ? "#f3e8ff"
                    : isHoverAncestorEdge
                      ? "#dbeafe"
                      : baseLabelStyle.fill,
                opacity: nextLabelOpacity,
              },
              labelBgStyle: {
                ...baseLabelBgStyle,
                fillOpacity:
                  isPrimaryEdge ? 0.98 : isInHoverNeighborhood ? 0.68 : 0.5,
                stroke: isPrimaryEdge
                  ? "#f8fafc"
                  : isHoverDirectEdge
                    ? "#c084fc"
                    : isHoverAncestorEdge
                      ? "#60a5fa"
                      : baseLabelBgStyle.stroke,
              },
            };
          })
        : positionedLayoutResult.edges;

    return { nodes, edges };
  }, [
    positionedLayoutResult,
    graphNodeById,
    selectedNodeId,
    highlightedNodeId,
    searchHighlightedNodeId,
    hoveredNodeIdForPanel,
    hoveredFileNodeIds,
    hoverNeighborhood,
    hoveredEdgeId,
    clickedEdgeId,
  ]);
};
