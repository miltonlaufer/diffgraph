import { Handle, Position } from "@xyflow/react";
import { memo, useMemo, useState, useCallback } from "react";
import AskLlmButton from "./AskLlmButton";
import CodeTooltip from "./CodeTooltip";
import { useDebouncedValue } from "../useDebouncedValue";

interface KnowledgeNodeData {
  label: string;
  symbolName?: string;
  functionName?: string;
  filePath?: string;
  shortPath: string;
  fullPath: string;
  bgColor: string;
  textColor: string;
  selected: boolean;
  codeContext?: unknown;
  language?: string;
  askLlmNodeId?: string;
  onAskLlmForNode?: (nodeId: string) => Promise<boolean> | boolean;
  onAskLlmHrefForNode?: (nodeId: string) => string;
}

const KnowledgeNode = ({ data }: { data: KnowledgeNodeData }) => {
  /******************* STORE ***********************/
  const [hovered, setHovered] = useState(false);
  const [hoveredActions, setHoveredActions] = useState(false);
  const tooltipVisible = useDebouncedValue(hovered, 500);
  const { askLlmNodeId, onAskLlmForNode, onAskLlmHrefForNode } = data;

  /******************* COMPUTED ***********************/
  const style = useMemo(
    () => ({
      padding: "6px 10px",
      borderRadius: 8,
      background: data.bgColor,
      border: data.selected ? "5px solid #f8fafc" : "1px solid #475569",
      color: data.textColor,
      fontSize: 11,
      width: 200,
      overflow: "visible" as const,
      boxShadow: data.selected ? "0 0 0 2px rgba(56, 189, 248, 0.95), 0 0 22px rgba(56, 189, 248, 0.85)" : "none",
      cursor: "pointer",
      position: "relative" as const,
    }),
    [data.bgColor, data.textColor, data.selected],
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
  const hasAskLlm = Boolean(askLlmNodeId && onAskLlmForNode);

  return (
    <div style={style} title={`${data.label}\n${data.fullPath}`} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>
        {data.label}
      </div>
      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, opacity: 0.7 }}>
        {data.shortPath}
      </div>
      <AskLlmButton
        visible={hovered || hoveredActions}
        onAskLlm={hasAskLlm ? handleAskLlm : undefined}
        askLlmHref={askLlmHref || undefined}
        onHoverChange={handleActionsHoverChange}
      />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <CodeTooltip
        visible={tooltipVisible}
        codeContext={data.codeContext as string | undefined}
        language={data.language}
        functionName={data.functionName}
        symbolName={data.symbolName}
        filePath={data.filePath ?? data.fullPath}
      />
    </div>
  );
};

export default memo(KnowledgeNode);
