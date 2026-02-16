import type { ReactNode } from "react";

interface MarkdownViewerProps {
  markdown: string;
}

const inlineTokenPattern = /(\[[^\]]+\]\(([^)]+)\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;

const renderInline = (text: string, keyPrefix: string): ReactNode[] => {
  const segments = text
    .split(inlineTokenPattern)
    .filter((segment): segment is string => typeof segment === "string" && segment.length > 0);
  return segments.map((segment, idx) => {
    const key = `${keyPrefix}-${idx}`;
    if (segment.startsWith("[") && segment.includes("](") && segment.endsWith(")")) {
      const match = segment.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (match) {
        return (
          <a key={key} href={match[2]} target="_blank" rel="noopener noreferrer">
            {match[1]}
          </a>
        );
      }
    }
    if (segment.startsWith("`") && segment.endsWith("`")) {
      return <code key={key}>{segment.slice(1, -1)}</code>;
    }
    if (segment.startsWith("**") && segment.endsWith("**")) {
      return <strong key={key}>{segment.slice(2, -2)}</strong>;
    }
    if (segment.startsWith("*") && segment.endsWith("*")) {
      return <em key={key}>{segment.slice(1, -1)}</em>;
    }
    return <span key={key}>{segment}</span>;
  });
};

const isListStart = (line: string): boolean => /^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line);

export const MarkdownViewer = ({ markdown }: MarkdownViewerProps) => {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let blockId = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      i += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const language = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(
        <pre key={`code-${blockId++}`} className="markdownCodeBlock">
          <code data-lang={language || undefined}>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2] ?? "";
      const className = `markdownHeading markdownHeading${level}`;
      blocks.push(
        <div key={`h-${blockId++}`} className={className}>
          {renderInline(content, `h-inline-${blockId}`)}
        </div>,
      );
      i += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*[-*]\s+/, "").trim());
        i += 1;
      }
      blocks.push(
        <ul key={`ul-${blockId++}`} className="markdownList">
          {items.map((item, idx) => (
            <li key={`uli-${idx}`}>{renderInline(item, `uli-${blockId}-${idx}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*\d+\.\s+/, "").trim());
        i += 1;
      }
      blocks.push(
        <ol key={`ol-${blockId++}`} className="markdownList">
          {items.map((item, idx) => (
            <li key={`oli-${idx}`}>{renderInline(item, `oli-${blockId}-${idx}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? "")) {
        quoteLines.push((lines[i] ?? "").replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push(
        <blockquote key={`q-${blockId++}`} className="markdownQuote">
          {renderInline(quoteLines.join(" "), `q-inline-${blockId}`)}
        </blockquote>,
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const next = lines[i] ?? "";
      const nextTrimmed = next.trim();
      if (
        nextTrimmed.length === 0
        || nextTrimmed.startsWith("```")
        || /^#{1,6}\s+/.test(next)
        || /^\s*>\s?/.test(next)
        || isListStart(next)
      ) {
        break;
      }
      paragraphLines.push(nextTrimmed);
      i += 1;
    }
    if (paragraphLines.length > 0) {
      blocks.push(
        <p key={`p-${blockId++}`} className="markdownParagraph">
          {renderInline(paragraphLines.join(" "), `p-inline-${blockId}`)}
        </p>,
      );
      continue;
    }

    i += 1;
  }

  return <div className="markdownViewer">{blocks}</div>;
};
