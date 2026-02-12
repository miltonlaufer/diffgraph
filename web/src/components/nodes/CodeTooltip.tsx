import { NodeToolbar, Position } from "@xyflow/react";
import { memo } from "react";

interface CodeLine {
  num: number;
  text: string;
  highlight: boolean;
}

interface CodeTooltipProps {
  visible: boolean;
  codeContext: { lines: CodeLine[] } | string | undefined;
}

const tooltipStyle: React.CSSProperties = {
  background: "#0f172a",
  border: "1px solid #334155",
  borderRadius: 8,
  padding: "6px 0",
  maxWidth: 550,
  maxHeight: 320,
  overflow: "auto",
  zIndex: 1000,
};

const lineStyle = (highlight: boolean): React.CSSProperties => ({
  display: "flex",
  gap: 8,
  padding: "1px 10px",
  fontSize: 11,
  fontFamily: "JetBrains Mono, Fira Code, Consolas, monospace",
  lineHeight: 1.6,
  background: highlight ? "rgba(56, 189, 248, 0.15)" : "transparent",
  borderLeft: highlight ? "3px solid #38bdf8" : "3px solid transparent",
});

const numStyle: React.CSSProperties = {
  color: "#475569",
  minWidth: 32,
  textAlign: "right",
  userSelect: "none",
};

const textStyle = (highlight: boolean): React.CSSProperties => ({
  color: highlight ? "#f0f9ff" : "#94a3b8",
  whiteSpace: "pre",
});

const CodeTooltip = ({ visible, codeContext }: CodeTooltipProps) => {
  if (!visible || !codeContext) return null;

  /* Support both old string format and new structured format */
  if (typeof codeContext === "string") {
    if (!codeContext) return null;
    return (
      <NodeToolbar isVisible={visible} position={Position.Bottom} offset={8}>
        <div style={tooltipStyle}>
          <pre style={{ margin: 0, padding: "4px 10px", fontSize: 11, fontFamily: "JetBrains Mono, Fira Code, Consolas, monospace", color: "#e2e8f0", lineHeight: 1.5, whiteSpace: "pre" }}>
            {codeContext}
          </pre>
        </div>
      </NodeToolbar>
    );
  }

  if (codeContext.lines.length === 0) return null;

  return (
    <NodeToolbar isVisible={visible} position={Position.Bottom} offset={8}>
      <div style={tooltipStyle}>
        {codeContext.lines.map((line) => (
          <div key={line.num} style={lineStyle(line.highlight)}>
            <span style={numStyle}>{line.num}</span>
            <span style={textStyle(line.highlight)}>{line.text}</span>
          </div>
        ))}
      </div>
    </NodeToolbar>
  );
};

export default memo(CodeTooltip);
