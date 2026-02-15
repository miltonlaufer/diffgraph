import type { MutableRefObject } from "react";
import { emptyLineStyle, lineStyle } from "./diffUtils";
import { HighlightedCode } from "./HighlightedCode";
import type { DiffMatrixRow } from "./types";

interface CodeDiffMatrixViewProps {
  matrixRows: DiffMatrixRow[];
  language: string;
  oldCodeScrollRef: MutableRefObject<HTMLDivElement | null>;
  newCodeScrollRef: MutableRefObject<HTMLDivElement | null>;
  onOldScroll: () => void;
  onNewScroll: () => void;
  onLineClick?: (line: number, side: "old" | "new") => void;
}

export const CodeDiffMatrixView = ({
  matrixRows,
  language,
  oldCodeScrollRef,
  newCodeScrollRef,
  onOldScroll,
  onNewScroll,
  onLineClick,
}: CodeDiffMatrixViewProps) => (
  <div className="splitCodeLayout">
    <div className="codeColumn">
      <h5 className="codeColumnHeader oldHeader">Old</h5>
      <div className="codeScrollArea" ref={oldCodeScrollRef} onScroll={onOldScroll}>
        <table className="diffTable">
          <tbody>
            {matrixRows.map((row, i) => (
              <tr
                key={`old-row-${i}`}
                data-old-line={row.old.lineNumber ?? undefined}
                data-new-line={row.new.lineNumber ?? undefined}
                style={{ cursor: row.old.lineNumber ? "pointer" : "default" }}
                onClick={() => {
                  if (row.old.lineNumber) onLineClick?.(row.old.lineNumber, "old");
                }}
              >
                <td className="lineNum" style={lineStyle(row.old.type)}>{row.old.lineNumber ?? ""}</td>
                <td className="lineCode" style={lineStyle(row.old.type)}>
                  {row.old.type === "empty" ? <span style={emptyLineStyle}>&nbsp;</span> : <HighlightedCode code={row.old.text} language={language} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    <div className="codeColumn">
      <h5 className="codeColumnHeader newHeader">New</h5>
      <div className="codeScrollArea" ref={newCodeScrollRef} onScroll={onNewScroll}>
        <table className="diffTable">
          <tbody>
            {matrixRows.map((row, i) => (
              <tr
                key={`new-row-${i}`}
                data-old-line={row.old.lineNumber ?? undefined}
                data-new-line={row.new.lineNumber ?? undefined}
                style={{ cursor: row.new.lineNumber ? "pointer" : "default" }}
                onClick={() => {
                  if (row.new.lineNumber) onLineClick?.(row.new.lineNumber, "new");
                }}
              >
                <td className="lineNum" style={lineStyle(row.new.type)}>{row.new.lineNumber ?? ""}</td>
                <td className="lineCode" style={lineStyle(row.new.type)}>
                  {row.new.type === "empty" ? <span style={emptyLineStyle}>&nbsp;</span> : <HighlightedCode code={row.new.text} language={language} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  </div>
);
