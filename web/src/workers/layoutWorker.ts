import dagre from "@dagrejs/dagre";
import type { ViewGraph, ViewGraphNode } from "../types/graph";
import type {
  LayoutEdge,
  LayoutNode,
  LayoutWorkerRequest,
  LayoutWorkerResponse,
} from "./layoutTypes";

const statusColor: Record<string, string> = {
  added: "#15803d",
  removed: "#b91c1c",
  modified: "#ca8a04",
  unchanged: "#334155",
};

const statusTextColor: Record<string, string> = {
  added: "#f0fdf4",
  removed: "#fef2f2",
  modified: "#1c1917",
  unchanged: "#f8fafc",
};

const decisionKinds = new Set(["if", "elif", "switch", "ternary"]);
const terminalKinds = new Set(["return", "raise"]);
const loopKinds = new Set(["for", "while"]);

const LEAF_W = 220;
const LEAF_H = 64;
const DIAMOND_W = 220;
const DIAMOND_H = 220;
const PAD_X = 45;
const PAD_TOP = 72;
const PAD_BOTTOM = 45;
const NODE_W = 220;
const NODE_H = 56;

const leafNodeShape = (branchType: string): string => {
  if (decisionKinds.has(branchType)) return "diamond";
  if (terminalKinds.has(branchType) || loopKinds.has(branchType)) return "pill";
  return "process";
};

interface CodeContextData {
  lines: Array<{ num: number; text: string; highlight: boolean }>;
}

const extractCodeContext = (
  fileLines: string[],
  startLine: number | undefined,
  endLine: number | undefined,
): CodeContextData => {
  if (!startLine || fileLines.length === 0) return { lines: [] };
  const from = Math.max(0, startLine - 6);
  const to = Math.min(fileLines.length, (endLine ?? startLine) + 5);
  const end = endLine ?? startLine;
  return {
    lines: fileLines.slice(from, to).map((text, i) => {
      const num = from + i + 1;
      return { num, text, highlight: num >= startLine && num <= end };
    }),
  };
};

const normPath = (v: string): string =>
  v.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");

const langFromPath = (path: string): string => {
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  if (path.endsWith(".js") || path.endsWith(".jsx")) return "javascript";
  if (path.endsWith(".py")) return "python";
  return "text";
};

const shortenPath = (filePath: string): string => {
  const parts = filePath.replace(/\\/g, "/").split("/");
  if (parts.length <= 3) return filePath;
  const firstDir = parts[0];
  const secondDir = parts[1];
  const fileName = parts[parts.length - 1];
  return `${firstDir}/${secondDir}/[...]/${fileName}`;
};

const computeLogicLayout = (
  graph: ViewGraph,
  fileContentMap: Map<string, string>,
  showCalls: boolean,
): { nodes: LayoutNode[]; edges: LayoutEdge[] } => {
  const fileLinesCache = new Map<string, string[]>();
  const getFileLines = (normalizedFilePath: string): string[] => {
    const cached = fileLinesCache.get(normalizedFilePath);
    if (cached) return cached;
    const content = fileContentMap.get(normalizedFilePath) ?? "";
    const lines = content.length > 0 ? content.split("\n") : [];
    fileLinesCache.set(normalizedFilePath, lines);
    return lines;
  };
  const graphNodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const groupNodes = graph.nodes.filter((n) => n.kind === "group");
  const leafNodes = graph.nodes.filter((n) => n.kind !== "group");

  const childrenOf = new Map<string, ViewGraphNode[]>();
  for (const g of groupNodes) childrenOf.set(g.id, []);
  for (const leaf of leafNodes) {
    if (leaf.parentId && childrenOf.has(leaf.parentId)) {
      childrenOf.get(leaf.parentId)!.push(leaf);
    }
  }
  for (const g of groupNodes) {
    if (g.parentId && childrenOf.has(g.parentId)) {
      childrenOf.get(g.parentId)!.push(g);
    }
  }

  const emptyIds = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const g of groupNodes) {
      if (emptyIds.has(g.id)) continue;
      const kids = childrenOf.get(g.id) ?? [];
      const hasLeaf = kids.some((c) => c.kind !== "group");
      const hasSubGroup = kids.some((c) => c.kind === "group" && !emptyIds.has(c.id));
      // Keep changed empty groups visible (common in new/removed minimal functions).
      if (!hasLeaf && !hasSubGroup && g.diffStatus === "unchanged") {
        emptyIds.add(g.id);
        changed = true;
      }
    }
  }

  const childPos = new Map<string, { x: number; y: number }>();
  const groupSize = new Map<string, { w: number; h: number }>();

  const sortedGroups = [...groupNodes].filter((g) => !emptyIds.has(g.id));
  const depth = new Map<string, number>();
  const getDepth = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    const node = graph.nodes.find((n) => n.id === id);
    if (!node?.parentId || emptyIds.has(node.parentId)) {
      depth.set(id, 0);
      return 0;
    }
    const d = getDepth(node.parentId) + 1;
    depth.set(id, d);
    return d;
  };
  sortedGroups.forEach((g) => getDepth(g.id));
  sortedGroups.sort((a, b) => (depth.get(b.id) ?? 0) - (depth.get(a.id) ?? 0));

  for (const group of sortedGroups) {
    const kids = (childrenOf.get(group.id) ?? []).filter((c) => !emptyIds.has(c.id));
    if (kids.length === 0) {
      if (group.diffStatus === "unchanged") {
        emptyIds.add(group.id);
      } else {
        groupSize.set(group.id, {
          w: LEAF_W + PAD_X * 2,
          h: LEAF_H + PAD_TOP + PAD_BOTTOM,
        });
      }
      continue;
    }

    const dg = new dagre.graphlib.Graph();
    dg.setDefaultEdgeLabel(() => ({}));
    dg.setGraph({ rankdir: "TB", nodesep: 120, ranksep: 130, marginx: 40, marginy: 40 });

    for (const kid of kids) {
      const isDiamond = kid.kind === "Branch" && decisionKinds.has(kid.branchType ?? "");
      const isSub = kid.kind === "group";
      const w = isDiamond ? DIAMOND_W : isSub ? (groupSize.get(kid.id)?.w ?? LEAF_W) : LEAF_W;
      const h = isDiamond ? DIAMOND_H : isSub ? (groupSize.get(kid.id)?.h ?? LEAF_H) : LEAF_H;
      dg.setNode(kid.id, { width: w, height: h });
    }
    const kidIds = new Set(kids.map((k) => k.id));
    for (const edge of graph.edges) {
      if (kidIds.has(edge.source) && kidIds.has(edge.target) && dg.hasNode(edge.source) && dg.hasNode(edge.target)) {
        dg.setEdge(edge.source, edge.target);
      }
    }
    dagre.layout(dg);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const kid of kids) {
      const p = dg.node(kid.id);
      if (!p) continue;
      const isDiamond = kid.kind === "Branch" && decisionKinds.has(kid.branchType ?? "");
      const isSub = kid.kind === "group";
      const w = isDiamond ? DIAMOND_W : isSub ? (groupSize.get(kid.id)?.w ?? LEAF_W) : LEAF_W;
      const h = isDiamond ? DIAMOND_H : isSub ? (groupSize.get(kid.id)?.h ?? LEAF_H) : LEAF_H;
      const tlx = p.x - w / 2;
      const tly = p.y - h / 2;
      childPos.set(kid.id, { x: tlx, y: tly });
      minX = Math.min(minX, tlx);
      minY = Math.min(minY, tly);
      maxX = Math.max(maxX, tlx + w);
      maxY = Math.max(maxY, tly + h);
    }
    for (const kid of kids) {
      const p = childPos.get(kid.id);
      if (p) childPos.set(kid.id, { x: p.x - minX + PAD_X, y: p.y - minY + PAD_TOP });
    }
    groupSize.set(group.id, { w: (maxX - minX) + PAD_X * 2, h: (maxY - minY) + PAD_TOP + PAD_BOTTOM });
  }

  const topNodes = graph.nodes.filter((n) => {
    if (emptyIds.has(n.id)) return false;
    if (!n.parentId) return true;
    if (emptyIds.has(n.parentId)) return true;
    return false;
  });

  const g2 = new dagre.graphlib.Graph();
  g2.setDefaultEdgeLabel(() => ({}));
  g2.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 100, marginx: 40, marginy: 40 });
  for (const n of topNodes) {
    const sz = groupSize.get(n.id);
    const w = sz?.w ?? LEAF_W;
    const h = sz?.h ?? LEAF_H;
    g2.setNode(n.id, { width: w, height: h });
  }
  const topIdSet = new Set(topNodes.map((n) => n.id));
  for (const edge of graph.edges) {
    if (topIdSet.has(edge.source) && topIdSet.has(edge.target) && g2.hasNode(edge.source) && g2.hasNode(edge.target)) {
      g2.setEdge(edge.source, edge.target);
    }
  }
  dagre.layout(g2);
  const topPos = new Map<string, { x: number; y: number }>();
  for (const n of topNodes) {
    const p = g2.node(n.id);
    const sz = groupSize.get(n.id);
    const w = sz?.w ?? LEAF_W;
    const h = sz?.h ?? LEAF_H;
    topPos.set(n.id, { x: (p?.x ?? 0) - w / 2, y: (p?.y ?? 0) - h / 2 });
  }
  const flowNodes: LayoutNode[] = [];
  for (const node of graph.nodes) {
    if (emptyIds.has(node.id)) continue;
    const parentOk = node.parentId && !emptyIds.has(node.parentId);
    const bg = statusColor[node.diffStatus] ?? "#334155";
    const txt = statusTextColor[node.diffStatus] ?? "#f8fafc";

    if (node.kind === "group") {
      const sz = groupSize.get(node.id) ?? { w: LEAF_W, h: LEAF_H };
      const pos = parentOk ? (childPos.get(node.id) ?? { x: 0, y: 0 }) : (topPos.get(node.id) ?? { x: 0, y: 0 });
      flowNodes.push({
        id: node.id,
        type: "scope",
        data: {
          label: node.label,
          functionName: node.label,
          filePath: node.filePath,
          bgColor: bg,
          textColor: txt,
          selected: false,
          width: sz.w,
          height: sz.h,
          fileName: node.fileName,
          className: node.className,
          functionParams: node.functionParams,
          returnType: node.returnType,
          documentation: node.documentation,
        },
        position: pos,
        sourcePosition: "bottom",
        targetPosition: "top",
        ...(parentOk ? { parentId: node.parentId } : {}),
        style: { width: sz.w, height: sz.h },
        initialWidth: sz.w,
        initialHeight: sz.h,
      });
    } else {
      const shape = leafNodeShape(node.branchType ?? "");
      const initialSize = shape === "diamond" ? { width: 120, height: 120 } : { width: LEAF_W, height: LEAF_H };
      const pos = parentOk ? (childPos.get(node.id) ?? { x: 0, y: 0 }) : (topPos.get(node.id) ?? { x: 0, y: 0 });
      const ownerFn = node.parentId ? graphNodeById.get(node.parentId) : undefined;
      const normalizedFilePath = normPath(node.filePath);
      const codeContext = extractCodeContext(getFileLines(normalizedFilePath), node.startLine, node.endLine);
      const nodeLang = langFromPath(normalizedFilePath);

      let nodeBg = bg;
      let nodeTxt = txt;
      if ((node.branchType ?? "") === "return") {
        if (node.diffStatus === "added") {
          nodeBg = "#86efac";
          nodeTxt = "#14532d";
        } else if (node.diffStatus === "unchanged") {
          nodeBg = "#6d28d9";
          nodeTxt = "#f5f3ff";
        } else if (node.diffStatus === "modified") {
          nodeBg = "#a78bfa";
          nodeTxt = "#1e1b4b";
        }
      }

      flowNodes.push({
        id: node.id,
        type: shape,
        data: {
          label: node.label,
          symbolName: node.label,
          functionName: ownerFn?.kind === "group" ? ownerFn.label : undefined,
          filePath: node.filePath,
          bgColor: nodeBg,
          textColor: nodeTxt,
          selected: false,
          codeContext,
          language: nodeLang,
        },
        position: pos,
        sourcePosition: "bottom",
        targetPosition: "top",
        ...(parentOk ? { parentId: node.parentId } : {}),
        initialWidth: initialSize.width,
        initialHeight: initialSize.height,
      });
    }
  }

  flowNodes.sort((a, b) => {
    const ap = "parentId" in a && a.parentId;
    const bp = "parentId" in b && b.parentId;
    if (!ap && bp) return -1;
    if (ap && !bp) return 1;
    return 0;
  });

  const visibleIds = new Set(flowNodes.map((n) => n.id));
  const groupIdSet = new Set(flowNodes.filter((n) => n.type === "scope").map((n) => n.id));
  const flowEdges: LayoutEdge[] = graph.edges
    .filter((e) => {
      if (!visibleIds.has(e.source) || !visibleIds.has(e.target)) return false;
      if (e.relation === "hierarchy") return false;
      if (!showCalls && e.relation === "invoke") return false;
      if (groupIdSet.has(e.source) || groupIdSet.has(e.target)) {
        return e.relation === "invoke";
      }
      return true;
    })
    .map((edge) => {
      const isInvoke = edge.relation === "invoke";
      const flowType = edge.relation === "flow" ? edge.flowType : undefined;
      const sourceGraphNode = graphNodeById.get(edge.source);
      const sourceIsDecision = sourceGraphNode?.kind === "Branch" && decisionKinds.has(sourceGraphNode.branchType ?? "");
      const stroke = edge.diffStatus === "added"
        ? "#4ade80"
        : edge.diffStatus === "removed"
          ? "#f87171"
          : isInvoke
            ? "#f59e0b"
            : flowType === "true"
              ? "#22c55e"
              : flowType === "false"
                ? "#f87171"
                : "#94a3b8";
      const strokeWidth = isInvoke ? 2.5 : 1.5;
      const sourceHandle = flowType === "true"
        ? "yes"
        : flowType === "false"
          ? "no"
          : flowType === "next" && sourceIsDecision
            ? "next"
          : undefined;
      const label = isInvoke
        ? "calls"
        : flowType === "next"
          ? "next"
          : flowType === "true"
            ? "T"
            : flowType === "false"
              ? "F"
              : "";
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        ...(sourceHandle ? { sourceHandle } : {}),
        label,
        animated: edge.diffStatus === "added" || edge.diffStatus === "removed",
        labelShowBg: true,
        labelBgPadding: [8, 5],
        labelBgBorderRadius: 6,
        labelBgStyle: {
          fill: "#020617",
          fillOpacity: 0.92,
          stroke: "#334155",
          strokeWidth: 1.1,
        },
        labelStyle: {
          fill: flowType === "false" ? "#fecaca" : flowType === "true" ? "#bbf7d0" : "#f8fafc",
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: 0.2,
        },
        style: {
          stroke,
          strokeWidth,
          strokeDasharray: isInvoke
            ? "6 4"
            : flowType === "next"
              ? "3 6"
              : flowType === "false"
                ? "8 5"
                : undefined,
        },
        markerEnd: { type: "arrowclosed", width: 14, height: 14, color: stroke },
      };
    });

  return { nodes: flowNodes, edges: flowEdges };
};

const computeFlatLayout = (
  graph: ViewGraph,
  fileContentMap: Map<string, string>,
): { nodes: LayoutNode[]; edges: LayoutEdge[] } => {
  const fileLinesCache = new Map<string, string[]>();
  const getFileLines = (normalizedFilePath: string): string[] => {
    const cached = fileLinesCache.get(normalizedFilePath);
    if (cached) return cached;
    const content = fileContentMap.get(normalizedFilePath) ?? "";
    const lines = content.length > 0 ? content.split("\n") : [];
    fileLinesCache.set(normalizedFilePath, lines);
    return lines;
  };
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 50, ranksep: 80, marginx: 50, marginy: 50 });
  graph.nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  graph.edges.forEach((e) => {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  });
  dagre.layout(g);

  const nodes: LayoutNode[] = graph.nodes.map((node) => {
    const p = g.node(node.id);
    const bg = statusColor[node.diffStatus] ?? "#334155";
    const txt = statusTextColor[node.diffStatus] ?? "#f8fafc";
    const nfp = normPath(node.filePath);
    const codeContext = extractCodeContext(getFileLines(nfp), node.startLine, node.endLine);
    const lang = langFromPath(nfp);
    return {
      id: node.id,
      type: "knowledge",
      data: {
        label: node.label,
        symbolName: node.label,
        functionName: node.label,
        filePath: node.filePath,
        shortPath: shortenPath(node.filePath),
        fullPath: node.filePath,
        bgColor: bg,
        textColor: txt,
        selected: false,
        codeContext,
        language: lang,
      },
      position: { x: (p?.x ?? 0) - NODE_W / 2, y: (p?.y ?? 0) - NODE_H / 2 },
      sourcePosition: "right",
      targetPosition: "left",
      initialWidth: NODE_W,
      initialHeight: NODE_H,
    };
  });
  const edges: LayoutEdge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: "",
    animated: edge.diffStatus === "added" || edge.diffStatus === "removed",
    style: {
      stroke: edge.diffStatus === "added" ? "#4ade80" : edge.diffStatus === "removed" ? "#f87171" : "#64748b",
      strokeWidth: 1.5,
    },
    markerEnd: { type: "arrowclosed", width: 14, height: 14, color: "#94a3b8" },
  }));
  return { nodes, edges };
};

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<LayoutWorkerRequest>) => void) | null;
  postMessage: (message: LayoutWorkerResponse) => void;
};

workerScope.onmessage = (event: MessageEvent<LayoutWorkerRequest>) => {
  const { requestId, graph, viewType, showCalls, fileEntries } = event.data;
  try {
    const fileContentMap = new Map<string, string>(fileEntries);
    const result = viewType === "logic"
      ? computeLogicLayout(graph, fileContentMap, showCalls)
      : computeFlatLayout(graph, fileContentMap);
    workerScope.postMessage({
      requestId,
      ok: true,
      result,
    });
  } catch (reason) {
    workerScope.postMessage({
      requestId,
      ok: false,
      error: reason instanceof Error ? reason.message : String(reason),
    });
  }
};
