import { Handle, Position } from "@xyflow/react";
import { memo, useMemo } from "react";

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
}

const ProcessNode = ({ data }: { data: ProcessNodeData }) => {
  /******************* COMPUTED ***********************/
  const parts = useMemo(() => splitLabel(data.label), [data.label]);
  const style = useMemo(
    () => ({
      padding: "6px 14px",
      borderRadius: 6,
      background: data.bgColor,
      border: data.selected ? "3px solid #38bdf8" : "1px solid #475569",
      textAlign: "center" as const,
      minWidth: 100,
      maxWidth: 240,
      wordBreak: "break-word" as const,
    }),
    [data.bgColor, data.selected],
  );

  return (
    <div style={style}>
      <div style={{ fontSize: 11, color: data.textColor }}>{parts.title}</div>
      {parts.code && (
        <div style={{ fontSize: 9, fontFamily: "JetBrains Mono, Fira Code, Consolas, monospace", color: data.textColor, opacity: 0.85, marginTop: 2, lineHeight: 1.3 }}>
          {parts.code}
        </div>
      )}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
};

export default memo(ProcessNode);
