import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { observer, useLocalObservable } from "mobx-react-lite";
import { CodeDiffMatrixView } from "./codeDiff/CodeDiffMatrixView";
import { CodeDiffSingleFileView } from "./codeDiff/CodeDiffSingleFileView";
import { CodeDiffToolbar } from "./codeDiff/CodeDiffToolbar";
import {
  computeSideBySide,
  findDiffHunkStarts,
  langFromPath,
  scrollToRowIndex,
  clearPreviewSourceLine,
  scrollToPreviewSourceLine,
  scrollToSourceLine,
} from "./codeDiff/diffUtils";
import { CodeDiffDrawerStore } from "./codeDiff/store";
import type { DiffMatrixRow } from "./codeDiff/types";
import { useViewBaseRuntime } from "../views/viewBase/runtime";
import { hashFinalize, hashInit, hashString, lruSet } from "#/lib/memoHash";

const DIFF_CACHE_MAX_ENTRIES = 12;

const buildDiffSignature = (filePath: string, oldContent: string, newContent: string): string => {
  let hash = hashInit();
  hash = hashString(hash, filePath);
  hash = hashString(hash, oldContent);
  hash = hashString(hash, "\u0000");
  hash = hashString(hash, newContent);
  return `${hashFinalize(hash)}:${oldContent.length}:${newContent.length}`;
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
  } = state;
  const { onCodeLineClick, onCodeSearchStateChange } = actions;
  const store = useLocalObservable(() => new CodeDiffDrawerStore());
  const oldCodeScrollRef = useRef<HTMLDivElement>(null);
  const newCodeScrollRef = useRef<HTMLDivElement>(null);
  const syncingScrollRef = useRef(false);
  const pendingLineClickTimerRef = useRef<number | null>(null);
  const lastAppliedCodeSearchNavTickRef = useRef(0);
  const prevHoveredCodeLineRef = useRef(0);
  const diffCacheRef = useRef<Map<string, ReturnType<typeof computeSideBySide>>>(new Map());
  const SINGLE_CLICK_DELAY_MS = 450;

  const lang = useMemo(() => langFromPath(file?.path ?? ""), [file?.path]);
  const oldContent = file?.oldContent ?? "";
  const newContent = file?.newContent ?? "";
  const hasOld = useMemo(() => oldContent.length > 0, [oldContent]);
  const hasNew = useMemo(() => newContent.length > 0, [newContent]);
  const diffSignature = useMemo(
    () => buildDiffSignature(file?.path ?? "", oldContent, newContent),
    [file?.path, oldContent, newContent],
  );

  const diff = useMemo(() => {
    if (!file || (!hasOld && !hasNew)) return null;
    const cached = diffCacheRef.current.get(diffSignature);
    if (cached) return cached;
    const computed = computeSideBySide(oldContent, newContent);
    lruSet(diffCacheRef.current, diffSignature, computed, DIFF_CACHE_MAX_ENTRIES);
    return computed;
  }, [diffSignature, file, hasNew, hasOld, newContent, oldContent]);

  const matrixRows = useMemo<DiffMatrixRow[]>(
    () => (diff
      ? diff.oldLines.map((oldLine, idx) => ({
        old: oldLine,
        new: diff.newLines[idx] ?? { text: "", type: "empty", lineNumber: null },
      }))
      : []),
    [diff],
  );

  const hunkRows = useMemo(() => findDiffHunkStarts(matrixRows), [matrixRows]);
  const hunkCount = hunkRows.length;

  const textSearchMatches = useMemo(() => {
    if (!store.textSearch || store.textSearch.length < 2 || !diff) return [];
    const query = store.textSearch.toLowerCase();
    const matches: number[] = [];
    matrixRows.forEach((row, i) => {
      if (row.new.text.toLowerCase().includes(query) || row.old.text.toLowerCase().includes(query)) matches.push(i);
    });
    return matches;
  }, [store.textSearch, diff, matrixRows]);

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

  const goToTextMatch = useCallback((idx: number) => {
    if (textSearchMatches.length === 0) return;
    const clamped = ((idx % textSearchMatches.length) + textSearchMatches.length) % textSearchMatches.length;
    store.setTextSearchIdx(clamped);
    scrollToRowIndex(oldCodeScrollRef.current, textSearchMatches[clamped]);
  }, [textSearchMatches, store]);

  const handleTextSearchKey = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (store.textSearch.trim().length === 0) return;
    if (event.key === "Enter") {
      goToTextMatch(event.shiftKey ? store.textSearchIdx - 1 : store.textSearchIdx + 1);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === "ArrowDown") {
      goToTextMatch(store.textSearchIdx + 1);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === "ArrowUp") {
      goToTextMatch(store.textSearchIdx - 1);
      event.preventDefault();
      event.stopPropagation();
    }
  }, [goToTextMatch, store.textSearch, store.textSearchIdx]);

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

  const handleDeferredLineClick = useCallback((line: number, side: "old" | "new") => {
    if (pendingLineClickTimerRef.current !== null) {
      window.clearTimeout(pendingLineClickTimerRef.current);
      pendingLineClickTimerRef.current = null;
    }
    pendingLineClickTimerRef.current = window.setTimeout(() => {
      pendingLineClickTimerRef.current = null;
      onCodeLineClick(line, side);
    }, SINGLE_CLICK_DELAY_MS);
  }, [onCodeLineClick, SINGLE_CLICK_DELAY_MS]);

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
    const firstMatchIdx = matrixRows.findIndex(
      (row) => row.new.text.toLowerCase().includes(normalized) || row.old.text.toLowerCase().includes(normalized),
    );
    if (firstMatchIdx >= 0) {
      scrollToRowIndex(oldCodeScrollRef.current, firstMatchIdx);
    }
  }, [matrixRows, store]);

  useEffect(() => {
    store.resetHunkIdx();
    store.setTextSearch("");
  }, [file?.path, store]);

  useEffect(() => {
    onCodeSearchStateChange(store.textSearch.trim().length > 0);
  }, [onCodeSearchStateChange, store.textSearch]);

  useEffect(() => {
    if (targetLine <= 0) return;
    const timerId = window.setTimeout(() => {
      scrollToSourceLine(newCodeScrollRef.current, targetLine, targetSide);
      scrollToSourceLine(oldCodeScrollRef.current, targetLine, targetSide);
    }, 100);
    return () => window.clearTimeout(timerId);
  }, [targetLine, targetSide, scrollTick]);

  useEffect(() => {
    const prevHovered = prevHoveredCodeLineRef.current;
    if (hoveredCodeLine > 0) {
      scrollToPreviewSourceLine(newCodeScrollRef.current, hoveredCodeLine, hoveredCodeSide);
      scrollToPreviewSourceLine(oldCodeScrollRef.current, hoveredCodeLine, hoveredCodeSide);
      prevHoveredCodeLineRef.current = hoveredCodeLine;
      return;
    }
    clearPreviewSourceLine(newCodeScrollRef.current);
    clearPreviewSourceLine(oldCodeScrollRef.current);
    if (prevHovered > 0 && targetLine > 0) {
      scrollToSourceLine(newCodeScrollRef.current, targetLine, targetSide);
      scrollToSourceLine(oldCodeScrollRef.current, targetLine, targetSide);
    }
    prevHoveredCodeLineRef.current = hoveredCodeLine;
  }, [hoveredCodeLine, hoveredCodeSide, targetLine, targetSide]);

  useEffect(() => {
    if (!store.isFullscreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        store.setFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [store.isFullscreen, store]);

  useEffect(() => {
    if (codeSearchNavTick <= 0) return;
    if (codeSearchNavTick === lastAppliedCodeSearchNavTickRef.current) return;
    lastAppliedCodeSearchNavTickRef.current = codeSearchNavTick;
    if (codeSearchNavDirection === "next") {
      goToTextMatch(store.textSearchIdx + 1);
      return;
    }
    goToTextMatch(store.textSearchIdx - 1);
  }, [codeSearchNavDirection, codeSearchNavTick, goToTextMatch, store.textSearchIdx]);

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

  if (!file) {
    return (
      <section className={panelClassName}>
        <button type="button" className="codeDiffFullscreenBtn" onClick={store.toggleFullscreen} title={fullscreenTitle}>
          {fullscreenIcon}
        </button>
        <p className="dimText">Select a file to see its diff.</p>
      </section>
    );
  }

  if (!diff) {
    return (
      <section className={panelClassName}>
        <button type="button" className="codeDiffFullscreenBtn" onClick={store.toggleFullscreen} title={fullscreenTitle}>
          {fullscreenIcon}
        </button>
        <h4 className="codeDiffTitle">{file.path}</h4>
        <p className="dimText">No textual diff available for this file.</p>
      </section>
    );
  }

  if (!hasOld && hasNew) {
    return (
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
          oldCodeScrollRef={oldCodeScrollRef}
          newCodeScrollRef={newCodeScrollRef}
          onLineClick={handleDeferredLineClick}
          onLineDoubleClick={handleLineDoubleClick}
        />
      </section>
    );
  }

  if (hasOld && !hasNew) {
    return (
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
          oldCodeScrollRef={oldCodeScrollRef}
          newCodeScrollRef={newCodeScrollRef}
          onLineClick={handleDeferredLineClick}
          onLineDoubleClick={handleLineDoubleClick}
        />
      </section>
    );
  }

  return (
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
      />
      <CodeDiffMatrixView
        matrixRows={matrixRows}
        language={lang}
        searchQuery={store.textSearch}
        oldCodeScrollRef={oldCodeScrollRef}
        newCodeScrollRef={newCodeScrollRef}
        onOldScroll={handleOldScroll}
        onNewScroll={handleNewScroll}
        onLineClick={handleDeferredLineClick}
        onLineDoubleClick={handleLineDoubleClick}
      />
    </section>
  );
});
