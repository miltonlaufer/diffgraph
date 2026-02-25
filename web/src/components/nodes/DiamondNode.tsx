import { Handle, Position } from "@xyflow/react";
import { memo, useMemo, useState, useCallback } from "react";
import AskLlmButton from "./AskLlmButton";
import CodeTooltip from "./CodeTooltip";
import { useDebouncedValue } from "../useDebouncedValue";

const splitLabel = (label: string): { title: string; code: string } => {
  const idx = label.indexOf("\n");
  if (idx === -1) return { title: label, code: "" };
  return { title: label.slice(0, idx), code: label.slice(idx + 1) };
};

interface DiamondNodeData {
  label: string;
  bgColor: string;
  textColor: string;
  selected: boolean;
  hideCodeTooltip?: boolean;
  codeContext?: unknown;
  language?: string;
  functionName?: string;
  symbolName?: string;
  filePath?: string;
  askLlmNodeId?: string;
  onAskLlmForNode?: (nodeId: string) => Promise<boolean> | boolean;
  onAskLlmHrefForNode?: (nodeId: string) => string;
  onShowGraphLogicTreeForNode?: (nodeId: string) => void;
  onShowCodeLogicTreeForNode?: (nodeId: string) => void;
}

const DiamondNode = ({ data }: { data: DiamondNodeData }) => {
  /******************* STORE ***********************/
  const [hovered, setHovered] = useState(false);
  const [hoveredActions, setHoveredActions] = useState(false);
  const tooltipVisible = useDebouncedValue(hovered, 500);
  const {
    askLlmNodeId,
    onAskLlmForNode,
    onAskLlmHrefForNode,
    onShowGraphLogicTreeForNode,
    onShowCodeLogicTreeForNode,
  } = data;

  /******************* COMPUTED ***********************/
  const parts = useMemo(() => splitLabel(data.label), [data.label]);
  const outerStyle = useMemo(
    () => ({
      width: 120,
      height: 120,
      transform: "rotate(45deg)",
      background: data.bgColor,
      border: data.selected ? "5px solid #f8fafc" : "1px solid #475569",
      boxShadow: data.selected ? "0 0 0 2px rgba(56, 189, 248, 0.95), 0 0 22px rgba(56, 189, 248, 0.85)" : "none",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      position: "relative" as const,
    }),
    [data.bgColor, data.selected],
  );

  /******************* FUNCTIONS ***********************/
  const onEnter = useCallback(() => setHovered(true), []);
  const onLeave = useCallback(() => {
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
    [askLlmNodeId, onAskLlmHrefForNode],
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
    <div style={outerStyle} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div style={{ transform: "rotate(-45deg)", textAlign: "center", maxWidth: 85, wordBreak: "break-word" as const }}>
        <div style={{ fontSize: 9, color: data.textColor, opacity: 0.7, marginBottom: 1 }}>{parts.title}</div>
        {parts.code && (
          <div style={{ fontSize: 8, fontFamily: "JetBrains Mono, Fira Code, Consolas, monospace", color: data.textColor, lineHeight: 1.2 }}>
            {parts.code}
          </div>
        )}
      </div>
      <Handle type="target" position={Position.Top} style={{ transform: "rotate(-45deg)" }} />
      <Handle type="source" position={Position.Right} id="yes" style={{ transform: "rotate(-45deg)", top: "25%" }} />
      <span
        style={{
          position: "absolute",
          right: -10,
          top: "14%",
          transform: "rotate(-45deg)",
          fontSize: 14,
          color: "#4ade80",
          fontWeight: 800,
          textShadow: "0 0 8px rgba(34, 197, 94, 0.55)",
          lineHeight: 1,
        }}
      >
        T
      </span>
      <Handle type="source" position={Position.Left} id="next" style={{ transform: "rotate(-45deg)", top: "50%" }} />
      <span
        style={{
          position: "absolute",
          left: -11,
          top: "47%",
          transform: "rotate(-45deg)",
          fontSize: 13,
          color: "#cbd5e1",
          fontWeight: 800,
          textShadow: "0 0 8px rgba(203, 213, 225, 0.5)",
          lineHeight: 1,
        }}
      >
        N
      </span>
      <Handle type="source" position={Position.Bottom} id="no" style={{ transform: "rotate(-45deg)" }} />
      <span
        style={{
          position: "absolute",
          bottom: -10,
          left: "13%",
          transform: "rotate(-45deg)",
          fontSize: 14,
          color: "#f87171",
          fontWeight: 800,
          textShadow: "0 0 8px rgba(248, 113, 113, 0.55)",
          lineHeight: 1,
        }}
      >
        F
      </span>
      <AskLlmButton
        visible={hovered || hoveredActions}
        onShowGraphLogicTree={hasGraphLogicTree ? handleShowGraphLogicTree : undefined}
        onShowCodeLogicTree={hasCodeLogicTree ? handleShowCodeLogicTree : undefined}
        onAskLlm={hasAskLlm ? handleAskLlm : undefined}
        askLlmHref={askLlmHref || undefined}
        onHoverChange={handleActionsHoverChange}
        style={{ top: -46, left: "calc(100% - 10px)", transform: "rotate(-45deg)" }}
      />
      <CodeTooltip
        visible={tooltipVisible && !data.hideCodeTooltip}
        codeContext={data.codeContext as string | undefined}
        language={data.language}
        functionName={data.functionName}
        symbolName={data.symbolName}
        filePath={data.filePath}
      />
    </div>
  );
};

export default memo(DiamondNode);
