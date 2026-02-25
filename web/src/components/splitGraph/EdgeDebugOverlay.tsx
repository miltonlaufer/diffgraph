const EDGE_DEBUG_MAX_ROWS = 120;

import type { Edge } from "@xyflow/react";

interface EdgeDebugOverlayProps {
  edges: Edge[];
  graphEdgeById: Map<
    string,
    { id: string; relation?: string; flowType?: string }
  >;
}

export const EdgeDebugOverlay = ({
  edges,
  graphEdgeById,
}: EdgeDebugOverlayProps) => {
  const rows = edges.map((edge) => {
    const graphEdge = graphEdgeById.get(edge.id);
    const flowType =
      graphEdge?.relation === "flow" ? (graphEdge.flowType ?? "-") : "-";
    const label =
      typeof edge.label === "string" ? edge.label : String(edge.label ?? "");
    const sourceHandle = edge.sourceHandle ?? "";
    const targetHandle = edge.targetHandle ?? "";
    return `${edge.id} | ${edge.source} -> ${edge.target} | rel=${graphEdge?.relation ?? "-"} flow=${flowType} label=${label || "-"} sh=${sourceHandle || "-"} th=${targetHandle || "-"}`;
  });
  const shown = rows.slice(0, EDGE_DEBUG_MAX_ROWS);
  const truncated =
    rows.length > EDGE_DEBUG_MAX_ROWS
      ? `\n... truncated ${rows.length - EDGE_DEBUG_MAX_ROWS} more edges`
      : "";
  const edgeDebugText = shown.join("\n") + truncated;

  return (
    <div
      style={{
        position: "absolute",
        left: 10,
        bottom: 10,
        zIndex: 1300,
        width: "min(760px, calc(100% - 20px))",
        maxHeight: "36vh",
        overflow: "auto",
        border: "1px solid #334155",
        borderRadius: 8,
        background: "rgba(2, 6, 23, 0.94)",
        boxShadow: "0 8px 24px rgba(2, 6, 23, 0.8)",
        padding: "8px 10px",
        fontSize: 11,
        lineHeight: 1.35,
        fontFamily: "JetBrains Mono, Fira Code, Consolas, monospace",
        color: "#e2e8f0",
      }}
    >
      <div style={{ marginBottom: 6, color: "#93c5fd" }}>
        edge-debug ({edges.length}) enabled via `?debugEdges=1`
      </div>
      <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {edgeDebugText}
      </pre>
    </div>
  );
};
