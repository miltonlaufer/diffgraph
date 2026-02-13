import { useMemo, useCallback, useRef, useEffect, useState, memo, type ChangeEvent, type KeyboardEvent } from "react";
import { diffLines } from "diff";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { FileDiffEntry } from "../types/graph";

interface CodeDiffDrawerProps {
  file: FileDiffEntry | null;
  targetLine: number;
  scrollTick: number;
}

interface DiffLine {
  text: string;
  type: "same" | "added" | "removed" | "empty";
  lineNumber: number | null;
}

const computeSideBySide = (
  oldContent: string,
  newContent: string,
): { oldLines: DiffLine[]; newLines: DiffLine[] } => {
  const changes = diffLines(oldContent, newContent);
  const oldLines: DiffLine[] = [];
  const newLines: DiffLine[] = [];
  let oldLineNum = 1;
  let newLineNum = 1;

  let i = 0;
  while (i < changes.length) {
    const change = changes[i];
    const lines = change.value.replace(/\n$/, "").split("\n");

    if (!change.added && !change.removed) {
      /* Unchanged: same row on both sides */
      for (const line of lines) {
        oldLines.push({ text: line, type: "same", lineNumber: oldLineNum++ });
        newLines.push({ text: line, type: "same", lineNumber: newLineNum++ });
      }
      i++;
    } else if (change.removed && i + 1 < changes.length && changes[i + 1].added) {
      /* Removed + Added pair: show side by side, pad the shorter side */
      const removedLines = lines;
      const addedLines = changes[i + 1].value.replace(/\n$/, "").split("\n");
      const maxLen = Math.max(removedLines.length, addedLines.length);
      for (let j = 0; j < maxLen; j++) {
        if (j < removedLines.length) {
          oldLines.push({ text: removedLines[j], type: "removed", lineNumber: oldLineNum++ });
        } else {
          oldLines.push({ text: "", type: "empty", lineNumber: null });
        }
        if (j < addedLines.length) {
          newLines.push({ text: addedLines[j], type: "added", lineNumber: newLineNum++ });
        } else {
          newLines.push({ text: "", type: "empty", lineNumber: null });
        }
      }
      i += 2;
    } else if (change.removed) {
      /* Removed only: old side shows lines, new side gets empty placeholders */
      for (const line of lines) {
        oldLines.push({ text: line, type: "removed", lineNumber: oldLineNum++ });
        newLines.push({ text: "", type: "empty", lineNumber: null });
      }
      i++;
    } else if (change.added) {
      /* Added only: new side shows lines, old side gets empty placeholders */
      for (const line of lines) {
        oldLines.push({ text: "", type: "empty", lineNumber: null });
        newLines.push({ text: line, type: "added", lineNumber: newLineNum++ });
      }
      i++;
    } else {
      i++;
    }
  }
  return { oldLines, newLines };
};

/** Find row indices where diff hunks start (groups of consecutive changed lines) */
const findDiffHunkStarts = (lines: DiffLine[]): number[] => {
  const starts: number[] = [];
  let inHunk = false;
  for (let i = 0; i < lines.length; i++) {
    const isChanged = lines[i].type !== "same";
    if (isChanged && !inHunk) {
      starts.push(i);
      inHunk = true;
    } else if (!isChanged) {
      inHunk = false;
    }
  }
  return starts;
};

const lineStyle = (type: DiffLine["type"]): React.CSSProperties => {
  switch (type) {
    case "added":
      return { background: "rgba(34, 197, 94, 0.25)" };
    case "removed":
      return { background: "rgba(239, 68, 68, 0.4)" };
    case "empty":
      return { background: "rgba(15, 23, 42, 0.1)" };
    default:
      return { background: "transparent" };
  }
};

const langFromPath = (path: string): string => {
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  if (path.endsWith(".js") || path.endsWith(".jsx")) return "javascript";
  if (path.endsWith(".py")) return "python";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".json")) return "json";
  return "text";
};

const inlineHighlightStyle: React.CSSProperties = {
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

const HighlightedCode = memo(({ code, language }: { code: string; language: string }) => (
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

interface DiffRowProps {
  side: string;
  index: number;
  line: DiffLine;
  language: string;
}

const DiffRow = memo(({ side, line, language }: Omit<DiffRowProps, "index">) => (
  <tr data-line={line.lineNumber ? `${side}-${line.lineNumber}` : undefined} style={lineStyle(line.type)}>
    <td className="lineNum">{line.lineNumber ?? ""}</td>
    <td className="lineCode">{line.type === "empty" ? <span /> : <HighlightedCode code={line.text} language={language} />}</td>
  </tr>
));

interface SimpleRowProps {
  side: string;
  index: number;
  text: string;
  lineNum: number;
  type: DiffLine["type"];
  language: string;
}

const SimpleRow = memo(({ side, text, lineNum, type, language }: Omit<SimpleRowProps, "index">) => (
  <tr data-line={`${side}-${lineNum}`} style={lineStyle(type)}>
    <td className="lineNum">{lineNum}</td>
    <td className="lineCode"><HighlightedCode code={text} language={language} /></td>
  </tr>
));

const scrollToRowIndex = (container: HTMLDivElement | null, rowIndex: number): void => {
  if (!container) return;
  const rows = container.querySelectorAll("tr");
  const row = rows[rowIndex] as HTMLElement | undefined;
  if (!row) return;
  const containerRect = container.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const offset = rowRect.top - containerRect.top + container.scrollTop;
  container.scrollTop = Math.max(0, offset - containerRect.height / 3);
  row.style.outline = "2px solid #38bdf8";
  row.style.outlineOffset = "-2px";
  setTimeout(() => {
    row.style.outline = "";
    row.style.outlineOffset = "";
  }, 1200);
};

export const CodeDiffDrawer = ({ file, targetLine, scrollTick }: CodeDiffDrawerProps) => {
  /******************* STORE ***********************/
  const oldScrollRef = useRef<HTMLDivElement>(null);
  const newScrollRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const [currentHunkIdx, setCurrentHunkIdx] = useState(0);
  const [textSearch, setTextSearch] = useState("");
  const [textSearchIdx, setTextSearchIdx] = useState(0);

  /******************* COMPUTED ***********************/
  const lang = useMemo(() => langFromPath(file?.path ?? ""), [file?.path]);
  const hasOld = useMemo(() => (file?.oldContent ?? "").length > 0, [file?.oldContent]);
  const hasNew = useMemo(() => (file?.newContent ?? "").length > 0, [file?.newContent]);
  const diff = useMemo(() => {
    if (!file || (!hasOld && !hasNew)) return null;
    return computeSideBySide(file.oldContent ?? "", file.newContent ?? "");
  }, [file, hasOld, hasNew]);

  const oldHunks = useMemo(() => (diff ? findDiffHunkStarts(diff.oldLines) : []), [diff]);
  const newHunks = useMemo(() => (diff ? findDiffHunkStarts(diff.newLines) : []), [diff]);
  const hunkCount = useMemo(() => Math.max(oldHunks.length, newHunks.length), [oldHunks.length, newHunks.length]);

  /******************* FUNCTIONS ***********************/
  const handleOldScroll = useCallback(() => {
    if (syncing.current) return;
    syncing.current = true;
    if (oldScrollRef.current && newScrollRef.current) {
      newScrollRef.current.scrollTop = oldScrollRef.current.scrollTop;
      newScrollRef.current.scrollLeft = oldScrollRef.current.scrollLeft;
    }
    syncing.current = false;
  }, []);

  const handleNewScroll = useCallback(() => {
    if (syncing.current) return;
    syncing.current = true;
    if (oldScrollRef.current && newScrollRef.current) {
      oldScrollRef.current.scrollTop = newScrollRef.current.scrollTop;
      oldScrollRef.current.scrollLeft = newScrollRef.current.scrollLeft;
    }
    syncing.current = false;
  }, []);

  const goToHunk = useCallback(
    (idx: number) => {
      const clamped = Math.max(0, Math.min(idx, hunkCount - 1));
      setCurrentHunkIdx(clamped);
      syncing.current = true;
      if (oldHunks[clamped] !== undefined) {
        scrollToRowIndex(oldScrollRef.current, oldHunks[clamped]);
      }
      if (newHunks[clamped] !== undefined) {
        scrollToRowIndex(newScrollRef.current, newHunks[clamped]);
      }
      syncing.current = false;
    },
    [hunkCount, oldHunks, newHunks],
  );

  const goToPrevHunk = useCallback(() => {
    if (currentHunkIdx <= 0) {
      goToHunk(0); /* re-scroll to the first/only change */
    } else {
      goToHunk(currentHunkIdx - 1);
    }
  }, [currentHunkIdx, goToHunk]);

  const goToNextHunk = useCallback(() => {
    if (currentHunkIdx >= hunkCount - 1) {
      goToHunk(hunkCount - 1); /* re-scroll to the last/only change */
    } else {
      goToHunk(currentHunkIdx + 1);
    }
  }, [currentHunkIdx, hunkCount, goToHunk]);

  /* Text search in code */
  const textSearchMatches = useMemo(() => {
    if (!textSearch || textSearch.length < 2 || !diff) return [];
    const q = textSearch.toLowerCase();
    const matches: number[] = [];
    diff.newLines.forEach((line, i) => {
      if (line.text.toLowerCase().includes(q)) matches.push(i);
    });
    return matches;
  }, [textSearch, diff]);

  const handleTextSearch = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setTextSearch(e.target.value);
    setTextSearchIdx(0);
  }, []);

  const goToTextMatch = useCallback((idx: number) => {
    if (textSearchMatches.length === 0) return;
    const clamped = ((idx % textSearchMatches.length) + textSearchMatches.length) % textSearchMatches.length;
    setTextSearchIdx(clamped);
    scrollToRowIndex(newScrollRef.current, textSearchMatches[clamped]);
    syncing.current = true;
    scrollToRowIndex(oldScrollRef.current, textSearchMatches[clamped]);
    syncing.current = false;
  }, [textSearchMatches]);

  const handleTextSearchKey = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      goToTextMatch(e.shiftKey ? textSearchIdx - 1 : textSearchIdx + 1);
      e.preventDefault();
    }
  }, [goToTextMatch, textSearchIdx]);

  /******************* USEEFFECTS ***********************/
  const prevFileRef = useRef(file?.path);
  if (file?.path !== prevFileRef.current) {
    prevFileRef.current = file?.path;
    if (currentHunkIdx !== 0) {
      setCurrentHunkIdx(0);
    }
  }

  useEffect(() => {
    if (targetLine <= 0) return;
    const scrollContainerToRow = (container: HTMLDivElement | null, prefix: string): void => {
      if (!container) return;
      const row = container.querySelector(`tr[data-line="${prefix}-${targetLine}"]`) as HTMLElement | null;
      if (!row) return;
      const containerRect = container.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const currentScroll = container.scrollTop;
      const rowOffsetInContainer = rowRect.top - containerRect.top + currentScroll;
      container.scrollTop = Math.max(0, rowOffsetInContainer - containerRect.height / 2);
      row.style.outline = "2px solid #38bdf8";
      row.style.outlineOffset = "-2px";
      setTimeout(() => {
        row.style.outline = "";
        row.style.outlineOffset = "";
      }, 1500);
    };
    const timerId = setTimeout(() => {
      syncing.current = true;
      scrollContainerToRow(newScrollRef.current, "new");
      scrollContainerToRow(oldScrollRef.current, "old");
      syncing.current = false;
    }, 100);
    return () => clearTimeout(timerId);
  }, [targetLine, scrollTick]);

  if (!file) {
    return (
      <section className="codeDiffPanel">
        <p className="dimText">Select a file to see its diff.</p>
      </section>
    );
  }

  if (!diff) {
    return (
      <section className="codeDiffPanel">
        <h4 className="codeDiffTitle">{file.path}</h4>
        <p className="dimText">No textual diff available for this file.</p>
      </section>
    );
  }

  /* New file: only show new side */
  if (!hasOld && hasNew) {
    const lineCount = file.newContent.split("\n").length;
    return (
      <section className="codeDiffPanel">
        <h4 className="codeDiffTitle">{file.path} <span className="diffCount">{lineCount} lines added</span></h4>
        <div className="splitCodeLayout">
          <div className="codeColumn">
            <h5 className="codeColumnHeader oldHeader">Old</h5>
            <div className="codeScrollArea">
              <p className="dimText">File did not exist.</p>
            </div>
          </div>
          <div className="codeColumn">
            <h5 className="codeColumnHeader newHeader">New (entire file is new)</h5>
            <div className="codeScrollArea">
              <table className="diffTable">
                <tbody>
                  {file.newContent.split("\n").map((line, i) => (
                    <SimpleRow key={`new-${i}`} side="new" text={line} lineNum={i + 1} type="added" language={lang} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    );
  }

  /* Deleted file: only show old side */
  if (hasOld && !hasNew) {
    const lineCount = file.oldContent.split("\n").length;
    return (
      <section className="codeDiffPanel">
        <h4 className="codeDiffTitle">{file.path} <span className="diffCount">{lineCount} lines removed</span></h4>
        <div className="splitCodeLayout">
          <div className="codeColumn">
            <h5 className="codeColumnHeader oldHeader">Old (file was deleted)</h5>
            <div className="codeScrollArea">
              <table className="diffTable">
                <tbody>
                  {file.oldContent.split("\n").map((line, i) => (
                    <SimpleRow key={`old-${i}`} side="old" text={line} lineNum={i + 1} type="removed" language={lang} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="codeColumn">
            <h5 className="codeColumnHeader newHeader">New</h5>
            <div className="codeScrollArea">
              <p className="dimText">File was deleted.</p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="codeDiffPanel">
      <div className="diffNavBar">
        <h4 className="codeDiffTitle">{file.path}</h4>
        <div className="diffNavControls">
          <div className="searchBox">
            <input
              type="search"
              value={textSearch}
              onChange={handleTextSearch}
              onKeyDown={handleTextSearchKey}
              placeholder="Search code..."
              className="searchInput"
            />
            {textSearch.length > 0 && (
              <span className="searchInfo">
                {textSearchMatches.length > 0 ? `${textSearchIdx + 1}/${textSearchMatches.length}` : "0"}
                <button type="button" className="searchNavBtn" onClick={() => goToTextMatch(textSearchIdx - 1)} disabled={textSearchMatches.length === 0}>&#9650;</button>
                <button type="button" className="searchNavBtn" onClick={() => goToTextMatch(textSearchIdx + 1)} disabled={textSearchMatches.length === 0}>&#9660;</button>
              </span>
            )}
          </div>
          <span className="diffCount">{hunkCount} change{hunkCount !== 1 ? "s" : ""}</span>
          <button type="button" className="diffNavBtn" onClick={goToPrevHunk} disabled={hunkCount === 0} title="Previous change">
            &#9650;
          </button>
          <span className="diffNavPos">{hunkCount > 0 ? `${currentHunkIdx + 1}/${hunkCount}` : "0/0"}</span>
          <button type="button" className="diffNavBtn" onClick={goToNextHunk} disabled={hunkCount === 0} title="Next change">
            &#9660;
          </button>
        </div>
      </div>
      <div className="splitCodeLayout">
        <div className="codeColumn">
          <h5 className="codeColumnHeader oldHeader">Old</h5>
          <div className="codeScrollArea" ref={oldScrollRef} onScroll={handleOldScroll}>
            <table className="diffTable">
              <tbody>
                {diff.oldLines.map((line, i) => (
                  <DiffRow key={`old-${i}`} side="old" line={line} language={lang} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="codeColumn">
          <h5 className="codeColumnHeader newHeader">New</h5>
          <div className="codeScrollArea" ref={newScrollRef} onScroll={handleNewScroll}>
            <table className="diffTable">
              <tbody>
                {diff.newLines.map((line, i) => (
                  <DiffRow key={`new-${i}`} side="new" line={line} language={lang} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
};
