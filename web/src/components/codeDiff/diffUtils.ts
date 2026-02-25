import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import type { DiffLine, DiffMatrixRow } from "./types";

const GRAPH_SELECTED_ROW_CLASS = "lineSelectedFromGraph";
const GRAPH_PREVIEW_ROW_CLASS = "linePreviewFromGraphHover";

const clearRowHighlightClass = (container: HTMLDivElement | null, className: string): void => {
  if (!container) return;
  container.querySelectorAll(`tr.${className}`).forEach((candidate) => {
    candidate.classList.remove(className);
  });
};

export const computeSideBySide = (
  oldContent: string,
  newContent: string,
): { oldLines: DiffLine[]; newLines: DiffLine[] } => {
  const oldArr = oldContent.split("\n");
  const newArr = newContent.split("\n");
  const compactLine = (line: string): string => {
    const compact = line.replace(/\s+/g, "");
    return compact.length === 0 ? "" : compact;
  };
  const normalizeWrappedPythonHeader = (value: string): string =>
    value.replace(/^(if|elif|while)\((.*)\):$/, "$1$2:");
  const normalizeLinesForCompare = (
    lines: string[],
  ): { normalized: string[]; isBlankLine: boolean[]; isNeutralizedLine: boolean[] } => {
    const compacted = lines.map(compactLine);
    const normalized = [...compacted];
    const isBlankLine = compacted.map((line) => line.length === 0);
    const isNeutralizedLine = new Array(lines.length).fill(false);

    for (let i = 0; i < compacted.length; i += 1) {
      const current = compacted[i];
      if (!current) {
        normalized[i] = "";
        continue;
      }

      const wrappedHeaderMatch = current.match(/^(if|elif|while)\($/);
      if (!wrappedHeaderMatch) {
        normalized[i] = normalizeWrappedPythonHeader(current);
        continue;
      }

      const keyword = wrappedHeaderMatch[1];
      let depth = 1;
      let j = i;
      const pieces: string[] = [];

      while (j + 1 < compacted.length) {
        j += 1;
        const piece = compacted[j];
        if (!piece) continue;
        pieces.push(piece);

        for (const char of piece) {
          if (char === "(") depth += 1;
          if (char === ")") depth -= 1;
        }
        if (depth <= 0) break;
      }

      if (depth <= 0) {
        normalized[i] = normalizeWrappedPythonHeader(`${keyword}(${pieces.join("")}`);
        for (let k = i + 1; k <= j; k += 1) {
          normalized[k] = `__dg_wrap_cont__${compacted[k] ?? ""}`;
          isNeutralizedLine[k] = true;
        }
        i = j;
        continue;
      }

      normalized[i] = normalizeWrappedPythonHeader(current);
    }

    for (let i = 0; i < compacted.length; i += 1) {
      if (isBlankLine[i]) continue;
      const current = compacted[i] ?? "";
      const open = (current.match(/\(/g) ?? []).length;
      const close = (current.match(/\)/g) ?? []).length;
      if (open <= close || !current.endsWith("(")) continue;

      let depth = open - close;
      let j = i;
      const pieces: string[] = [current];
      while (j + 1 < compacted.length && depth > 0) {
        j += 1;
        const piece = compacted[j] ?? "";
        pieces.push(piece);
        depth += (piece.match(/\(/g) ?? []).length;
        depth -= (piece.match(/\)/g) ?? []).length;
      }
      if (depth > 0 || j <= i) continue;

      normalized[i] = normalizeWrappedPythonHeader(pieces.join(""));
      for (let k = i + 1; k <= j; k += 1) {
        normalized[k] = `__dg_wrap_cont__${compacted[k] ?? ""}`;
        isNeutralizedLine[k] = true;
      }
      i = j;
    }

    return { normalized, isBlankLine, isNeutralizedLine };
  };
  const oldNormalized = normalizeLinesForCompare(oldArr);
  const newNormalized = normalizeLinesForCompare(newArr);
  const oldNorm = oldNormalized.normalized;
  const newNorm = newNormalized.normalized;
  const oldIsBlankLine = oldNormalized.isBlankLine;
  const newIsBlankLine = newNormalized.isBlankLine;
  const oldIsNeutralizedLine = oldNormalized.isNeutralizedLine;
  const newIsNeutralizedLine = newNormalized.isNeutralizedLine;

  const pushNeutralOldLine = (oldIndex: number): void => {
    oldLines.push({ text: oldArr[oldIndex], type: "same", lineNumber: oldIndex + 1 });
    newLines.push({ text: "", type: "same", lineNumber: null });
  };
  const pushNeutralNewLine = (newIndex: number): void => {
    oldLines.push({ text: "", type: "same", lineNumber: null });
    newLines.push({ text: newArr[newIndex], type: "same", lineNumber: newIndex + 1 });
  };

  const lcsWindow = (aStart: number, aEnd: number, bStart: number, bEnd: number): Array<[number, number]> => {
    const aLen = aEnd - aStart;
    const bLen = bEnd - bStart;
    if (aLen <= 0 || bLen <= 0) return [];
    const cellCount = aLen * bLen;
    if (cellCount > 8_000_000) {
      const result: Array<[number, number]> = [];
      let j = bStart;
      for (let i = aStart; i < aEnd; i++) {
        while (j < bEnd && newNorm[j] !== oldNorm[i]) {
          j += 1;
        }
        if (j < bEnd) {
          result.push([i, j]);
          j += 1;
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
        i -= 1;
        j -= 1;
      } else if (dp[i - 1][j] >= dp[i][j - 1]) {
        i -= 1;
      } else {
        j -= 1;
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
    const newPos = new Map<string, number>();

    for (let i = aStart; i < aEnd; i++) {
      const key = oldNorm[i];
      oldCounts.set(key, (oldCounts.get(key) ?? 0) + 1);
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

  const oldLines: DiffLine[] = [];
  const newLines: DiffLine[] = [];
  let oi = 0;
  let ni = 0;

  for (const [matchOld, matchNew] of lcsIndices) {
    while (oi < matchOld) {
      if (oldNorm[oi] === "" && oldIsBlankLine[oi]) {
        oi += 1;
        continue;
      }
      if (oldIsNeutralizedLine[oi]) {
        pushNeutralOldLine(oi);
        oi += 1;
        continue;
      }
      oldLines.push({ text: oldArr[oi], type: "removed", lineNumber: oi + 1 });
      newLines.push({ text: "", type: "empty", lineNumber: null });
      oi += 1;
    }
    while (ni < matchNew) {
      if (newNorm[ni] === "" && newIsBlankLine[ni]) {
        ni += 1;
        continue;
      }
      if (newIsNeutralizedLine[ni]) {
        pushNeutralNewLine(ni);
        ni += 1;
        continue;
      }
      oldLines.push({ text: "", type: "empty", lineNumber: null });
      newLines.push({ text: newArr[ni], type: "added", lineNumber: ni + 1 });
      ni += 1;
    }
    oldLines.push({ text: oldArr[oi], type: "same", lineNumber: oi + 1 });
    newLines.push({ text: newArr[ni], type: "same", lineNumber: ni + 1 });
    oi += 1;
    ni += 1;
  }

  while (oi < oldArr.length) {
    if (oldNorm[oi] === "" && oldIsBlankLine[oi]) {
      oi += 1;
      continue;
    }
    if (oldIsNeutralizedLine[oi]) {
      pushNeutralOldLine(oi);
      oi += 1;
      continue;
    }
    oldLines.push({ text: oldArr[oi], type: "removed", lineNumber: oi + 1 });
    newLines.push({ text: "", type: "empty", lineNumber: null });
    oi += 1;
  }
  while (ni < newArr.length) {
    if (newNorm[ni] === "" && newIsBlankLine[ni]) {
      ni += 1;
      continue;
    }
    if (newIsNeutralizedLine[ni]) {
      pushNeutralNewLine(ni);
      ni += 1;
      continue;
    }
    oldLines.push({ text: "", type: "empty", lineNumber: null });
    newLines.push({ text: newArr[ni], type: "added", lineNumber: ni + 1 });
    ni += 1;
  }

  return { oldLines, newLines };
};

export const findDiffHunkStarts = (rows: DiffMatrixRow[]): number[] => {
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

export const lineStyle = (type: DiffLine["type"]): CSSProperties => {
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

export const langFromPath = (path: string): string => {
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  if (path.endsWith(".js") || path.endsWith(".jsx")) return "javascript";
  if (path.endsWith(".py")) return "python";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".json")) return "json";
  return "text";
};

export const emptyLineStyle: CSSProperties = {
  display: "inline-block",
  minHeight: "1.5em",
  whiteSpace: "pre",
  width: "1px",
};

export const extractSearchWordFromDoubleClick = (
  event: ReactMouseEvent<HTMLElement>,
): string => {
  const selected = typeof window !== "undefined"
    ? window.getSelection()?.toString().trim() ?? ""
    : "";
  if (selected.length > 0 && !/\s/.test(selected)) {
    return selected;
  }
  const text = (event.target instanceof HTMLElement ? event.target.textContent : "") ?? "";
  const token = text.match(/[A-Za-z_][A-Za-z0-9_.$]*/)?.[0] ?? "";
  return token.trim();
};

export const scrollToRowIndex = (container: HTMLDivElement | null, rowIndex: number): void => {
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

export const scrollToSourceLine = (
  container: HTMLDivElement | null,
  targetLine: number,
  targetSide: "old" | "new",
): void => {
  if (!container || targetLine <= 0) return;
  clearRowHighlightClass(container, GRAPH_SELECTED_ROW_CLASS);
  const preferredSelector = targetSide === "old" ? `tr[data-old-line="${targetLine}"]` : `tr[data-new-line="${targetLine}"]`;
  const fallbackSelector = targetSide === "old" ? `tr[data-new-line="${targetLine}"]` : `tr[data-old-line="${targetLine}"]`;
  const row =
    (container.querySelector(preferredSelector) as HTMLElement | null)
    ?? (container.querySelector(fallbackSelector) as HTMLElement | null);
  if (!row) return;

  const containerRect = container.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const currentScroll = container.scrollTop;
  const rowOffsetInContainer = rowRect.top - containerRect.top + currentScroll;
  container.scrollTop = Math.max(0, rowOffsetInContainer - containerRect.height / 2);
  row.classList.add(GRAPH_SELECTED_ROW_CLASS);
};

export const clearPreviewSourceLine = (
  container: HTMLDivElement | null,
): void => {
  clearRowHighlightClass(container, GRAPH_PREVIEW_ROW_CLASS);
};

export const scrollToPreviewSourceLine = (
  container: HTMLDivElement | null,
  targetLine: number,
  targetSide: "old" | "new",
): void => {
  if (!container || targetLine <= 0) return;
  clearPreviewSourceLine(container);
  const preferredSelector = targetSide === "old" ? `tr[data-old-line="${targetLine}"]` : `tr[data-new-line="${targetLine}"]`;
  const fallbackSelector = targetSide === "old" ? `tr[data-new-line="${targetLine}"]` : `tr[data-old-line="${targetLine}"]`;
  const row =
    (container.querySelector(preferredSelector) as HTMLElement | null)
    ?? (container.querySelector(fallbackSelector) as HTMLElement | null);
  if (!row) return;
  const containerRect = container.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const currentScroll = container.scrollTop;
  const rowOffsetInContainer = rowRect.top - containerRect.top + currentScroll;
  container.scrollTop = Math.max(0, rowOffsetInContainer - containerRect.height / 2);
  row.classList.add(GRAPH_PREVIEW_ROW_CLASS);
};
