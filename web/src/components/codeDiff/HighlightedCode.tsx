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

export const HighlightedCode = memo(({ code, language }: { code: string; language: string }) => (
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
));
