import { BaseEdge, EdgeLabelRenderer, getBezierPath } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";

/**
 * Custom edge for "calls" (invoke) connectors. Renders the label inside
 * EdgeLabelRenderer with pointer-events: none so clicks on the label
 * reach the edge and trigger onEdgeClick (source/target navigation).
 */
export function CallsEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  label,
  labelStyle,
  labelShowBg = true,
  labelBgStyle,
  labelBgPadding = [8, 5],
  labelBgBorderRadius = 6,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const labelStyleObj = (labelStyle ?? {}) as Record<string, unknown>;
  const divLabelStyle: React.CSSProperties = {
    position: "absolute",
    transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
    pointerEvents: "none",
    ...(labelShowBg
      ? {
          padding: `${labelBgPadding[1]}px ${labelBgPadding[0]}px`,
          borderRadius: labelBgBorderRadius,
          ...(labelBgStyle as React.CSSProperties),
        }
      : {}),
    fontSize: (labelStyleObj.fontSize as number) ?? 12,
    fontWeight: (labelStyleObj.fontWeight as number) ?? 700,
    letterSpacing: (labelStyleObj.letterSpacing as number) ?? 0.2,
    color: (labelStyleObj.fill as string) ?? "#f8fafc",
  };

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <div style={divLabelStyle}>{label}</div>
      </EdgeLabelRenderer>
    </>
  );
}
