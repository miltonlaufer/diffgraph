import { Handle, NodeToolbar, Position } from "@xyflow/react";
import { memo, useMemo, useState, useCallback } from "react";

interface GroupNodeData {
  label: string;
  bgColor: string;
  textColor: string;
  selected: boolean;
  width: number;
  height: number;
  functionParams?: string;
  returnType?: string;
  documentation?: string;
}

const GroupNode = ({ data }: { data: GroupNodeData }) => {
  /******************* STORE ***********************/
  const [hovered, setHovered] = useState(false);

  /******************* COMPUTED ***********************/
  const style = useMemo(
    () => ({
      width: data.width,
      height: data.height,
      background: `${data.bgColor}22`,
      border: data.selected ? "2px solid #38bdf8" : `2px solid ${data.bgColor}`,
      borderRadius: 10,
      padding: 0,
      position: "relative" as const,
    }),
    [data.bgColor, data.selected, data.width, data.height],
  );
  const hasFunctionDetails = useMemo(
    () => Boolean((data.documentation ?? "").trim() || (data.functionParams ?? "").trim() || (data.returnType ?? "").trim()),
    [data.documentation, data.functionParams, data.returnType],
  );
  const headerStyle = useMemo(
    () => ({
      background: data.bgColor,
      color: data.textColor,
      padding: "4px 10px",
      borderRadius: "8px 8px 0 0",
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: 0.3,
    }),
    [data.bgColor, data.textColor],
  );
  const tooltipStyle = useMemo(
    () => ({
      background: "#0f172a",
      border: "1px solid #334155",
      borderRadius: 8,
      padding: "8px 10px",
      maxWidth: 560,
      zIndex: 1000,
      color: "#e2e8f0",
      boxShadow: "0 10px 24px rgba(2, 6, 23, 0.7)",
      fontFamily: "JetBrains Mono, Fira Code, Consolas, monospace",
      fontSize: 11,
      lineHeight: 1.45,
      whiteSpace: "pre-wrap" as const,
    }),
    [],
  );

  /******************* FUNCTIONS ***********************/
  const onHeaderEnter = useCallback(() => setHovered(true), []);
  const onNodeLeave = useCallback(() => setHovered(false), []);

  return (
    <div style={style} onMouseLeave={onNodeLeave}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: "none" }} />
      <div style={headerStyle} onMouseEnter={onHeaderEnter}>{data.label}</div>
      <NodeToolbar isVisible={hovered && hasFunctionDetails} position={Position.Top} offset={8}>
        <div style={tooltipStyle}>
          {data.functionParams && (
            <div><strong>Parameters:</strong> {data.functionParams}</div>
          )}
          {data.returnType && (
            <div><strong>Returns:</strong> {data.returnType}</div>
          )}
          {data.documentation && (
            <div style={{ marginTop: 6 }}>
              <strong>Documentation:</strong>
              <div>{data.documentation}</div>
            </div>
          )}
        </div>
      </NodeToolbar>
    </div>
  );
};

export default memo(GroupNode);
