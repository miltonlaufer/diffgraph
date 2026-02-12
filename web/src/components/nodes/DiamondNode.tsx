import { Handle, Position } from "@xyflow/react";
import { memo, useMemo } from "react";

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
}

const DiamondNode = ({ data }: { data: DiamondNodeData }) => {
  /******************* COMPUTED ***********************/
  const parts = useMemo(() => splitLabel(data.label), [data.label]);
  const outerStyle = useMemo(
    () => ({
      width: 150,
      height: 150,
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

  return (
    <div style={outerStyle}>
      <div style={{ transform: "rotate(-45deg)", textAlign: "center", maxWidth: 110, wordBreak: "break-word" as const }}>
        <div style={{ fontSize: 10, color: data.textColor, opacity: 0.7, marginBottom: 2 }}>{parts.title}</div>
        {parts.code && (
          <div style={{ fontSize: 9, fontFamily: "JetBrains Mono, Fira Code, Consolas, monospace", color: data.textColor, lineHeight: 1.3 }}>
            {parts.code}
          </div>
        )}
      </div>
      <Handle type="target" position={Position.Top} style={{ transform: "rotate(-45deg)" }} />
      {/* "true" handle on the right */}
      <Handle type="source" position={Position.Right} id="yes" style={{ transform: "rotate(-45deg)", top: "25%" }} />
      <span style={{
        position: "absolute", right: -6, top: "15%", transform: "rotate(-45deg)",
        fontSize: 9, color: "#4ade80", fontWeight: 600,
      }}>T</span>
      {/* "false" handle at the bottom */}
      <Handle type="source" position={Position.Bottom} id="no" style={{ transform: "rotate(-45deg)" }} />
      <span style={{
        position: "absolute", bottom: -6, left: "15%", transform: "rotate(-45deg)",
        fontSize: 9, color: "#f87171", fontWeight: 600,
      }}>F</span>
    </div>
  );
};

export default memo(DiamondNode);
