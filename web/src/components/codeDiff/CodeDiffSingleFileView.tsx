import { memo, type CSSProperties, type MutableRefObject } from "react";
import { HighlightedCode } from "./HighlightedCode";
import type { DiffLine } from "./types";
import { extractSearchWordFromDoubleClick, lineStyle } from "./diffUtils";
import type { PullRequestReviewThread } from "#/api";
import { ConversationBadge } from "#/components/ConversationBadge";
import { summarizeThreadBadge } from "#/lib/pullRequestComments";

const GAP_MARKER_TEXT = "...";

const gapRowCellStyle: CSSProperties = {
  background: "rgba(148, 163, 184, 0.16)",
  color: "#fcd34d",
  fontWeight: 700,
  letterSpacing: 2,
  textAlign: "center",
};

interface SimpleRowProps {
  side: "old" | "new";
  text: string;
  lineNum: number;
  type: DiffLine["type"];
  language: string;
  searchQuery: string;
  onLineClick?: (line: number, side: "old" | "new") => void;
  onLineHover?: (line: number, side: "old" | "new") => void;
  onLineHoverLeave?: () => void;
  onLineDoubleClick?: (line: number, side: "old" | "new", word: string) => void;
  reviewThreadIds?: string[];
  reviewThreadById?: Map<string, PullRequestReviewThread>;
  onOpenReviewThreads?: (threadIds: string[]) => void;
}

const SimpleRow = memo(({
  side,
  text,
  lineNum,
  type,
  language,
  searchQuery,
  onLineClick,
  onLineHover,
  onLineHoverLeave,
  onLineDoubleClick,
  reviewThreadIds,
  reviewThreadById,
  onOpenReviewThreads,
}: SimpleRowProps) => {
  const summary = summarizeThreadBadge(reviewThreadIds, reviewThreadById ?? EMPTY_REVIEW_THREAD_MAP);
  return (
    <tr
      data-line={`${side}-${lineNum}`}
      data-old-line={side === "old" ? lineNum : undefined}
      data-new-line={side === "new" ? lineNum : undefined}
      style={{ ...lineStyle(type), cursor: onLineClick ? "pointer" : "default" }}
      onClick={() => onLineClick?.(lineNum, side)}
      onMouseEnter={() => onLineHover?.(lineNum, side)}
      onMouseLeave={() => onLineHoverLeave?.()}
      onDoubleClick={(event) => {
        const word = extractSearchWordFromDoubleClick(event);
        if (!word) return;
        onLineDoubleClick?.(lineNum, side, word);
      }}
    >
      <td className="lineNum">
        <div className="lineNumInner">
          <span>{lineNum}</span>
          <ConversationBadge
            className="conversationBadgeLine"
            count={onOpenReviewThreads ? summary.totalCount : 0}
            unresolvedCount={summary.unresolvedCount}
            onClick={() => {
              if (!reviewThreadIds || !onOpenReviewThreads) return;
              onOpenReviewThreads(reviewThreadIds);
            }}
          />
        </div>
      </td>
      <td className="lineCode"><HighlightedCode code={text} language={language} searchQuery={searchQuery} /></td>
    </tr>
  );
});

interface CodeDiffSingleFileViewProps {
  mode: "added" | "removed";
  filePath: string;
  content: string;
  language: string;
  searchQuery: string;
  visibleLineNumbers?: Set<number> | null;
  oldCodeScrollRef: MutableRefObject<HTMLDivElement | null>;
  newCodeScrollRef: MutableRefObject<HTMLDivElement | null>;
  onLineClick?: (line: number, side: "old" | "new") => void;
  onLineHover?: (line: number, side: "old" | "new") => void;
  onLineHoverLeave?: () => void;
  onLineDoubleClick?: (line: number, side: "old" | "new", word: string) => void;
  oldLineReviewThreadIds?: Map<number, string[]>;
  newLineReviewThreadIds?: Map<number, string[]>;
  reviewThreadById?: Map<string, PullRequestReviewThread>;
  onOpenReviewThreads?: (threadIds: string[]) => void;
}

type VisibleSingleFileRow =
  | { kind: "line"; text: string; lineNum: number }
  | { kind: "gap"; key: string };

const EMPTY_REVIEW_THREAD_MAP = new Map<string, PullRequestReviewThread>();

export const CodeDiffSingleFileView = ({
  mode,
  filePath,
  content,
  language,
  searchQuery,
  visibleLineNumbers = null,
  oldCodeScrollRef,
  newCodeScrollRef,
  onLineClick,
  onLineHover,
  onLineHoverLeave,
  onLineDoubleClick,
  oldLineReviewThreadIds,
  newLineReviewThreadIds,
  reviewThreadById,
  onOpenReviewThreads,
}: CodeDiffSingleFileViewProps) => {
  const isAdded = mode === "added";
  const allLines = content.split("\n");
  const visibleLineRows = allLines
    .map((text, idx) => ({ text, lineNum: idx + 1 }))
    .filter((row) => visibleLineNumbers === null || visibleLineNumbers.has(row.lineNum));
  const visibleRows = visibleLineRows.reduce<VisibleSingleFileRow[]>((acc, row) => {
    const previous = acc.length > 0 ? acc[acc.length - 1] : null;
    if (previous && previous.kind === "line" && row.lineNum - previous.lineNum > 1) {
      acc.push({ kind: "gap", key: `${previous.lineNum}-${row.lineNum}` });
    }
    acc.push({ kind: "line", text: row.text, lineNum: row.lineNum });
    return acc;
  }, []);
  const lineCount = visibleLineRows.length;
  const totalLineCount = allLines.length;
  const hasLineFilter = visibleLineNumbers !== null;

  return (
    <>
      <h4 className="codeDiffTitle">
        {filePath}
        <span className="diffCount">
          {lineCount}
          {hasLineFilter ? ` of ${totalLineCount}` : ""}
          {" "}
          lines
          {" "}
          {isAdded ? "added" : "removed"}
        </span>
      </h4>
      <div className="splitCodeLayout">
        <div className="codeColumn">
          <h5 className="codeColumnHeader oldHeader">{isAdded ? "Old" : "Old (file was deleted)"}</h5>
          <div className="codeScrollArea" ref={oldCodeScrollRef}>
            {isAdded ? (
              <p className="dimText">File did not exist.</p>
            ) : lineCount === 0 ? (
              <p className="dimText">No matching logic-tree lines for this file.</p>
            ) : (
              <table className="diffTable">
                <tbody>
                  {visibleRows.map((row) => (
                    row.kind === "gap" ? (
                      <tr key={`old-gap-${row.key}`}>
                        <td className="lineNum" style={gapRowCellStyle}>{GAP_MARKER_TEXT}</td>
                        <td className="lineCode" style={gapRowCellStyle}>{GAP_MARKER_TEXT}</td>
                      </tr>
                    ) : (
                      <SimpleRow
                        key={`old-${row.lineNum}`}
                        side="old"
                        text={row.text}
                        lineNum={row.lineNum}
                        type="removed"
                        language={language}
                        searchQuery={searchQuery}
                        onLineClick={onLineClick}
                        onLineHover={onLineHover}
                        onLineHoverLeave={onLineHoverLeave}
                        onLineDoubleClick={onLineDoubleClick}
                        reviewThreadIds={oldLineReviewThreadIds?.get(row.lineNum)}
                        reviewThreadById={reviewThreadById}
                        onOpenReviewThreads={onOpenReviewThreads}
                      />
                    )
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div className="codeColumn">
          <h5 className="codeColumnHeader newHeader">{isAdded ? "New (entire file is new)" : "New"}</h5>
          <div className="codeScrollArea" ref={newCodeScrollRef}>
            {isAdded ? lineCount === 0 ? (
              <p className="dimText">No matching logic-tree lines for this file.</p>
            ) : (
              <table className="diffTable">
                <tbody>
                  {visibleRows.map((row) => (
                    row.kind === "gap" ? (
                      <tr key={`new-gap-${row.key}`}>
                        <td className="lineNum" style={gapRowCellStyle}>{GAP_MARKER_TEXT}</td>
                        <td className="lineCode" style={gapRowCellStyle}>{GAP_MARKER_TEXT}</td>
                      </tr>
                    ) : (
                      <SimpleRow
                        key={`new-${row.lineNum}`}
                        side="new"
                        text={row.text}
                        lineNum={row.lineNum}
                        type="added"
                        language={language}
                        searchQuery={searchQuery}
                        onLineClick={onLineClick}
                        onLineHover={onLineHover}
                        onLineHoverLeave={onLineHoverLeave}
                        onLineDoubleClick={onLineDoubleClick}
                        reviewThreadIds={newLineReviewThreadIds?.get(row.lineNum)}
                        reviewThreadById={reviewThreadById}
                        onOpenReviewThreads={onOpenReviewThreads}
                      />
                    )
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="dimText">File was deleted.</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
