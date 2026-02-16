import { Handle, Position } from "@xyflow/react";
import { memo, useMemo, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import AskLlmButton from "./AskLlmButton";

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
  askLlmNodeId?: string;
  onAskLlmForNode?: (nodeId: string) => Promise<boolean> | boolean;
  onAskLlmHrefForNode?: (nodeId: string) => string;
}

const GroupNode = ({ data }: { data: GroupNodeData }) => {
  /******************* STORE ***********************/
  const [hovered, setHovered] = useState(false);
  const [hoveredActions, setHoveredActions] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  /******************* COMPUTED ***********************/
  const style = useMemo(
    () => ({
      width: data.width,
      height: data.height,
      background: `${data.bgColor}22`,
      border: data.selected ? "5px solid #f8fafc" : `2px solid ${data.bgColor}`,
      boxShadow: data.selected ? "0 0 0 2px rgba(56, 189, 248, 0.95), 0 0 24px rgba(56, 189, 248, 0.8)" : "none",
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
      maxWidth: "min(560px, calc(100vw - 24px))",
      zIndex: 1000,
      color: "#e2e8f0",
      boxShadow: "0 10px 24px rgba(2, 6, 23, 0.7)",
      fontFamily: "JetBrains Mono, Fira Code, Consolas, monospace",
      fontSize: 11,
      lineHeight: 1.45,
      whiteSpace: "pre-wrap" as const,
      position: "fixed" as const,
      left: `${tooltipPos.x}px`,
      top: `${tooltipPos.y - 12}px`,
      transform: "translate(-50%, -100%)",
      pointerEvents: "none" as const,
    }),
    [tooltipPos.x, tooltipPos.y],
  );

  /******************* FUNCTIONS ***********************/
  const onHeaderEnter = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    setHovered(true);
    setTooltipPos({ x: event.clientX, y: event.clientY });
  }, []);
  const onHeaderMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    setTooltipPos({ x: event.clientX, y: event.clientY });
  }, []);
  const onHeaderLeave = useCallback(() => setHovered(false), []);
  const onNodeLeave = useCallback(() => {
    setHovered(false);
    setHoveredActions(false);
  }, []);
  const handleActionsHoverChange = useCallback((isHovered: boolean) => {
    setHoveredActions(isHovered);
  }, []);
  const handleAskLlm = useCallback(() => {
    if (!data.askLlmNodeId || !data.onAskLlmForNode) return false;
    return data.onAskLlmForNode(data.askLlmNodeId);
  }, [data.askLlmNodeId, data.onAskLlmForNode]);
  const askLlmHref = useMemo(
    () => (data.askLlmNodeId && data.onAskLlmHrefForNode ? data.onAskLlmHrefForNode(data.askLlmNodeId) : ""),
    [data.onAskLlmHrefForNode, data.askLlmNodeId],
  );
  const hasAskLlm = Boolean(data.askLlmNodeId && data.onAskLlmForNode);

  return (
    <div style={style} onMouseLeave={onNodeLeave}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: "none" }} />
      <AskLlmButton
        visible={hovered || hoveredActions}
        onAskLlm={hasAskLlm ? handleAskLlm : undefined}
        askLlmHref={askLlmHref || undefined}
        onHoverChange={handleActionsHoverChange}
      />
      <div
        data-group-header="true"
        style={headerStyle}
        onMouseEnter={onHeaderEnter}
        onMouseMove={onHeaderMove}
        onMouseLeave={onHeaderLeave}
      >
        <div style={titleStyle}>{data.label}</div>
        {headerMeta && <div style={metaStyle}>{headerMeta}</div>}
      </div>
      {hovered && hasFunctionDetails && typeof document !== "undefined" && createPortal(
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
        </div>,
        document.body,
      )}
    </div>
  );
};

export default memo(GroupNode);
