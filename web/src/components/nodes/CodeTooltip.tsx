import { NodeToolbar, Position } from "@xyflow/react";
import { memo } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface CodeLine {
  num: number;
  text: string;
  highlight: boolean;
}

interface CodeTooltipProps {
  visible: boolean;
  codeContext: { lines: CodeLine[] } | string | undefined;
  language?: string;
  functionName?: string;
  symbolName?: string;
  filePath?: string;
}

const tooltipStyle: React.CSSProperties = {
  background: "#0f172a",
  border: "1px solid #334155",
  borderRadius: 8,
  padding: "6px 0",
  maxWidth: 600,
  maxHeight: 320,
  overflowY: "auto",
  overflowX: "hidden",
  zIndex: 1000,
};

const lineContainerStyle = (highlight: boolean): React.CSSProperties => ({
  display: "flex",
  gap: 8,
  padding: "1px 10px",
  lineHeight: 1.6,
  background: highlight ? "rgba(56, 189, 248, 0.15)" : "transparent",
  borderLeft: highlight ? "3px solid #38bdf8" : "3px solid transparent",
});

const numStyle: React.CSSProperties = {
  color: "#475569",
  minWidth: 32,
  textAlign: "right",
  userSelect: "none",
  fontSize: 11,
  fontFamily: "JetBrains Mono, Fira Code, Consolas, monospace",
};

const inlineStyle: React.CSSProperties = {
  display: "inline",
  padding: 0,
  margin: 0,
  background: "none",
  backgroundColor: "transparent",
  fontSize: 11,
  fontFamily: "JetBrains Mono, Fira Code, Consolas, monospace",
  lineHeight: "inherit",
  whiteSpace: "pre",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: 500,
};

const metaContainerStyle: React.CSSProperties = {
  padding: "0 10px 6px",
  borderBottom: "1px solid #1e293b",
  marginBottom: 4,
  fontSize: 11,
  fontFamily: "JetBrains Mono, Fira Code, Consolas, monospace",
  color: "#cbd5e1",
  lineHeight: 1.4,
};

const metaLabelStyle: React.CSSProperties = {
  color: "#94a3b8",
  marginRight: 6,
};

const metaValueStyle: React.CSSProperties = {
  color: "#e2e8f0",
  wordBreak: "break-word",
};

const HighlightedLine = memo(({ code, language }: { code: string; language: string }) => (
  <SyntaxHighlighter
    language={language}
    style={oneDark}
    customStyle={inlineStyle}
    PreTag="span"
    CodeTag="span"
    useInlineStyles
  >
    {code || " "}
  </SyntaxHighlighter>
));

const CodeTooltip = ({ visible, codeContext, language, functionName, symbolName, filePath }: CodeTooltipProps) => {
  if (!visible) return null;
  const hasFunction = Boolean(functionName && functionName.trim().length > 0);
  const hasSymbol = Boolean(symbolName && symbolName.trim().length > 0 && symbolName !== functionName);
  const hasFile = Boolean(filePath && filePath.trim().length > 0);
  const hasMeta = hasFunction || hasSymbol || hasFile;
  if (!codeContext && !hasMeta) return null;
  const lang = language ?? "text";

  if (typeof codeContext === "string") {
    if (!codeContext && !hasMeta) return null;
    return (
      <NodeToolbar isVisible={visible} position={Position.Bottom} offset={8}>
        <div style={tooltipStyle}>
          {hasMeta && (
            <div style={metaContainerStyle}>
              {hasFunction && (
                <div><span style={metaLabelStyle}>Function:</span><span style={metaValueStyle}>{functionName}</span></div>
              )}
              {hasSymbol && (
                <div><span style={metaLabelStyle}>Symbol:</span><span style={metaValueStyle}>{symbolName}</span></div>
              )}
              {hasFile && (
                <div><span style={metaLabelStyle}>File:</span><span style={metaValueStyle}>{filePath}</span></div>
              )}
            </div>
          )}
          <SyntaxHighlighter
            language={lang}
            style={oneDark}
            customStyle={{ margin: 0, padding: "4px 10px", fontSize: 11, background: "transparent" }}
            showLineNumbers={false}
          >
            {codeContext || ""}
          </SyntaxHighlighter>
        </div>
      </NodeToolbar>
    );
  }

  if ((!codeContext || codeContext.lines.length === 0) && !hasMeta) return null;

  return (
    <NodeToolbar isVisible={visible} position={Position.Bottom} offset={8}>
      <div style={tooltipStyle}>
        {hasMeta && (
          <div style={metaContainerStyle}>
            {hasFunction && (
              <div><span style={metaLabelStyle}>Function:</span><span style={metaValueStyle}>{functionName}</span></div>
            )}
            {hasSymbol && (
              <div><span style={metaLabelStyle}>Symbol:</span><span style={metaValueStyle}>{symbolName}</span></div>
            )}
            {hasFile && (
              <div><span style={metaLabelStyle}>File:</span><span style={metaValueStyle}>{filePath}</span></div>
            )}
          </div>
        )}
        {codeContext && codeContext.lines.map((line) => (
          <div key={line.num} style={lineContainerStyle(line.highlight)}>
            <span style={numStyle}>{line.num}</span>
            <HighlightedLine code={line.text} language={lang} />
          </div>
        ))}
      </div>
    </NodeToolbar>
  );
};

export default memo(CodeTooltip);
