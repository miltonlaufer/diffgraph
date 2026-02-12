import { useMemo, useCallback, useRef, useEffect, useState } from "react";
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
  const oldRaw = oldContent.split("\n");
  const newRaw = newContent.split("\n");
  const oldSet = new Set(oldRaw);
  const newSet = new Set(newRaw);
  const oldLines: DiffLine[] = [];
  const newLines: DiffLine[] = [];
  let oldIdx = 0;
  let newIdx = 0;

  while (oldIdx < oldRaw.length || newIdx < newRaw.length) {
    const oldLine = oldIdx < oldRaw.length ? oldRaw[oldIdx] : undefined;
    const newLine = newIdx < newRaw.length ? newRaw[newIdx] : undefined;

    if (oldLine !== undefined && newLine !== undefined && oldLine === newLine) {
      oldLines.push({ text: oldLine, type: "same", lineNumber: oldIdx + 1 });
      newLines.push({ text: newLine, type: "same", lineNumber: newIdx + 1 });
      oldIdx++;
      newIdx++;
    } else if (oldLine !== undefined && !newSet.has(oldLine)) {
      oldLines.push({ text: oldLine, type: "removed", lineNumber: oldIdx + 1 });
      newLines.push({ text: "", type: "empty", lineNumber: null });
      oldIdx++;
    } else if (newLine !== undefined && !oldSet.has(newLine)) {
      oldLines.push({ text: "", type: "empty", lineNumber: null });
      newLines.push({ text: newLine, type: "added", lineNumber: newIdx + 1 });
      newIdx++;
    } else {
      if (oldLine !== undefined) {
        oldLines.push({ text: oldLine, type: "removed", lineNumber: oldIdx + 1 });
        newLines.push({ text: "", type: "empty", lineNumber: null });
        oldIdx++;
      }
      if (newLine !== undefined) {
        oldLines.push({ text: "", type: "empty", lineNumber: null });
        newLines.push({ text: newLine, type: "added", lineNumber: newIdx + 1 });
        newIdx++;
      }
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
      return { background: "rgba(34, 197, 94, 0.15)" };
    case "removed":
      return { background: "rgba(239, 68, 68, 0.15)" };
    case "empty":
      return { background: "#0f172a" };
    default:
      return {};
  }
};

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

  /******************* COMPUTED ***********************/
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
    goToHunk(currentHunkIdx - 1);
  }, [currentHunkIdx, goToHunk]);

  const goToNextHunk = useCallback(() => {
    goToHunk(currentHunkIdx + 1);
  }, [currentHunkIdx, goToHunk]);

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
                    <tr key={`new-${i}`} data-line={`new-${i + 1}`} style={lineStyle("added")}>
                      <td className="lineNum">{i + 1}</td>
                      <td className="lineCode"><pre className="lineText">{line}</pre></td>
                    </tr>
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
                    <tr key={`old-${i}`} data-line={`old-${i + 1}`} style={lineStyle("removed")}>
                      <td className="lineNum">{i + 1}</td>
                      <td className="lineCode"><pre className="lineText">{line}</pre></td>
                    </tr>
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
          <span className="diffCount">{hunkCount} change{hunkCount !== 1 ? "s" : ""}</span>
          <button type="button" className="diffNavBtn" onClick={goToPrevHunk} disabled={currentHunkIdx <= 0} title="Previous change">
            &#9650;
          </button>
          <span className="diffNavPos">{hunkCount > 0 ? `${currentHunkIdx + 1}/${hunkCount}` : "0/0"}</span>
          <button type="button" className="diffNavBtn" onClick={goToNextHunk} disabled={currentHunkIdx >= hunkCount - 1} title="Next change">
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
                  <tr key={`old-${i}`} data-line={line.lineNumber ? `old-${line.lineNumber}` : undefined} style={lineStyle(line.type)}>
                    <td className="lineNum">{line.lineNumber ?? ""}</td>
                    <td className="lineCode"><pre className="lineText">{line.text}</pre></td>
                  </tr>
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
                  <tr key={`new-${i}`} data-line={line.lineNumber ? `new-${line.lineNumber}` : undefined} style={lineStyle(line.type)}>
                    <td className="lineNum">{line.lineNumber ?? ""}</td>
                    <td className="lineCode"><pre className="lineText">{line.text}</pre></td>
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
