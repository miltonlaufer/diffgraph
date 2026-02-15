import { Handle, Position } from "@xyflow/react";
import { memo, useMemo, useState, useCallback } from "react";
import AskLlmButton from "./AskLlmButton";
import CodeTooltip from "./CodeTooltip";

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
}

const KnowledgeNode = ({ data }: { data: KnowledgeNodeData }) => {
  /******************* STORE ***********************/
  const [hovered, setHovered] = useState(false);

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
      overflow: "hidden" as const,
      boxShadow: data.selected ? "0 0 0 2px rgba(56, 189, 248, 0.95), 0 0 22px rgba(56, 189, 248, 0.85)" : "none",
      cursor: "pointer",
      position: "relative" as const,
    }),
    [data.bgColor, data.textColor, data.selected],
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
    <div style={style} title={`${data.label}\n${data.fullPath}`} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>
        {data.label}
      </div>
      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, opacity: 0.7 }}>
        {data.shortPath}
      </div>
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
        filePath={data.filePath ?? data.fullPath}
      />
    </div>
  );
};

export default memo(KnowledgeNode);
