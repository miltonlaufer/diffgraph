import { Handle, NodeToolbar, Position } from "@xyflow/react";
import { memo, useMemo, useState, useCallback } from "react";

interface GroupNodeData {
  label: string;
  functionName?: string;
  filePath?: string;
  bgColor: string;
  textColor: string;
  selected: boolean;
  width: number;
  height: number;
  fileName?: string;
  className?: string;
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
    () =>
      Boolean(
        (data.functionName ?? "").trim()
        || (data.filePath ?? "").trim()
        || (data.documentation ?? "").trim()
        || (data.functionParams ?? "").trim()
        || (data.returnType ?? "").trim(),
      ),
    [data.documentation, data.filePath, data.functionName, data.functionParams, data.returnType],
  );
  const normalized = useCallback((value: string): string => value.replace(/\s+/g, " ").trim(), []);
  const functionNameRaw = useMemo(
    () => (data.functionName ?? "").trim(),
    [data.functionName],
  );
  const functionNameNoBadge = useMemo(
    () => functionNameRaw.replace(/^\[[^\]]+\]\s*/, "").trim(),
    [functionNameRaw],
  );
  const functionNameDisplay = useMemo(() => {
    const idx = functionNameNoBadge.indexOf("(");
    return (idx >= 0 ? functionNameNoBadge.slice(0, idx) : functionNameNoBadge).trim();
  }, [functionNameNoBadge]);
  const paramsRaw = useMemo(
    () => (data.functionParams ?? "").trim(),
    [data.functionParams],
  );
  const showFunctionName = useMemo(
    () => functionNameDisplay.length > 0,
    [functionNameDisplay],
  );
  const showParameters = useMemo(() => {
    if (!paramsRaw) return false;
    if (!functionNameNoBadge) return true;
    return !normalized(functionNameNoBadge).includes(normalized(paramsRaw));
  }, [functionNameNoBadge, normalized, paramsRaw]);
  const headerStyle = useMemo(
    () => ({
      background: data.bgColor,
      color: data.textColor,
      padding: "8px 12px 7px",
      borderRadius: "8px 8px 0 0",
      lineHeight: 1.25,
    }),
    [data.bgColor, data.textColor],
  );
  const titleStyle = useMemo(
    () => ({
      fontSize: 15,
      fontWeight: 700,
      letterSpacing: 0.2,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap" as const,
    }),
    [],
  );
  const metaStyle = useMemo(
    () => ({
      marginTop: 2,
      fontSize: 11,
      opacity: 0.88,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap" as const,
      fontFamily: "JetBrains Mono, Fira Code, Consolas, monospace",
    }),
    [],
  );
  const headerMeta = useMemo(() => {
    const parts: string[] = [];
    if (data.className) parts.push(`Class: ${data.className}`);
    if (data.fileName) parts.push(`File: ${data.fileName}`);
    return parts.join("  |  ");
  }, [data.className, data.fileName]);
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
      <div style={headerStyle} onMouseEnter={onHeaderEnter}>
        <div style={titleStyle}>{data.label}</div>
        {headerMeta && <div style={metaStyle}>{headerMeta}</div>}
      </div>
      <NodeToolbar isVisible={hovered && hasFunctionDetails} position={Position.Top} offset={8}>
        <div style={tooltipStyle}>
          {showFunctionName && (
            <div><strong>Function:</strong> {functionNameDisplay}</div>
          )}
          {data.filePath && (
            <div><strong>File:</strong> {data.filePath}</div>
          )}
          {showParameters && (
            <div><strong>Parameters:</strong> {paramsRaw}</div>
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
