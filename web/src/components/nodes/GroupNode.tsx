import { Handle, Position, useViewport } from "@xyflow/react";
import { memo, useMemo, useState, useCallback } from "react";
import AskLlmButton from "./AskLlmButton";
import { useDebouncedValue } from "../useDebouncedValue";
import FloatingTooltip from "./FloatingTooltip";

const COMPACT_HEADER_ZOOM_THRESHOLD = 0.4;

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
  onShowGraphLogicTreeForNode?: (nodeId: string) => void;
  onShowCodeLogicTreeForNode?: (nodeId: string) => void;
  onGroupHeaderHoverChange?: (nodeId: string, isHovering: boolean) => void;
}

const GroupNode = ({ data }: { data: GroupNodeData }) => {
  /******************* STORE ***********************/
  const { zoom } = useViewport();
  const [hovered, setHovered] = useState(false);
  const [hoveredActions, setHoveredActions] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const tooltipVisible = useDebouncedValue(hovered, 500);
  const {
    askLlmNodeId,
    onAskLlmForNode,
    onAskLlmHrefForNode,
    onShowGraphLogicTreeForNode,
    onShowCodeLogicTreeForNode,
    onGroupHeaderHoverChange,
  } = data;

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
  const useCompactHeader = useMemo(
    () => zoom <= COMPACT_HEADER_ZOOM_THRESHOLD,
    [zoom],
  );
  const headerTitle = useMemo(
    () => (useCompactHeader && functionNameDisplay ? functionNameDisplay : data.label),
    [data.label, functionNameDisplay, useCompactHeader],
  );
  const headerStyle = useMemo(
    () => ({
      background: data.bgColor,
      color: data.textColor,
      padding: useCompactHeader ? "9px 12px" : "8px 12px 7px",
      borderRadius: "8px 8px 0 0",
      lineHeight: 1.25,
    }),
    [data.bgColor, data.textColor, useCompactHeader],
  );
  const titleStyle = useMemo(
    () => ({
      fontSize: useCompactHeader ? 34 : 20,
      fontWeight: useCompactHeader ? 800 : 700,
      letterSpacing: 0.2,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap" as const,
      textAlign: "left" as const,
    }),
    [useCompactHeader],
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
  const emitGroupHeaderHover = useCallback((isHovering: boolean) => {
    if (!askLlmNodeId) return;
    onGroupHeaderHoverChange?.(askLlmNodeId, isHovering);
  }, [askLlmNodeId, onGroupHeaderHoverChange]);
  const onHeaderEnter = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    setHovered(true);
    setTooltipPos({ x: event.clientX, y: event.clientY });
    emitGroupHeaderHover(true);
  }, [emitGroupHeaderHover]);
  const onHeaderMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    setTooltipPos({ x: event.clientX, y: event.clientY });
    emitGroupHeaderHover(true);
  }, [emitGroupHeaderHover]);
  const onHeaderLeave = useCallback(() => {
    setHovered(false);
    emitGroupHeaderHover(false);
  }, [emitGroupHeaderHover]);
  const onNodeLeave = useCallback(() => {
    setHovered(false);
    setHoveredActions(false);
  }, []);
  const handleActionsHoverChange = useCallback((isHovered: boolean) => {
    setHoveredActions(isHovered);
  }, []);
  const handleAskLlm = useCallback(() => {
    if (!askLlmNodeId || !onAskLlmForNode) return false;
    return onAskLlmForNode(askLlmNodeId);
  }, [askLlmNodeId, onAskLlmForNode]);
  const askLlmHref = useMemo(
    () => (askLlmNodeId && onAskLlmHrefForNode ? onAskLlmHrefForNode(askLlmNodeId) : ""),
    [onAskLlmHrefForNode, askLlmNodeId],
  );
  const handleShowGraphLogicTree = useCallback(() => {
    if (!askLlmNodeId || !onShowGraphLogicTreeForNode) return;
    onShowGraphLogicTreeForNode(askLlmNodeId);
  }, [askLlmNodeId, onShowGraphLogicTreeForNode]);
  const handleShowCodeLogicTree = useCallback(() => {
    if (!askLlmNodeId || !onShowCodeLogicTreeForNode) return;
    onShowCodeLogicTreeForNode(askLlmNodeId);
  }, [askLlmNodeId, onShowCodeLogicTreeForNode]);
  const hasAskLlm = Boolean(askLlmNodeId && onAskLlmForNode);
  const hasGraphLogicTree = Boolean(askLlmNodeId && onShowGraphLogicTreeForNode);
  const hasCodeLogicTree = Boolean(askLlmNodeId && onShowCodeLogicTreeForNode);

  return (
    <div style={style} onMouseLeave={onNodeLeave}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: "none" }} />
      <AskLlmButton
        visible={hovered || hoveredActions}
        onShowGraphLogicTree={hasGraphLogicTree ? handleShowGraphLogicTree : undefined}
        onShowCodeLogicTree={hasCodeLogicTree ? handleShowCodeLogicTree : undefined}
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
        <div style={titleStyle}>{headerTitle}</div>
        {!useCompactHeader && headerMeta && <div style={metaStyle}>{headerMeta}</div>}
      </div>
      {tooltipVisible && hasFunctionDetails && (
        <FloatingTooltip
          visible={tooltipVisible}
          anchor={{ type: "cursor", x: tooltipPos.x, y: tooltipPos.y }}
          style={tooltipStyle}
        >
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
        </FloatingTooltip>
      )}
    </div>
  );
};

export default memo(GroupNode);
