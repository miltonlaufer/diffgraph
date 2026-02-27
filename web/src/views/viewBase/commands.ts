import type { MutableRefObject } from "react";
import type { GraphDiffTarget, InternalNodeAnchor, TopLevelAnchor } from "#/components/SplitGraphPanel";
import type { ViewGraph, ViewportState } from "#/types/graph";
import { buildCrossGraphNodeMatchKey } from "#/lib/nodeIdentity";
import type { ViewBaseStoreInstance } from "./store";
import { normalizePath } from "./selectors";

interface CommandContext {
  store: ViewBaseStoreInstance;
  runInteractiveUpdate: (update: () => void) => void;
}

const sanitizeLineNumbers = (lineNumbers: number[]): number[] => {
  const normalized = lineNumbers
    .map((value) => Math.floor(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  return [...new Set(normalized)].sort((a, b) => a - b);
};

export const commandSelectNode = (
  context: CommandContext,
  nodeId: string,
  sourceSide: "old" | "new",
): void => {
  const { store, runInteractiveUpdate } = context;
  runInteractiveUpdate(() => {
    store.setSelectedNodeId(nodeId);
    store.setFileListCollapsed(true);
    store.focusNode(nodeId, sourceSide);
    const matchedOld = store.oldGraph.nodes.find((node) => node.id === nodeId);
    const matchedNew = store.newGraph.nodes.find((node) => node.id === nodeId);
    const primary = sourceSide === "old" ? matchedOld : matchedNew;
    const fallback = sourceSide === "old" ? matchedNew : matchedOld;
    const filePath = primary?.filePath ?? fallback?.filePath ?? "";
    if (filePath.length > 0) {
      store.selectFilesFromNode(normalizePath(filePath));
      store.setSelectedFilePath(normalizePath(filePath));
    }
    const line = primary?.startLine ?? fallback?.startLine ?? 0;
    store.setTarget(line, sourceSide);
    store.bumpScrollTick();
  });
};

export const commandFocusGraphNode = (
  context: CommandContext,
  nodeId: string,
  sourceSide: "old" | "new",
): void => {
  const { store, runInteractiveUpdate } = context;
  runInteractiveUpdate(() => {
    store.setSelectedNodeId(nodeId);
    store.focusNode(nodeId, sourceSide);
    store.bumpGraphTopScrollTick();
  });
};

export const commandSelectFile = (
  context: CommandContext,
  filePath: string,
): void => {
  const { store, runInteractiveUpdate } = context;
  runInteractiveUpdate(() => {
    const current = normalizePath(store.selectedFilePath);
    const next = normalizePath(filePath);
    if (current.length > 0 && current === next) {
      store.setSelectedFilePath("");
      return;
    }
    store.setSelectedFilePath(filePath);
    store.selectFilesFromNode(next);
    store.bumpFocusFileTick();
  });
};

export const commandResetToInitialState = (context: CommandContext): void => {
  const { store, runInteractiveUpdate } = context;
  runInteractiveUpdate(() => {
    store.resetToInitialState();
  });
};

export const commandSelectSymbol = (
  context: CommandContext,
  startLine: number,
): void => {
  const { store, runInteractiveUpdate } = context;
  runInteractiveUpdate(() => {
    store.setTarget(startLine, "new");
    store.bumpScrollTick();
  });
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

export const commandSetNodeAnchors = (
  context: CommandContext,
  side: "old" | "new",
  anchors: Record<string, InternalNodeAnchor>,
): void => {
  context.store.setNodeAnchors(side, anchors);
};

export const commandSetHoveredNode = (
  context: CommandContext,
  side: "old" | "new",
  nodeId: string,
  matchKey: string,
): void => {
  const { store } = context;
  if (!nodeId) {
    store.clearHoveredNode();
    store.clearHoveredCodeTarget();
    return;
  }
  const sourceGraph = side === "old" ? store.oldGraph : store.newGraph;
  const sourceNode = sourceGraph.nodes.find((node) => node.id === nodeId);
  if (!sourceNode) {
    store.clearHoveredNode();
    store.clearHoveredCodeTarget();
    return;
  }
  const resolvedMatchKey = matchKey || buildCrossGraphNodeMatchKey(sourceNode);
  store.setHoveredNode(side, nodeId, resolvedMatchKey);
  const sourceLine = sourceNode.startLine ?? 0;
  if (sourceLine > 0) {
    store.setHoveredCodeTarget(sourceLine, side);
  } else {
    store.clearHoveredCodeTarget();
  }
};

interface LineClickContext extends CommandContext {
  selectedFilePath: string;
  displayOldGraph: ViewGraph;
  displayNewGraph: ViewGraph;
  highlightTimerRef: MutableRefObject<number | null>;
}

const NODE_HIGHLIGHT_MS = 4200;
const GRAPH_DIFF_HIGHLIGHT_MS = 5000;

const resolveBestNodeForLine = (
  selectedFilePath: string,
  displayOldGraph: ViewGraph,
  displayNewGraph: ViewGraph,
  line: number,
  side: "old" | "new",
) => {
  const filePath = normalizePath(selectedFilePath);
  if (!filePath) return null;

  const sideGraph = side === "old" ? displayOldGraph : displayNewGraph;
  const inFile = sideGraph.nodes.filter((node) => normalizePath(node.filePath) === filePath);
  if (inFile.length === 0) return null;

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
  if (candidates.length === 0) return null;

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

  return candidates[0] ?? null;
};

export const commandCodeLineClick = (
  context: LineClickContext,
  line: number,
  side: "old" | "new",
): void => {
  const { runInteractiveUpdate } = context;
  runInteractiveUpdate(() => {
    const target = resolveBestNodeForLine(
      context.selectedFilePath,
      context.displayOldGraph,
      context.displayNewGraph,
      line,
      side,
    );
    if (!target) return;
    context.store.setSelectedNodeId(target.id);
    context.store.focusNode(target.id, side);
    context.store.bumpGraphTopScrollTick();
    context.store.setHighlightedNodeId(target.id);
    if (context.highlightTimerRef.current !== null) {
      window.clearTimeout(context.highlightTimerRef.current);
    }
    context.highlightTimerRef.current = window.setTimeout(() => {
      context.store.clearHighlightedNode();
      context.highlightTimerRef.current = null;
    }, NODE_HIGHLIGHT_MS);
  });
};

export const commandCodeLineHover = (
  context: Omit<LineClickContext, "highlightTimerRef">,
  line: number,
  side: "old" | "new",
): void => {
  const target = resolveBestNodeForLine(
    context.selectedFilePath,
    context.displayOldGraph,
    context.displayNewGraph,
    line,
    side,
  );
  if (!target) {
    context.store.clearHoveredNode();
    context.store.clearHoveredCodeTarget();
    return;
  }
  context.store.setHoveredCodeTarget(line, side);
  context.store.setHoveredNode(side, target.id, buildCrossGraphNodeMatchKey(target));
  context.store.focusNode(target.id, side);
};

export const commandCodeLineHoverClear = (
  context: CommandContext,
): void => {
  const { store } = context;
  store.clearHoveredNode();
  store.clearHoveredCodeTarget();
  if (store.selectedNodeId) {
    store.focusNode(store.selectedNodeId, store.targetSide as "old" | "new");
  }
};

export const commandCodeLineDoubleClick = (
  context: CommandContext,
  side: "old" | "new",
  word: string,
): void => {
  const query = word.trim();
  if (!query) return;
  context.runInteractiveUpdate(() => {
    context.store.requestGraphSearch(side, query);
    context.store.bumpGraphTopScrollTick();
  });
};

export const commandOpenCodeLogicTree = (
  context: CommandContext,
  nodeId: string,
  sourceSide: "old" | "new",
  lineNumbers: number[],
): void => {
  const { store, runInteractiveUpdate } = context;
  runInteractiveUpdate(() => {
    store.setSelectedNodeId(nodeId);
    store.setFileListCollapsed(true);
    store.focusNode(nodeId, sourceSide);
    const matchedOld = store.oldGraph.nodes.find((node) => node.id === nodeId);
    const matchedNew = store.newGraph.nodes.find((node) => node.id === nodeId);
    const primary = sourceSide === "old" ? matchedOld : matchedNew;
    const fallback = sourceSide === "old" ? matchedNew : matchedOld;
    const filePath = primary?.filePath ?? fallback?.filePath ?? "";
    if (filePath.length > 0) {
      store.selectFilesFromNode(normalizePath(filePath));
      store.setSelectedFilePath(normalizePath(filePath));
    }

    const fallbackLine = primary?.startLine ?? fallback?.startLine ?? 0;
    const filteredLines = sanitizeLineNumbers(lineNumbers);
    const targetLine = filteredLines[0] ?? fallbackLine;
    if (targetLine > 0) {
      store.setTarget(targetLine, sourceSide);
      store.bumpScrollTick();
    }
    const requestLines = filteredLines.length > 0
      ? filteredLines
      : targetLine > 0
        ? [targetLine]
        : [];
    store.requestCodeLogicTree(sourceSide, requestLines);
  });
};

interface DiffNavigationContext extends CommandContext {
  graphDiffTargets: GraphDiffTarget[];
  highlightTimerRef: MutableRefObject<number | null>;
}

export const commandGoToGraphDiff = (
  context: DiffNavigationContext,
  idx: number,
): void => {
  const { graphDiffTargets, store, highlightTimerRef, runInteractiveUpdate } = context;
  runInteractiveUpdate(() => {
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
    }, GRAPH_DIFF_HIGHLIGHT_MS);

    store.setSharedViewport({ x: target.viewportX, y: target.viewportY, zoom: target.viewportZoom });

    commandSelectNode(context, target.id, target.side);
  });
};
