import { useMemo, useCallback, useRef, useEffect, useState, memo, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
/* No external diff lib -- patience/LCS line diff */
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { FileDiffEntry } from "../types/graph";

interface CodeDiffDrawerProps {
  file: FileDiffEntry | null;
  targetLine: number;
  targetSide: "old" | "new";
  scrollTick: number;
}

interface DiffLine {
  text: string;
  type: "same" | "added" | "removed" | "empty";
  lineNumber: number | null;
}

interface DiffMatrixRow {
  old: DiffLine;
  new: DiffLine;
}

const computeSideBySide = (
  oldContent: string,
  newContent: string,
): { oldLines: DiffLine[]; newLines: DiffLine[] } => {
  const oldArr = oldContent.split("\n");
  const newArr = newContent.split("\n");
  const normalizeForCompare = (line: string): string => {
    const fullyTrimmed = line.trim();
    if (fullyTrimmed.length === 0) return "";
    return line.trimEnd();
  };
  const oldNorm = oldArr.map((line) => normalizeForCompare(line));
  const newNorm = newArr.map((line) => normalizeForCompare(line));

  const lcsWindow = (aStart: number, aEnd: number, bStart: number, bEnd: number): Array<[number, number]> => {
    const aLen = aEnd - aStart;
    const bLen = bEnd - bStart;
    if (aLen <= 0 || bLen <= 0) return [];
    const cellCount = aLen * bLen;
    /* Prevent pathological memory spikes on giant changed windows. */
    if (cellCount > 8_000_000) {
      const result: Array<[number, number]> = [];
      let j = bStart;
      for (let i = aStart; i < aEnd; i++) {
        while (j < bEnd && newNorm[j] !== oldNorm[i]) {
          j++;
        }
        if (j < bEnd) {
          result.push([i, j]);
          j++;
        }
      }
      return result;
    }
    const dp: number[][] = Array.from({ length: aLen + 1 }, () => Array(bLen + 1).fill(0) as number[]);
    for (let i = 1; i <= aLen; i++) {
      for (let j = 1; j <= bLen; j++) {
        if (oldNorm[aStart + i - 1] === newNorm[bStart + j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }
    let i = aLen;
    let j = bLen;
    const pairs: Array<[number, number]> = [];
    while (i > 0 && j > 0) {
      if (oldNorm[aStart + i - 1] === newNorm[bStart + j - 1]) {
        pairs.push([aStart + i - 1, bStart + j - 1]);
        i--;
        j--;
      } else if (dp[i - 1][j] >= dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }
    pairs.reverse();
    return pairs;
  };

  const lisPairs = (pairs: Array<[number, number]>): Array<[number, number]> => {
    if (pairs.length === 0) return [];
    const n = pairs.length;
    const predecessors = new Array<number>(n).fill(-1);
    const tails: number[] = [];
    for (let i = 0; i < n; i++) {
      const jVal = pairs[i][1];
      let lo = 0;
      let hi = tails.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (pairs[tails[mid]][1] < jVal) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
      }
      if (lo > 0) predecessors[i] = tails[lo - 1];
      if (lo === tails.length) tails.push(i);
      else tails[lo] = i;
    }
    let k = tails[tails.length - 1] ?? -1;
    const seq: Array<[number, number]> = [];
    while (k !== -1) {
      seq.push(pairs[k]);
      k = predecessors[k];
    }
    seq.reverse();
    return seq;
  };

  const patienceDiff = (aStart: number, aEnd: number, bStart: number, bEnd: number): Array<[number, number]> => {
    if (aStart >= aEnd || bStart >= bEnd) return [];
    const oldCounts = new Map<string, number>();
    const newCounts = new Map<string, number>();
    const oldPos = new Map<string, number>();
    const newPos = new Map<string, number>();
    for (let i = aStart; i < aEnd; i++) {
      const key = oldNorm[i];
      oldCounts.set(key, (oldCounts.get(key) ?? 0) + 1);
      oldPos.set(key, i);
    }
    for (let j = bStart; j < bEnd; j++) {
      const key = newNorm[j];
      newCounts.set(key, (newCounts.get(key) ?? 0) + 1);
      newPos.set(key, j);
    }
    const uniquePairs: Array<[number, number]> = [];
    for (let i = aStart; i < aEnd; i++) {
      const key = oldNorm[i];
      if ((oldCounts.get(key) ?? 0) === 1 && (newCounts.get(key) ?? 0) === 1) {
        const j = newPos.get(key);
        if (j !== undefined) uniquePairs.push([i, j]);
      }
    }
    uniquePairs.sort((a, b) => a[0] - b[0]);
    const anchors = lisPairs(uniquePairs);
    if (anchors.length === 0) {
      return lcsWindow(aStart, aEnd, bStart, bEnd);
    }

    const result: Array<[number, number]> = [];
    let prevA = aStart;
    let prevB = bStart;
    for (const [aIdx, bIdx] of anchors) {
      result.push(...patienceDiff(prevA, aIdx, prevB, bIdx));
      result.push([aIdx, bIdx]);
      prevA = aIdx + 1;
      prevB = bIdx + 1;
    }
    result.push(...patienceDiff(prevA, aEnd, prevB, bEnd));
    return result;
  };

  const lcsIndices = patienceDiff(0, oldArr.length, 0, newArr.length);

  /* Build side-by-side from LCS matches */
  const oldLines: DiffLine[] = [];
  const newLines: DiffLine[] = [];
  let oi = 0;
  let ni = 0;

  for (const [matchOld, matchNew] of lcsIndices) {
    /* Emit removed lines before this match */
    while (oi < matchOld) {
      oldLines.push({ text: oldArr[oi], type: "removed", lineNumber: oi + 1 });
      newLines.push({ text: "", type: "empty", lineNumber: null });
      oi++;
    }
    /* Emit added lines before this match */
    while (ni < matchNew) {
      oldLines.push({ text: "", type: "empty", lineNumber: null });
      newLines.push({ text: newArr[ni], type: "added", lineNumber: ni + 1 });
      ni++;
    }
    /* Emit the matched line */
    oldLines.push({ text: oldArr[oi], type: "same", lineNumber: oi + 1 });
    newLines.push({ text: newArr[ni], type: "same", lineNumber: ni + 1 });
    oi++;
    ni++;
  }

  /* Remaining removed */
  while (oi < oldArr.length) {
    oldLines.push({ text: oldArr[oi], type: "removed", lineNumber: oi + 1 });
    newLines.push({ text: "", type: "empty", lineNumber: null });
    oi++;
  }
  /* Remaining added */
  while (ni < newArr.length) {
    oldLines.push({ text: "", type: "empty", lineNumber: null });
    newLines.push({ text: newArr[ni], type: "added", lineNumber: ni + 1 });
    ni++;
  }
  return { oldLines, newLines };
};

/** Find row indices where diff hunks start (groups of consecutive changed rows). */
const findDiffHunkStarts = (rows: DiffMatrixRow[]): number[] => {
  const starts: number[] = [];
  let inHunk = false;
  for (let i = 0; i < rows.length; i++) {
    const isChanged = rows[i].old.type !== "same" || rows[i].new.type !== "same";
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

const emptyLineStyle: React.CSSProperties = {
  display: "inline-block",
  minHeight: "1.5em",
  whiteSpace: "pre",
  width: "1px",
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

export const CodeDiffDrawer = ({ file, targetLine, targetSide, scrollTick }: CodeDiffDrawerProps) => {
  /******************* STORE ***********************/
  const oldCodeScrollRef = useRef<HTMLDivElement>(null);
  const newCodeScrollRef = useRef<HTMLDivElement>(null);
  const syncingScrollRef = useRef(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
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

  const matrixRows = useMemo<DiffMatrixRow[]>(
    () =>
      diff
        ? diff.oldLines.map((oldLine, idx) => ({
            old: oldLine,
            new: diff.newLines[idx] ?? { text: "", type: "empty", lineNumber: null },
          }))
        : [],
    [diff],
  );

  const hunkRows = useMemo(() => findDiffHunkStarts(matrixRows), [matrixRows]);
  const hunkCount = useMemo(() => hunkRows.length, [hunkRows.length]);

  /******************* FUNCTIONS ***********************/
  const goToHunk = useCallback(
    (idx: number) => {
      const clamped = Math.max(0, Math.min(idx, hunkCount - 1));
      setCurrentHunkIdx(clamped);
      if (hunkRows[clamped] !== undefined) {
        scrollToRowIndex(oldCodeScrollRef.current, hunkRows[clamped]);
      }
    },
    [hunkCount, hunkRows],
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
    matrixRows.forEach((row, i) => {
      if (row.new.text.toLowerCase().includes(q)) matches.push(i);
    });
    return matches;
  }, [textSearch, diff, matrixRows]);

  const handleTextSearch = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setTextSearch(e.target.value);
    setTextSearchIdx(0);
  }, []);

  const goToTextMatch = useCallback((idx: number) => {
    if (textSearchMatches.length === 0) return;
    const clamped = ((idx % textSearchMatches.length) + textSearchMatches.length) % textSearchMatches.length;
    setTextSearchIdx(clamped);
    scrollToRowIndex(oldCodeScrollRef.current, textSearchMatches[clamped]);
  }, [textSearchMatches]);

  const handleTextSearchKey = useCallback((e: ReactKeyboardEvent<HTMLInputElement>) => {
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
    const scrollContainerToRow = (container: HTMLDivElement | null): void => {
      if (!container) return;
      const preferredSelector = targetSide === "old" ? `tr[data-old-line="${targetLine}"]` : `tr[data-new-line="${targetLine}"]`;
      const fallbackSelector = targetSide === "old" ? `tr[data-new-line="${targetLine}"]` : `tr[data-old-line="${targetLine}"]`;
      const row =
        (container.querySelector(preferredSelector) as HTMLElement | null) ??
        (container.querySelector(fallbackSelector) as HTMLElement | null);
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
      scrollContainerToRow(newCodeScrollRef.current);
      scrollContainerToRow(oldCodeScrollRef.current);
    }, 100);
    return () => clearTimeout(timerId);
  }, [targetLine, targetSide, scrollTick]);

  const syncVerticalScroll = useCallback((source: HTMLDivElement | null, target: HTMLDivElement | null) => {
    if (!source || !target) return;
    if (syncingScrollRef.current) return;
    syncingScrollRef.current = true;
    target.scrollTop = source.scrollTop;
    requestAnimationFrame(() => {
      syncingScrollRef.current = false;
    });
  }, []);

  const handleOldScroll = useCallback(() => {
    syncVerticalScroll(oldCodeScrollRef.current, newCodeScrollRef.current);
  }, [syncVerticalScroll]);

  const handleNewScroll = useCallback(() => {
    syncVerticalScroll(newCodeScrollRef.current, oldCodeScrollRef.current);
  }, [syncVerticalScroll]);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  /******************* USEEFFECTS ***********************/
  useEffect(() => {
    if (!isFullscreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isFullscreen]);

  const panelClassName = isFullscreen ? "codeDiffPanel codeDiffPanelFullscreen" : "codeDiffPanel";
  const fullscreenTitle = isFullscreen ? "Exit full screen" : "Full screen";
  const fullscreenIcon = isFullscreen ? "\u2921" : "\u2922";

  if (!file) {
    return (
      <section className={panelClassName}>
        <button type="button" className="codeDiffFullscreenBtn" onClick={toggleFullscreen} title={fullscreenTitle}>
          {fullscreenIcon}
        </button>
        <p className="dimText">Select a file to see its diff.</p>
      </section>
    );
  }

  if (!diff) {
    return (
      <section className={panelClassName}>
        <button type="button" className="codeDiffFullscreenBtn" onClick={toggleFullscreen} title={fullscreenTitle}>
          {fullscreenIcon}
        </button>
        <h4 className="codeDiffTitle">{file.path}</h4>
        <p className="dimText">No textual diff available for this file.</p>
      </section>
    );
  }

  /* New file: only show new side */
  if (!hasOld && hasNew) {
    const lineCount = file.newContent.split("\n").length;
    return (
      <section className={panelClassName}>
        <button type="button" className="codeDiffFullscreenBtn" onClick={toggleFullscreen} title={fullscreenTitle}>
          {fullscreenIcon}
        </button>
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
      <section className={panelClassName}>
        <button type="button" className="codeDiffFullscreenBtn" onClick={toggleFullscreen} title={fullscreenTitle}>
          {fullscreenIcon}
        </button>
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
    <section className={panelClassName}>
      <button type="button" className="codeDiffFullscreenBtn" onClick={toggleFullscreen} title={fullscreenTitle}>
        {fullscreenIcon}
      </button>
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
          <div className="codeScrollArea" ref={oldCodeScrollRef} onScroll={handleOldScroll}>
            <table className="diffTable">
              <tbody>
                {matrixRows.map((row, i) => (
                  <tr
                    key={`old-row-${i}`}
                    data-old-line={row.old.lineNumber ?? undefined}
                    data-new-line={row.new.lineNumber ?? undefined}
                  >
                    <td className="lineNum" style={lineStyle(row.old.type)}>{row.old.lineNumber ?? ""}</td>
                    <td className="lineCode" style={lineStyle(row.old.type)}>
                      {row.old.type === "empty" ? <span style={emptyLineStyle}>&nbsp;</span> : <HighlightedCode code={row.old.text} language={lang} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="codeColumn">
          <h5 className="codeColumnHeader newHeader">New</h5>
          <div className="codeScrollArea" ref={newCodeScrollRef} onScroll={handleNewScroll}>
            <table className="diffTable">
              <tbody>
                {matrixRows.map((row, i) => (
                  <tr
                    key={`new-row-${i}`}
                    data-old-line={row.old.lineNumber ?? undefined}
                    data-new-line={row.new.lineNumber ?? undefined}
                  >
                    <td className="lineNum" style={lineStyle(row.new.type)}>{row.new.lineNumber ?? ""}</td>
                    <td className="lineCode" style={lineStyle(row.new.type)}>
                      {row.new.type === "empty" ? <span style={emptyLineStyle}>&nbsp;</span> : <HighlightedCode code={row.new.text} language={lang} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
};
