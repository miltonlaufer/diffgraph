import { Handle, Position } from "@xyflow/react";
import { memo, useMemo, useState, useCallback } from "react";
import CodeTooltip from "./CodeTooltip";

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
  codeContext?: unknown;
  language?: string;
}

const DiamondNode = ({ data }: { data: DiamondNodeData }) => {
  /******************* STORE ***********************/
  const [hovered, setHovered] = useState(false);

  /******************* COMPUTED ***********************/
  const parts = useMemo(() => splitLabel(data.label), [data.label]);
  const outerStyle = useMemo(
    () => ({
      width: 120,
      height: 120,
      transform: "rotate(45deg)",
      background: data.bgColor,
      border: data.selected ? "3px solid #38bdf8" : "1px solid #475569",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      position: "relative" as const,
    }),
    [data.bgColor, data.selected],
  );

  /******************* FUNCTIONS ***********************/
  const onEnter = useCallback(() => setHovered(true), []);
  const onLeave = useCallback(() => setHovered(false), []);

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
      <span style={{ position: "absolute", right: -6, top: "15%", transform: "rotate(-45deg)", fontSize: 9, color: "#4ade80", fontWeight: 600 }}>T</span>
      <Handle type="source" position={Position.Bottom} id="no" style={{ transform: "rotate(-45deg)" }} />
      <span style={{ position: "absolute", bottom: -6, left: "15%", transform: "rotate(-45deg)", fontSize: 9, color: "#f87171", fontWeight: 600 }}>F</span>
      <CodeTooltip visible={hovered} codeContext={data.codeContext as string | undefined} language={data.language} />
    </div>
  );
};

export default memo(DiamondNode);
