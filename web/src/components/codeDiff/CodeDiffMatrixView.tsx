import type { CSSProperties, MutableRefObject } from "react";
import { emptyLineStyle, extractSearchWordFromDoubleClick, lineStyle } from "./diffUtils";
import { HighlightedCode } from "./HighlightedCode";
import type { DiffMatrixRow } from "./types";

const GAP_MARKER_TEXT = "...";

const gapRowCellStyle: CSSProperties = {
  background: "rgba(148, 163, 184, 0.16)",
  color: "#fcd34d",
  fontWeight: 700,
  letterSpacing: 2,
  textAlign: "center",
};

const isGapRow = (row: DiffMatrixRow): boolean =>
  row.old.lineNumber === null
  && row.new.lineNumber === null
  && row.old.text === GAP_MARKER_TEXT
  && row.new.text === GAP_MARKER_TEXT;

const rowKey = (row: DiffMatrixRow, i: number): string =>
  isGapRow(row)
    ? `gap-${i}`
    : `row-${row.old.lineNumber ?? "x"}-${row.new.lineNumber ?? "x"}`;

interface CodeDiffMatrixViewProps {
  matrixRows: DiffMatrixRow[];
  language: string;
  searchQuery: string;
  oldCodeScrollRef: MutableRefObject<HTMLDivElement | null>;
  newCodeScrollRef: MutableRefObject<HTMLDivElement | null>;
  onOldScroll: () => void;
  onNewScroll: () => void;
  onLineClick?: (line: number, side: "old" | "new") => void;
  onLineHover?: (line: number, side: "old" | "new") => void;
  onLineHoverLeave?: () => void;
  onLineDoubleClick?: (line: number, side: "old" | "new", word: string) => void;
}

export const CodeDiffMatrixView = ({
  matrixRows,
  language,
  searchQuery,
  oldCodeScrollRef,
  newCodeScrollRef,
  onOldScroll,
  onNewScroll,
  onLineClick,
  onLineHover,
  onLineHoverLeave,
  onLineDoubleClick,
}: CodeDiffMatrixViewProps) => (
  <div className="splitCodeLayout">
    <div className="codeColumn">
      <h5 className="codeColumnHeader oldHeader">Old</h5>
      <div className="codeScrollArea" ref={oldCodeScrollRef} onScroll={onOldScroll}>
        <table className="diffTable">
          <tbody>
            {matrixRows.map((row, i) => {
              const gapRow = isGapRow(row);
              return (
                <tr
                  key={rowKey(row, i)}
                  data-old-line={row.old.lineNumber ?? undefined}
                  data-new-line={row.new.lineNumber ?? undefined}
                  style={{ cursor: row.old.lineNumber && !gapRow ? "pointer" : "default" }}
                  onClick={() => {
                    if (row.old.lineNumber && !gapRow) onLineClick?.(row.old.lineNumber, "old");
                  }}
                  onMouseEnter={() => {
                    if (row.old.lineNumber && !gapRow) onLineHover?.(row.old.lineNumber, "old");
                  }}
                  onMouseLeave={() => onLineHoverLeave?.()}
                  onDoubleClick={(event) => {
                    if (!row.old.lineNumber || gapRow) return;
                    const word = extractSearchWordFromDoubleClick(event);
                    if (!word) return;
                    onLineDoubleClick?.(row.old.lineNumber, "old", word);
                  }}
                >
                  <td className="lineNum" style={gapRow ? gapRowCellStyle : lineStyle(row.old.type)}>
                    {gapRow ? GAP_MARKER_TEXT : row.old.lineNumber ?? ""}
                  </td>
                  <td className="lineCode" style={gapRow ? gapRowCellStyle : lineStyle(row.old.type)}>
                    {gapRow
                      ? <span>{GAP_MARKER_TEXT}</span>
                      : row.old.type === "empty"
                        ? <span style={emptyLineStyle}>&nbsp;</span>
                        : <HighlightedCode code={row.old.text} language={language} searchQuery={searchQuery} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
    <div className="codeColumn">
      <h5 className="codeColumnHeader newHeader">New</h5>
      <div className="codeScrollArea" ref={newCodeScrollRef} onScroll={onNewScroll}>
        <table className="diffTable">
          <tbody>
            {matrixRows.map((row, i) => {
              const gapRow = isGapRow(row);
              return (
                <tr
                  key={rowKey(row, i)}
                  data-old-line={row.old.lineNumber ?? undefined}
                  data-new-line={row.new.lineNumber ?? undefined}
                  style={{ cursor: row.new.lineNumber && !gapRow ? "pointer" : "default" }}
                  onClick={() => {
                    if (row.new.lineNumber && !gapRow) onLineClick?.(row.new.lineNumber, "new");
                  }}
                  onMouseEnter={() => {
                    if (row.new.lineNumber && !gapRow) onLineHover?.(row.new.lineNumber, "new");
                  }}
                  onMouseLeave={() => onLineHoverLeave?.()}
                  onDoubleClick={(event) => {
                    if (!row.new.lineNumber || gapRow) return;
                    const word = extractSearchWordFromDoubleClick(event);
                    if (!word) return;
                    onLineDoubleClick?.(row.new.lineNumber, "new", word);
                  }}
                >
                  <td className="lineNum" style={gapRow ? gapRowCellStyle : lineStyle(row.new.type)}>
                    {gapRow ? GAP_MARKER_TEXT : row.new.lineNumber ?? ""}
                  </td>
                  <td className="lineCode" style={gapRow ? gapRowCellStyle : lineStyle(row.new.type)}>
                    {gapRow
                      ? <span>{GAP_MARKER_TEXT}</span>
                      : row.new.type === "empty"
                        ? <span style={emptyLineStyle}>&nbsp;</span>
                        : <HighlightedCode code={row.new.text} language={language} searchQuery={searchQuery} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  </div>
);
