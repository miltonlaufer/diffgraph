import { useCallback, useEffect, useMemo, useRef, type ChangeEvent, type ReactNode } from "react";
import { observer } from "mobx-react-lite";
import { CodeDiffMatrixView } from "./codeDiff/CodeDiffMatrixView";
import { CodeDiffSingleFileView } from "./codeDiff/CodeDiffSingleFileView";
import { CodeDiffToolbar } from "./codeDiff/CodeDiffToolbar";
import FullscreenModal from "./FullscreenModal";
import {
  computeSideBySide,
  findDiffHunkStarts,
  langFromPath,
  scrollToRowIndex,
} from "./codeDiff/diffUtils";
import { CodeDiffDrawerStore } from "./codeDiff/store";
import { useCodeDiffScroll } from "./codeDiff/useCodeDiffScroll";
import { useCodeDiffSearch } from "./codeDiff/useCodeDiffSearch";
import { useCodeLogicTreeMode } from "./codeDiff/useCodeLogicTreeMode";
import type { DiffMatrixRow } from "./codeDiff/types";
import { useViewBaseRuntime } from "../views/viewBase/runtime";
import { createCachedComputation } from "#/lib/cachedComputation";
import { hashFinalize, hashInit, hashString } from "#/lib/memoHash";
import { useDebouncedValue } from "./useDebouncedValue";

const DIFF_CACHE_MAX_ENTRIES = 12;

interface DiffComputationInput {
  filePath: string;
  oldContent: string;
  newContent: string;
}

const buildDiffSignature = ({ filePath, oldContent, newContent }: DiffComputationInput): string => {
  let hash = hashInit();
  hash = hashString(hash, filePath);
  hash = hashString(hash, oldContent);
  hash = hashString(hash, "\u0000");
  hash = hashString(hash, newContent);
  return `${hashFinalize(hash)}:${oldContent.length}:${newContent.length}`;
};

const diffComputation = createCachedComputation<DiffComputationInput, ReturnType<typeof computeSideBySide>>({
  maxEntries: DIFF_CACHE_MAX_ENTRIES,
  buildSignature: buildDiffSignature,
  compute: ({ oldContent, newContent }) => computeSideBySide(oldContent, newContent),
});

const GAP_MARKER_TEXT = "...";

const buildGapMarkerRow = (): DiffMatrixRow => ({
  old: { text: GAP_MARKER_TEXT, type: "same", lineNumber: null },
  new: { text: GAP_MARKER_TEXT, type: "same", lineNumber: null },
});

const insertGapRows = (
  rows: DiffMatrixRow[],
  side: "old" | "new",
): DiffMatrixRow[] => {
  if (rows.length <= 1) return rows;
  const withGaps: DiffMatrixRow[] = [];
  let prevLine: number | null = null;
  for (const row of rows) {
    const currentLine = side === "old" ? row.old.lineNumber : row.new.lineNumber;
    if (prevLine !== null && currentLine !== null && currentLine - prevLine > 1) {
      withGaps.push(buildGapMarkerRow());
    }
    withGaps.push(row);
    if (currentLine !== null) {
      prevLine = currentLine;
    }
  }
  return withGaps;
};

export const CodeDiffDrawer = observer(() => {
  const { state, actions } = useViewBaseRuntime();
  const {
    selectedFile: file,
    hoveredCodeLine,
    hoveredCodeSide,
    targetLine,
    targetSide,
    scrollTick,
    codeSearchNavDirection,
    codeSearchNavTick,
    codeLogicTreeRequestTick,
    codeLogicTreeRequestSide,
    codeLogicTreeRequestLines,
  } = state;
  const { onCodeLineClick, onCodeSearchStateChange } = actions;
  const store = useMemo(() => CodeDiffDrawerStore.create({}), []);
  const oldCodeScrollRef = useRef<HTMLDivElement>(null);
  const newCodeScrollRef = useRef<HTMLDivElement>(null);
  const pendingLineClickTimerRef = useRef<number | null>(null);
  const SINGLE_CLICK_DELAY_MS = 450;

  const lang = useMemo(() => langFromPath(file?.path ?? ""), [file?.path]);
  const oldContent = file?.oldContent ?? "";
  const newContent = file?.newContent ?? "";
  const hasOld = useMemo(() => oldContent.length > 0, [oldContent]);
  const hasNew = useMemo(() => newContent.length > 0, [newContent]);
  const diff = useMemo(() => {
    if (!file || (!hasOld && !hasNew)) return null;
    return diffComputation.run({
      filePath: file.path ?? "",
      oldContent,
      newContent,
    });
  }, [file, hasNew, hasOld, newContent, oldContent]);
  const debouncedTextSearch = useDebouncedValue(store.textSearch, 200);

  const matrixRows = useMemo<DiffMatrixRow[]>(
    () => (diff
      ? diff.oldLines.map((oldLine, idx) => ({
        old: oldLine,
        new: diff.newLines[idx] ?? { text: "", type: "empty", lineNumber: null },
      }))
      : []),
    [diff],
  );
  const codeLogicTreeLineSet = useMemo(
    () => (store.codeLogicTreeMode ? new Set(store.codeLogicTreeLines) : null),
    [store.codeLogicTreeLines, store.codeLogicTreeMode],
  );
  const visibleMatrixRows = useMemo<DiffMatrixRow[]>(() => {
    if (!store.codeLogicTreeMode || !codeLogicTreeLineSet) return matrixRows;
    const filterSide = store.codeLogicTreeSide;
    const filteredRows = matrixRows.filter((row) => {
      const lineNumber = filterSide === "old" ? row.old.lineNumber : row.new.lineNumber;
      return lineNumber !== null && codeLogicTreeLineSet.has(lineNumber);
    });
    return insertGapRows(filteredRows, filterSide as "old" | "new");
  }, [codeLogicTreeLineSet, matrixRows, store.codeLogicTreeMode, store.codeLogicTreeSide]);

  const hunkRows = useMemo(() => findDiffHunkStarts(visibleMatrixRows), [visibleMatrixRows]);
  const hunkCount = hunkRows.length;

  const textSearchMatches = useMemo(() => {
    if (!debouncedTextSearch || debouncedTextSearch.length < 2 || !diff) return [];
    const query = debouncedTextSearch.toLowerCase();
    const matches: number[] = [];
    visibleMatrixRows.forEach((row, i) => {
      if (row.new.text.toLowerCase().includes(query) || row.old.text.toLowerCase().includes(query)) matches.push(i);
    });
    return matches;
  }, [debouncedTextSearch, diff, visibleMatrixRows]);

  const goToHunk = useCallback(
    (idx: number) => {
      const clamped = Math.max(0, Math.min(idx, hunkCount - 1));
      store.setCurrentHunkIdx(clamped);
      if (hunkRows[clamped] !== undefined) {
        scrollToRowIndex(oldCodeScrollRef.current, hunkRows[clamped]);
      }
    },
    [hunkCount, hunkRows, store],
  );

  const goToPrevHunk = useCallback(() => {
    if (store.currentHunkIdx <= 0) {
      goToHunk(0);
    } else {
      goToHunk(store.currentHunkIdx - 1);
    }
  }, [store.currentHunkIdx, goToHunk]);

  const goToNextHunk = useCallback(() => {
    if (store.currentHunkIdx >= hunkCount - 1) {
      goToHunk(hunkCount - 1);
    } else {
      goToHunk(store.currentHunkIdx + 1);
    }
  }, [store.currentHunkIdx, hunkCount, goToHunk]);

  const handleTextSearch = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    store.setTextSearch(event.target.value);
  }, [store]);

  const { handleOldScroll, handleNewScroll } = useCodeDiffScroll({
    oldCodeScrollRef,
    newCodeScrollRef,
    targetLine,
    targetSide,
    scrollTick,
    hoveredCodeLine,
    hoveredCodeSide,
  });

  const { goToTextMatch, handleTextSearchKey } = useCodeDiffSearch({
    store,
    textSearchMatches,
    oldCodeScrollRef,
    codeSearchNavDirection,
    codeSearchNavTick,
  });

  useCodeLogicTreeMode({
    store,
    codeLogicTreeRequestTick,
    codeLogicTreeRequestSide,
    codeLogicTreeRequestLines,
  });

  const handleDeferredLineClick = useCallback((line: number, side: "old" | "new") => {
    if (pendingLineClickTimerRef.current !== null) {
      window.clearTimeout(pendingLineClickTimerRef.current);
      pendingLineClickTimerRef.current = null;
    }
    pendingLineClickTimerRef.current = window.setTimeout(() => {
      pendingLineClickTimerRef.current = null;
      onCodeLineClick(line, side);
      if (store.isFullscreen) {
        store.setFullscreen(false);
      }
    }, SINGLE_CLICK_DELAY_MS);
  }, [onCodeLineClick, SINGLE_CLICK_DELAY_MS, store]);

  const handleLineDoubleClick = useCallback((_line: number, _side: "old" | "new", word: string) => {
    if (pendingLineClickTimerRef.current !== null) {
      window.clearTimeout(pendingLineClickTimerRef.current);
      pendingLineClickTimerRef.current = null;
    }
    const query = word.trim();
    if (!query) return;
    store.setTextSearch(query);
    store.setTextSearchIdx(0);

    const normalized = query.toLowerCase();
    const firstMatchIdx = visibleMatrixRows.findIndex(
      (row) => row.new.text.toLowerCase().includes(normalized) || row.old.text.toLowerCase().includes(normalized),
    );
    if (firstMatchIdx >= 0) {
      scrollToRowIndex(oldCodeScrollRef.current, firstMatchIdx);
    }
  }, [store, visibleMatrixRows]);

  useEffect(() => {
    store.resetHunkIdx();
    store.setTextSearch("");
  }, [file?.path, store]);

  useEffect(() => {
    onCodeSearchStateChange(store.textSearch.trim().length > 0);
  }, [onCodeSearchStateChange, store.textSearch]);

  useEffect(() => () => {
    onCodeSearchStateChange(false);
    if (pendingLineClickTimerRef.current !== null) {
      window.clearTimeout(pendingLineClickTimerRef.current);
      pendingLineClickTimerRef.current = null;
    }
  }, [onCodeSearchStateChange]);

  const panelClassName = store.isFullscreen ? "codeDiffPanel codeDiffPanelFullscreen" : "codeDiffPanel";
  const fullscreenTitle = store.isFullscreen ? "Exit full screen" : "Full screen";
  const fullscreenIcon = store.isFullscreen ? "\u2921" : "\u2922";
  const renderPanel = (content: ReactNode) => {
    if (!store.isFullscreen) return content;
    return (
      <FullscreenModal
        open
        onClose={() => store.setFullscreen(false)}
        ariaLabel="Code viewer"
        className="fullscreenModalSurfaceCodeDiff"
      >
        {content}
      </FullscreenModal>
    );
  };

  if (!file) {
    return renderPanel(
      <section className={panelClassName}>
        <button type="button" className="codeDiffFullscreenBtn" onClick={store.toggleFullscreen} title={fullscreenTitle}>
          {fullscreenIcon}
        </button>
        <p className="dimText">Select a file or a node to see its code dff.</p>
      </section>,
    );
  }

  if (!diff) {
    return renderPanel(
      <section className={panelClassName}>
        <button type="button" className="codeDiffFullscreenBtn" onClick={store.toggleFullscreen} title={fullscreenTitle}>
          {fullscreenIcon}
        </button>
        <h4 className="codeDiffTitle">{file.path}</h4>
        <p className="dimText">No textual diff available for this file.</p>
      </section>,
    );
  }

  if (!hasOld && hasNew) {
    return renderPanel(
      <section className={panelClassName}>
        <button type="button" className="codeDiffFullscreenBtn" onClick={store.toggleFullscreen} title={fullscreenTitle}>
          {fullscreenIcon}
        </button>
        <CodeDiffSingleFileView
          mode="added"
          filePath={file.path}
          content={file.newContent}
          language={lang}
          searchQuery={store.textSearch}
          visibleLineNumbers={
            store.codeLogicTreeMode && store.codeLogicTreeSide === "new"
              ? codeLogicTreeLineSet
              : null
          }
          oldCodeScrollRef={oldCodeScrollRef}
          newCodeScrollRef={newCodeScrollRef}
          onLineClick={handleDeferredLineClick}
          onLineDoubleClick={handleLineDoubleClick}
        />
      </section>,
    );
  }

  if (hasOld && !hasNew) {
    return renderPanel(
      <section className={panelClassName}>
        <button type="button" className="codeDiffFullscreenBtn" onClick={store.toggleFullscreen} title={fullscreenTitle}>
          {fullscreenIcon}
        </button>
        <CodeDiffSingleFileView
          mode="removed"
          filePath={file.path}
          content={file.oldContent}
          language={lang}
          searchQuery={store.textSearch}
          visibleLineNumbers={
            store.codeLogicTreeMode && store.codeLogicTreeSide === "old"
              ? codeLogicTreeLineSet
              : null
          }
          oldCodeScrollRef={oldCodeScrollRef}
          newCodeScrollRef={newCodeScrollRef}
          onLineClick={handleDeferredLineClick}
          onLineDoubleClick={handleLineDoubleClick}
        />
      </section>,
    );
  }

  return renderPanel(
    <section className={panelClassName}>
      <button type="button" className="codeDiffFullscreenBtn" onClick={store.toggleFullscreen} title={fullscreenTitle}>
        {fullscreenIcon}
      </button>
      <CodeDiffToolbar
        filePath={file.path}
        textSearch={store.textSearch}
        textSearchIdx={store.textSearchIdx}
        textSearchMatchesCount={textSearchMatches.length}
        hunkCount={hunkCount}
        currentHunkIdx={store.currentHunkIdx}
        onTextSearchChange={handleTextSearch}
        onTextSearchKeyDown={handleTextSearchKey}
        onPrevTextMatch={() => goToTextMatch(store.textSearchIdx - 1)}
        onNextTextMatch={() => goToTextMatch(store.textSearchIdx + 1)}
        onPrevHunk={goToPrevHunk}
        onNextHunk={goToNextHunk}
        showChangeNavigation={!store.codeLogicTreeMode}
      />
      {store.codeLogicTreeMode && visibleMatrixRows.length === 0 ? (
        <p className="dimText">No matching logic-tree lines for this file.</p>
      ) : (
        <CodeDiffMatrixView
          matrixRows={visibleMatrixRows}
          language={lang}
          searchQuery={store.textSearch}
          oldCodeScrollRef={oldCodeScrollRef}
          newCodeScrollRef={newCodeScrollRef}
          onOldScroll={handleOldScroll}
          onNewScroll={handleNewScroll}
          onLineClick={handleDeferredLineClick}
          onLineDoubleClick={handleLineDoubleClick}
        />
      )}
    </section>,
  );
});
