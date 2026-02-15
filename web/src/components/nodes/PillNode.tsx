import { Handle, Position } from "@xyflow/react";
import { memo, useMemo, useState, useCallback } from "react";
import AskLlmButton from "./AskLlmButton";
import CodeTooltip from "./CodeTooltip";

const splitLabel = (label: string): { title: string; code: string } => {
  const idx = label.indexOf("\n");
  if (idx === -1) return { title: label, code: "" };
  return { title: label.slice(0, idx), code: label.slice(idx + 1) };
};

interface PillNodeData {
  label: string;
  bgColor: string;
  textColor: string;
  selected: boolean;
  codeContext?: unknown;
  language?: string;
  functionName?: string;
  symbolName?: string;
  filePath?: string;
  askLlmNodeId?: string;
  onAskLlmForNode?: (nodeId: string) => Promise<boolean> | boolean;
}

const PillNode = ({ data }: { data: PillNodeData }) => {
  /******************* STORE ***********************/
  const [hovered, setHovered] = useState(false);

  /******************* COMPUTED ***********************/
  const parts = useMemo(() => splitLabel(data.label), [data.label]);
  const style = useMemo(
    () => ({
      padding: "6px 16px",
      borderRadius: 999,
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
  const handleAskLlm = useCallback(() => {
    if (!data.askLlmNodeId || !data.onAskLlmForNode) return false;
    return data.onAskLlmForNode(data.askLlmNodeId);
  }, [data.askLlmNodeId, data.onAskLlmForNode]);
  const hasAskLlm = Boolean(data.askLlmNodeId && data.onAskLlmForNode);

  return (
    <div style={style} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div style={{ fontSize: 11, color: data.textColor }}>{parts.title}</div>
      {parts.code && (
        <div style={{ fontSize: 9, fontFamily: "JetBrains Mono, Fira Code, Consolas, monospace", color: data.textColor, opacity: 0.85, marginTop: 2, lineHeight: 1.3 }}>
          {parts.code}
        </div>
      )}
      <AskLlmButton
        visible={hovered}
        onAskLlm={hasAskLlm ? handleAskLlm : undefined}
      />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <CodeTooltip
        visible={hovered}
        codeContext={data.codeContext as string | undefined}
        language={data.language}
        functionName={data.functionName}
        symbolName={data.symbolName}
        filePath={data.filePath}
      />
    </div>
  );
};

export default memo(PillNode);
