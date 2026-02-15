import type { MutableRefObject } from "react";
import type { GraphDiffTarget, TopLevelAnchor } from "../../components/SplitGraphPanel";
import type { ViewGraph, ViewportState } from "../../types/graph";
import { ViewBaseStore } from "./store";
import { normalizePath } from "./selectors";

interface CommandContext {
  store: ViewBaseStore;
  runInteractiveUpdate: (update: () => void) => void;
}

export const commandSelectNode = (
  context: CommandContext,
  nodeId: string,
  sourceSide: "old" | "new",
): void => {
  const { store, runInteractiveUpdate } = context;
  runInteractiveUpdate(() => {
    store.setSelectedNodeId(nodeId);
    store.focusNode(nodeId);
    const matchedOld = store.oldGraph.nodes.find((node) => node.id === nodeId);
    const matchedNew = store.newGraph.nodes.find((node) => node.id === nodeId);
    const primary = sourceSide === "old" ? matchedOld : matchedNew;
    const fallback = sourceSide === "old" ? matchedNew : matchedOld;
    const filePath = primary?.filePath ?? fallback?.filePath ?? "";
    if (filePath.length > 0) {
      store.setSelectedFilePath(normalizePath(filePath));
    }
    const line = primary?.startLine ?? fallback?.startLine ?? 0;
    store.setTarget(line, sourceSide);
    store.bumpScrollTick();
  });
};

export const commandSelectFile = (
  context: CommandContext,
  filePath: string,
): void => {
  const { store, runInteractiveUpdate } = context;
  runInteractiveUpdate(() => {
    store.setSelectedFilePath(filePath);
    store.bumpFocusFileTick();
  });
};

export const commandSelectSymbol = (
  context: CommandContext,
  startLine: number,
): void => {
  const { store } = context;
  store.setTarget(startLine, "new");
  store.bumpScrollTick();
};

export const commandSetViewport = (context: CommandContext, viewport: ViewportState): void => {
  context.store.setSharedViewport(viewport);
};

export const commandToggleShowCalls = (
  context: CommandContext,
  nextChecked: boolean,
): void => {
  const { store, runInteractiveUpdate } = context;
  runInteractiveUpdate(() => {
    store.setShowCalls(nextChecked);
  });
};

export const commandSetDiffTargets = (
  context: CommandContext,
  side: "old" | "new",
  targets: GraphDiffTarget[],
): void => {
  context.store.setDiffTargets(side, targets);
};

export const commandSetTopLevelAnchors = (
  context: CommandContext,
  side: "old" | "new",
  anchors: Record<string, TopLevelAnchor>,
): void => {
  context.store.setTopLevelAnchors(side, anchors);
};

interface LineClickContext extends CommandContext {
  selectedFilePath: string;
  displayOldGraph: ViewGraph;
  displayNewGraph: ViewGraph;
}

export const commandCodeLineClick = (
  context: LineClickContext,
  line: number,
  side: "old" | "new",
): void => {
  const filePath = normalizePath(context.selectedFilePath);
  if (!filePath) return;

  const sideGraph = side === "old" ? context.displayOldGraph : context.displayNewGraph;
  const inFile = sideGraph.nodes.filter((node) => normalizePath(node.filePath) === filePath);
  if (inFile.length === 0) return;

  const withRange = inFile.filter(
    (node) =>
      (node.startLine ?? 0) > 0
      && (node.endLine ?? node.startLine ?? 0) >= (node.startLine ?? 0),
  );

  const containing = withRange.filter((node) => {
    const start = node.startLine ?? 0;
    const end = node.endLine ?? start;
    return line >= start && line <= end;
  });

  const candidates = containing.length > 0 ? containing : withRange;
  if (candidates.length === 0) return;

  candidates.sort((a, b) => {
    const aStart = a.startLine ?? 0;
    const aEnd = a.endLine ?? aStart;
    const bStart = b.startLine ?? 0;
    const bEnd = b.endLine ?? bStart;
    const aSpan = Math.max(1, aEnd - aStart + 1);
    const bSpan = Math.max(1, bEnd - bStart + 1);
    if (aSpan !== bSpan) return aSpan - bSpan;
    if (a.kind === "Branch" && b.kind !== "Branch") return -1;
    if (b.kind === "Branch" && a.kind !== "Branch") return 1;
    return Math.abs(aStart - line) - Math.abs(bStart - line);
  });

  const target = candidates[0];
  context.store.setSelectedNodeId(target.id);
  context.store.focusNode(target.id);
};

interface DiffNavigationContext extends CommandContext {
  graphDiffTargets: GraphDiffTarget[];
  highlightTimerRef: MutableRefObject<number | null>;
}

export const commandGoToGraphDiff = (
  context: DiffNavigationContext,
  idx: number,
): void => {
  const { graphDiffTargets, store, highlightTimerRef } = context;
  if (graphDiffTargets.length === 0) return;

  const normalized = ((idx % graphDiffTargets.length) + graphDiffTargets.length) % graphDiffTargets.length;
  store.setGraphDiffIdx(normalized);
  const target = graphDiffTargets[normalized];
  store.setHighlightedNodeId(target.id);

  if (highlightTimerRef.current !== null) {
    window.clearTimeout(highlightTimerRef.current);
  }
  highlightTimerRef.current = window.setTimeout(() => {
    store.clearHighlightedNode();
    highlightTimerRef.current = null;
  }, 1400);

  store.setSharedViewport({ x: target.viewportX, y: target.viewportY, zoom: target.viewportZoom });
};
