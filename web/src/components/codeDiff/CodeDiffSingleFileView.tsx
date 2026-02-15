import { memo, type MutableRefObject } from "react";
import { HighlightedCode } from "./HighlightedCode";
import type { DiffLine } from "./types";
import { lineStyle } from "./diffUtils";

interface SimpleRowProps {
  side: "old" | "new";
  text: string;
  lineNum: number;
  type: DiffLine["type"];
  language: string;
  onLineClick?: (line: number, side: "old" | "new") => void;
}

const SimpleRow = memo(({ side, text, lineNum, type, language, onLineClick }: SimpleRowProps) => (
  <tr
    data-line={`${side}-${lineNum}`}
    data-old-line={side === "old" ? lineNum : undefined}
    data-new-line={side === "new" ? lineNum : undefined}
    style={{ ...lineStyle(type), cursor: onLineClick ? "pointer" : "default" }}
    onClick={() => onLineClick?.(lineNum, side)}
  >
    <td className="lineNum">{lineNum}</td>
    <td className="lineCode"><HighlightedCode code={text} language={language} /></td>
  </tr>
));

interface CodeDiffSingleFileViewProps {
  mode: "added" | "removed";
  filePath: string;
  content: string;
  language: string;
  oldCodeScrollRef: MutableRefObject<HTMLDivElement | null>;
  newCodeScrollRef: MutableRefObject<HTMLDivElement | null>;
  onLineClick?: (line: number, side: "old" | "new") => void;
}

export const CodeDiffSingleFileView = ({
  mode,
  filePath,
  content,
  language,
  oldCodeScrollRef,
  newCodeScrollRef,
  onLineClick,
}: CodeDiffSingleFileViewProps) => {
  const isAdded = mode === "added";
  const lineCount = content.split("\n").length;

  return (
    <>
      <h4 className="codeDiffTitle">{filePath} <span className="diffCount">{lineCount} lines {isAdded ? "added" : "removed"}</span></h4>
      <div className="splitCodeLayout">
        <div className="codeColumn">
          <h5 className="codeColumnHeader oldHeader">{isAdded ? "Old" : "Old (file was deleted)"}</h5>
          <div className="codeScrollArea" ref={oldCodeScrollRef}>
            {isAdded ? (
              <p className="dimText">File did not exist.</p>
            ) : (
              <table className="diffTable">
                <tbody>
                  {content.split("\n").map((line, i) => (
                    <SimpleRow key={`old-${i}`} side="old" text={line} lineNum={i + 1} type="removed" language={language} onLineClick={onLineClick} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div className="codeColumn">
          <h5 className="codeColumnHeader newHeader">{isAdded ? "New (entire file is new)" : "New"}</h5>
          <div className="codeScrollArea" ref={newCodeScrollRef}>
            {isAdded ? (
              <table className="diffTable">
                <tbody>
                  {content.split("\n").map((line, i) => (
                    <SimpleRow key={`new-${i}`} side="new" text={line} lineNum={i + 1} type="added" language={language} onLineClick={onLineClick} />
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
