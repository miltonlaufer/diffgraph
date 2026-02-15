import { memo, type CSSProperties } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

const inlineHighlightStyle: CSSProperties = {
  display: "inline",
  padding: 0,
  margin: 0,
  background: "none",
  backgroundColor: "transparent",
  fontSize: "inherit",
  fontFamily: "inherit",
  lineHeight: "inherit",
  whiteSpace: "pre",
};

const searchMatchStyle: CSSProperties = {
  background: "rgba(251, 191, 36, 0.36)",
  color: "#fef3c7",
  borderRadius: 3,
  boxShadow: "0 0 0 1px rgba(251,191,36,0.55) inset",
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface HighlightedCodeProps {
  code: string;
  language: string;
  searchQuery?: string;
}

export const HighlightedCode = memo(({ code, language, searchQuery = "" }: HighlightedCodeProps) => {
  const query = searchQuery.trim();
  if (query.length < 2) {
    return (
      <SyntaxHighlighter
        language={language}
        style={oneDark}
        customStyle={inlineHighlightStyle}
        PreTag="span"
        CodeTag="span"
        useInlineStyles
      >
        {code || " "}
      </SyntaxHighlighter>
    );
  }

  const source = code || " ";
  const pattern = new RegExp(`(${escapeRegExp(query)})`, "gi");
  const segments = source.split(pattern);
  return (
    <span style={inlineHighlightStyle}>
      {segments.map((segment, idx) => {
        if (segment.length === 0) return null;
        const isMatch = segment.localeCompare(query, undefined, { sensitivity: "accent" }) === 0
          || segment.toLowerCase() === query.toLowerCase();
        if (!isMatch) return <span key={`${idx}-${segment}`}>{segment}</span>;
        return (
          <mark key={`${idx}-${segment}`} style={searchMatchStyle}>
            {segment}
          </mark>
        );
      })}
    </span>
  );
});
