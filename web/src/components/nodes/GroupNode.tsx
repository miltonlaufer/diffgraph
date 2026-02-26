import { Handle, Position, useViewport } from "@xyflow/react";
import { memo, useMemo, useState, useCallback } from "react";
import type { FunctionParameterDiffEntry } from "../../types/graph";
import AskLlmButton from "./AskLlmButton";
import { ParameterTokenList } from "./ParameterTokenList";
import { useDebouncedValue } from "../useDebouncedValue";
import FloatingTooltip from "./FloatingTooltip";

const COMPACT_HEADER_ZOOM_THRESHOLD = 0.4;

const parameterTextColors: Record<FunctionParameterDiffEntry["status"], string> = {
  removed: "#dc2626",
  modified: "#ca8a04",
  added: "#15803d",
  unchanged: "#111111",
};

const splitTopLevelParameters = (value: string): string[] => {
  const parts: string[] = [];
  let current = "";
  let inQuote: "'" | "\"" | "`" | null = null;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let angleDepth = 0;

  for (let idx = 0; idx < value.length; idx += 1) {
    const ch = value[idx];
    const prev = idx > 0 ? value[idx - 1] : "";
    if (inQuote) {
      current += ch;
      if (ch === inQuote && prev !== "\\") {
        inQuote = null;
      }
      continue;
    }
    if (ch === "'" || ch === "\"" || ch === "`") {
      inQuote = ch as "'" | "\"" | "`";
      current += ch;
      continue;
    }
    if (ch === "(") parenDepth += 1;
    if (ch === ")" && parenDepth > 0) parenDepth -= 1;
    if (ch === "{") braceDepth += 1;
    if (ch === "}" && braceDepth > 0) braceDepth -= 1;
    if (ch === "[") bracketDepth += 1;
    if (ch === "]" && bracketDepth > 0) bracketDepth -= 1;
    if (ch === "<") angleDepth += 1;
    if (ch === ">" && angleDepth > 0) angleDepth -= 1;
    if (ch === "," && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0 && angleDepth === 0) {
      const token = current.trim();
      if (token.length > 0) parts.push(token);
      current = "";
      continue;
    }
    current += ch;
  }

  const tail = current.trim();
  if (tail.length > 0) parts.push(tail);
  return parts;
};

const fallbackParameterTokens = (paramsText: string): FunctionParameterDiffEntry[] => {
  const trimmed = paramsText.trim();
  if (trimmed.length === 0) return [];
  const body = trimmed.startsWith("(") && trimmed.endsWith(")")
    ? trimmed.slice(1, -1).trim()
    : trimmed;
  if (body.length === 0) return [];
  return splitTopLevelParameters(body).map((text) => ({ text, status: "unchanged" }));
};

const fallbackDependencyTokens = (dependenciesText: string): FunctionParameterDiffEntry[] => {
  const trimmed = dependenciesText.trim();
  if (trimmed.length === 0 || trimmed === "[]") return [];
  const body = trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1).trim()
    : trimmed;
  if (body.length === 0) return [];
  return splitTopLevelParameters(body).map((text) => ({ text, status: "unchanged" }));
};

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
  functionParamDiff?: FunctionParameterDiffEntry[];
  hookDependencies?: string;
  hookDependencyDiff?: FunctionParameterDiffEntry[];
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
  const [stripTooltipPos, setStripTooltipPos] = useState({ x: 0, y: 0 });
  const [stripTooltipText, setStripTooltipText] = useState("");
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
        || (data.fileName ?? "").trim()
        || (data.className ?? "").trim()
        || (data.documentation ?? "").trim()
        || (data.functionParams ?? "").trim()
        || (data.hookDependencies ?? "").trim()
        || (data.returnType ?? "").trim(),
      ),
    [data.className, data.documentation, data.fileName, data.filePath, data.functionName, data.functionParams, data.hookDependencies, data.returnType],
  );
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
    () => functionNameNoBadge.length > 0,
    [functionNameNoBadge],
  );
  const paramsDisplay = useMemo(() => {
    if (paramsRaw) return paramsRaw;
    const openParen = functionNameNoBadge.indexOf("(");
    const closeParen = functionNameNoBadge.lastIndexOf(")");
    if (openParen < 0 || closeParen <= openParen + 1) return "";
    return functionNameNoBadge.slice(openParen + 1, closeParen).trim();
  }, [functionNameNoBadge, paramsRaw]);
  const showParameters = useMemo(
    () => paramsDisplay.length > 0,
    [paramsDisplay],
  );
  const parameterTokens = useMemo(() => {
    const rawDiff = data.functionParamDiff ?? [];
    const cleanedDiff = rawDiff
      .map((entry) => ({
        text: (entry.text ?? "").trim(),
        status: entry.status,
      }))
      .filter((entry) => entry.text.length > 0);
    if (cleanedDiff.length > 0) return cleanedDiff;
    return fallbackParameterTokens(paramsDisplay);
  }, [data.functionParamDiff, paramsDisplay]);
  const dependenciesRaw = useMemo(
    () => (data.hookDependencies ?? "").trim(),
    [data.hookDependencies],
  );
  const dependencyTokens = useMemo(() => {
    const rawDiff = data.hookDependencyDiff ?? [];
    const cleanedDiff = rawDiff
      .map((entry) => ({
        text: (entry.text ?? "").trim(),
        status: entry.status,
      }))
      .filter((entry) => entry.text.length > 0);
    if (cleanedDiff.length > 0) return cleanedDiff;
    return fallbackDependencyTokens(dependenciesRaw);
  }, [data.hookDependencyDiff, dependenciesRaw]);
  const useCompactHeader = useMemo(
    () => zoom <= COMPACT_HEADER_ZOOM_THRESHOLD,
    [zoom],
  );
  const showParameterStrip = useMemo(
    () => parameterTokens.length > 0,
    [parameterTokens.length],
  );
  const showDependencyStrip = useMemo(
    () => dependencyTokens.length > 0 || dependenciesRaw === "[]",
    [dependenciesRaw, dependencyTokens.length],
  );
  const parameterStripText = useMemo(
    () => parameterTokens.map((token) => token.text).join(", "),
    [parameterTokens],
  );
  const dependencyStripText = useMemo(
    () => `Deps: ${dependencyTokens.length === 0 ? "none" : dependencyTokens.map((token) => token.text).join(", ")}`,
    [dependencyTokens],
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
    setStripTooltipText("");
  }, []);
  const onStripEnter = useCallback((event: React.MouseEvent<HTMLDivElement>, text: string) => {
    setStripTooltipPos({ x: event.clientX, y: event.clientY });
    setStripTooltipText(text);
  }, []);
  const onStripMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    setStripTooltipPos({ x: event.clientX, y: event.clientY });
  }, []);
  const onStripLeave = useCallback(() => {
    setStripTooltipText("");
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
  const parameterStripStyle = useMemo(
    () => ({
      background: "#bbbbbb",
      color: "#111111",
      padding: useCompactHeader ? "0 8px" : "0 10px",
      borderTop: "1px solid rgba(15, 23, 42, 0.25)",
      display: "flex",
      alignItems: "center",
      minHeight: useCompactHeader ? 26 : 30,
      overflow: "hidden",
    }),
    [useCompactHeader],
  );
  const parameterTextRowStyle = useMemo(
    () => ({
      width: "100%",
      fontSize: 12,
      lineHeight: 1.1,
      fontFamily: "JetBrains Mono, Fira Code, Consolas, monospace",
      whiteSpace: "nowrap" as const,
      overflow: "hidden",
      textOverflow: "ellipsis",
    }),
    [],
  );
  const parameterTokenStyle = useMemo(
    () => ({
      fontWeight: 600,
    }),
    [],
  );
  const dependencyLabelStyle = useMemo(
    () => ({
      fontWeight: 700,
    }),
    [],
  );
  const dependencyStripStyle = useMemo(
    () => ({
      position: "absolute" as const,
      left: 0,
      right: 0,
      bottom: 0,
      background: "#bbbbbb",
      color: "#111111",
      padding: useCompactHeader ? "0 8px" : "0 10px",
      borderTop: "1px solid rgba(15, 23, 42, 0.25)",
      borderRadius: "0 0 8px 8px",
      display: "flex",
      alignItems: "center",
      minHeight: useCompactHeader ? 26 : 30,
      overflow: "hidden",
      zIndex: 2,
      pointerEvents: "auto" as const,
    }),
    [useCompactHeader],
  );

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
      {showParameterStrip && (
        <div
          style={parameterStripStyle}
          onMouseEnter={(event) => onStripEnter(event, parameterStripText)}
          onMouseMove={onStripMove}
          onMouseLeave={onStripLeave}
        >
          <div style={parameterTextRowStyle}>
            <ParameterTokenList tokens={parameterTokens} />
          </div>
        </div>
      )}
      {showDependencyStrip && (
        <div
          style={dependencyStripStyle}
          onMouseEnter={(event) => onStripEnter(event, dependencyStripText)}
          onMouseMove={onStripMove}
          onMouseLeave={onStripLeave}
        >
          <div style={parameterTextRowStyle}>
            <span style={dependencyLabelStyle}>Deps: </span>
            {dependencyTokens.length === 0
              ? (
                <span
                  style={{
                    ...parameterTokenStyle,
                    color: parameterTextColors.unchanged,
                  }}
                >
                  none
                </span>
              )
              : <ParameterTokenList tokens={dependencyTokens} />}
          </div>
        </div>
      )}
      {tooltipVisible && hasFunctionDetails && stripTooltipText.length === 0 && (
        <FloatingTooltip
          visible={tooltipVisible}
          anchor={{ type: "cursor", x: tooltipPos.x, y: tooltipPos.y }}
          style={tooltipStyle}
        >
          {showFunctionName && (
            <div><strong>Function:</strong> {functionNameNoBadge}</div>
          )}
          {data.className && (
            <div><strong>Class:</strong> {data.className}</div>
          )}
          {data.fileName && (
            <div><strong>File Name:</strong> {data.fileName}</div>
          )}
          {data.filePath && (
            <div><strong>File:</strong> {data.filePath}</div>
          )}
          {showParameters && (
            <div><strong>Parameters:</strong> {paramsDisplay}</div>
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
      {stripTooltipText.length > 0 && (
        <FloatingTooltip
          visible={stripTooltipText.length > 0}
          anchor={{ type: "cursor", x: stripTooltipPos.x, y: stripTooltipPos.y }}
          style={tooltipStyle}
        >
          <div>{stripTooltipText}</div>
        </FloatingTooltip>
      )}
    </div>
  );
};

export default memo(GroupNode);
