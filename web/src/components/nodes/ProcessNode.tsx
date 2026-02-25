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

interface ProcessNodeData {
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

const ProcessNode = ({ data }: { data: ProcessNodeData }) => {
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
  const style = useMemo(
    () => ({
      padding: "6px 14px",
      borderRadius: 6,
      background: data.bgColor,
      border: data.selected ? "5px solid #f8fafc" : "1px solid #475569",
      boxShadow: data.selected ? "0 0 0 2px rgba(56, 189, 248, 0.95), 0 0 22px rgba(56, 189, 248, 0.85)" : "none",
      textAlign: "center" as const,
      width: 220,
      boxSizing: "border-box" as const,
      wordBreak: "break-word" as const,
      position: "relative" as const,
    }),
    [data.bgColor, data.selected],
  );

  /******************* FUNCTIONS ***********************/
  const onEnter = useCallback(() => setHovered(true), []);
  const onLeave = useCallback(() => setHovered(false), []);
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
    <div style={style} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div style={{ fontSize: 11, color: data.textColor }}>{parts.title}</div>
      {parts.code && (
        <div style={{ fontSize: 9, fontFamily: "JetBrains Mono, Fira Code, Consolas, monospace", color: data.textColor, opacity: 0.85, marginTop: 2, lineHeight: 1.3 }}>
          {parts.code}
        </div>
      )}
      <AskLlmButton
        visible={hovered || hoveredActions}
        onShowGraphLogicTree={hasGraphLogicTree ? handleShowGraphLogicTree : undefined}
        onShowCodeLogicTree={hasCodeLogicTree ? handleShowCodeLogicTree : undefined}
        onAskLlm={hasAskLlm ? handleAskLlm : undefined}
        askLlmHref={askLlmHref || undefined}
        onHoverChange={handleActionsHoverChange}
      />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
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

export default memo(ProcessNode);
