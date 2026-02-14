import { Handle, Position } from "@xyflow/react";
import { memo, useMemo, useState, useCallback } from "react";
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
      border: data.selected ? "3px solid #38bdf8" : "1px solid #475569",
      color: data.textColor,
      fontSize: 11,
      width: 200,
      overflow: "hidden" as const,
      boxShadow: data.selected ? "0 0 12px #38bdf8" : "none",
      cursor: "pointer",
    }),
    [data.bgColor, data.textColor, data.selected],
  );

  /******************* FUNCTIONS ***********************/
  const onEnter = useCallback(() => setHovered(true), []);
  const onLeave = useCallback(() => setHovered(false), []);

  return (
    <div style={style} title={`${data.label}\n${data.fullPath}`} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>
        {data.label}
      </div>
      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, opacity: 0.7 }}>
        {data.shortPath}
      </div>
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
