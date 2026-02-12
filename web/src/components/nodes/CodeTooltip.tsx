import { NodeToolbar, Position } from "@xyflow/react";
import { memo } from "react";

interface CodeTooltipProps {
  visible: boolean;
  codeContext: string;
}

const tooltipStyle: React.CSSProperties = {
  background: "#0f172a",
  border: "1px solid #334155",
  borderRadius: 8,
  padding: "8px 10px",
  maxWidth: 500,
  maxHeight: 300,
  overflow: "auto",
  zIndex: 1000,
};

const preStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  fontFamily: "JetBrains Mono, Fira Code, Consolas, monospace",
  color: "#e2e8f0",
  lineHeight: 1.5,
  whiteSpace: "pre",
};

const CodeTooltip = ({ visible, codeContext }: CodeTooltipProps) => {
  if (!visible || !codeContext) return null;

  return (
    <NodeToolbar isVisible={visible} position={Position.Bottom} offset={8}>
      <div style={tooltipStyle}>
        <pre style={preStyle}>{codeContext}</pre>
      </div>
    </NodeToolbar>
  );
};

export default memo(CodeTooltip);
