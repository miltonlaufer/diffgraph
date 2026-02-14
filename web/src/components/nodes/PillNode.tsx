import { Handle, Position } from "@xyflow/react";
import { memo, useMemo, useState, useCallback } from "react";
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
      border: data.selected ? "3px solid #38bdf8" : "1px solid #475569",
      textAlign: "center" as const,
      minWidth: 80,
      maxWidth: 220,
      wordBreak: "break-word" as const,
    }),
    [data.bgColor, data.selected],
  );

  /******************* FUNCTIONS ***********************/
  const onEnter = useCallback(() => setHovered(true), []);
  const onLeave = useCallback(() => setHovered(false), []);

  return (
    <div style={style} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div style={{ fontSize: 11, color: data.textColor }}>{parts.title}</div>
      {parts.code && (
        <div style={{ fontSize: 9, fontFamily: "JetBrains Mono, Fira Code, Consolas, monospace", color: data.textColor, opacity: 0.85, marginTop: 2, lineHeight: 1.3 }}>
          {parts.code}
        </div>
      )}
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
