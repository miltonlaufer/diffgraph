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
  scrollToSourceLine,
} from "./codeDiff/diffUtils";
import { CodeDiffDrawerStore } from "./codeDiff/store";
import type { DiffMatrixRow } from "./codeDiff/types";
import { useViewBaseRuntime } from "../views/viewBase/runtime";

export const CodeDiffDrawer = observer(() => {
  const { state, actions } = useViewBaseRuntime();
  const { selectedFile: file, targetLine, targetSide, scrollTick } = state;
  const { onCodeLineClick } = actions;
  const store = useLocalObservable(() => new CodeDiffDrawerStore());
  const oldCodeScrollRef = useRef<HTMLDivElement>(null);
  const newCodeScrollRef = useRef<HTMLDivElement>(null);
  const syncingScrollRef = useRef(false);

  const lang = useMemo(() => langFromPath(file?.path ?? ""), [file?.path]);
  const hasOld = useMemo(() => (file?.oldContent ?? "").length > 0, [file?.oldContent]);
  const hasNew = useMemo(() => (file?.newContent ?? "").length > 0, [file?.newContent]);

  const diff = useMemo(() => {
    if (!file || (!hasOld && !hasNew)) return null;
    return computeSideBySide(file.oldContent ?? "", file.newContent ?? "");
  }, [file, hasOld, hasNew]);

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
      if (row.new.text.toLowerCase().includes(query)) matches.push(i);
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
    if (event.key === "Enter") {
      goToTextMatch(event.shiftKey ? store.textSearchIdx - 1 : store.textSearchIdx + 1);
      event.preventDefault();
    }
  }, [goToTextMatch, store.textSearchIdx]);

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

  useEffect(() => {
    store.resetHunkIdx();
  }, [file?.path, store]);

  useEffect(() => {
    if (targetLine <= 0) return;
    const timerId = window.setTimeout(() => {
      scrollToSourceLine(newCodeScrollRef.current, targetLine, targetSide);
      scrollToSourceLine(oldCodeScrollRef.current, targetLine, targetSide);
    }, 100);
    return () => window.clearTimeout(timerId);
  }, [targetLine, targetSide, scrollTick]);

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
          oldCodeScrollRef={oldCodeScrollRef}
          newCodeScrollRef={newCodeScrollRef}
          onLineClick={onCodeLineClick}
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
          oldCodeScrollRef={oldCodeScrollRef}
          newCodeScrollRef={newCodeScrollRef}
          onLineClick={onCodeLineClick}
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
        oldCodeScrollRef={oldCodeScrollRef}
        newCodeScrollRef={newCodeScrollRef}
        onOldScroll={handleOldScroll}
        onNewScroll={handleNewScroll}
        onLineClick={onCodeLineClick}
      />
    </section>
  );
});
