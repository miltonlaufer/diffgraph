import type { GraphDelta } from "../diff/graphDelta.js";
import type { GraphNode, SnapshotGraph, ViewGraph, ViewGraphNode } from "../graph/schema.js";

const functionKinds = new Set(["Function", "Method", "ReactComponent", "Hook"]);
const logicKinds = new Set(["Function", "Method", "ReactComponent", "Hook", "Branch"]);
const logicEdgeKinds = new Set(["CALLS", "DECLARES"]);

const kindBadge: Record<string, string> = {
  ReactComponent: "Component",
  Hook: "Hook",
  Function: "Function",
  Method: "Method",
};

/** Build child -> parent map from DECLARES edges */
const buildParentMap = (graph: SnapshotGraph): Map<string, GraphNode> => {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const parentMap = new Map<string, GraphNode>();
  for (const edge of graph.edges) {
    if (edge.kind === "DECLARES") {
      const parent = nodeById.get(edge.source);
      if (parent) {
        parentMap.set(edge.target, parent);
      }
    }
  }
  return parentMap;
};

const buildViewGraph = (
  graph: SnapshotGraph,
  parentMap: Map<string, GraphNode>,
  nodeStatus: Map<string, string>,
  edgeStatus: Map<string, string>,
): ViewGraph => {
  const allLogicNodes = graph.nodes.filter((n) => logicKinds.has(n.kind));
  const logicNodeIds = new Set(allLogicNodes.map((n) => n.id));
  const viewNodes: ViewGraphNode[] = [];

  /* Emit function/method/hook/component nodes as group containers */
  for (const node of allLogicNodes) {
    if (!functionKinds.has(node.kind)) {
      continue;
    }
    const badge = kindBadge[node.kind] ?? node.kind;
    const params = (node.metadata?.params as string) ?? "";
    const label = `[${badge}] ${node.name}${params}`;

    /* Check if this function itself has a parent function (e.g. useEffect inside Component) */
    const parentFn = parentMap.get(node.id);
    const hasParentGroup = parentFn && functionKinds.has(parentFn.kind) && logicNodeIds.has(parentFn.id);

    viewNodes.push({
      id: node.id,
      label,
      kind: "group",
      diffStatus: (nodeStatus.get(node.id) ?? "unchanged") as ViewGraphNode["diffStatus"],
      filePath: node.filePath,
      startLine: node.startLine,
      endLine: node.endLine,
      parentId: hasParentGroup ? parentFn.id : undefined,
    });
  }

  /* Emit branch nodes as leaves with parentId pointing to their owner function */
  for (const node of allLogicNodes) {
    if (node.kind !== "Branch") {
      continue;
    }
    const ownerFn = parentMap.get(node.id);
    const parentId = ownerFn && logicNodeIds.has(ownerFn.id) ? ownerFn.id : undefined;

    const branchKind = (node.metadata?.branchType as string) ?? "";
    const snippet = (node.metadata?.codeSnippet as string) ?? "";
    const label = snippet.length > 0 ? `${node.name}\n${snippet}` : node.name;

    viewNodes.push({
      id: node.id,
      label,
      kind: "Branch",
      diffStatus: (nodeStatus.get(node.id) ?? "unchanged") as ViewGraphNode["diffStatus"],
      filePath: node.filePath,
      startLine: node.startLine,
      endLine: node.endLine,
      parentId,
      branchType: branchKind,
    });
  }

  /* Edges: only between logic nodes */
  const viewNodeIds = new Set(viewNodes.map((n) => n.id));
  const edges = graph.edges
    .filter((e) => logicEdgeKinds.has(e.kind) && viewNodeIds.has(e.source) && viewNodeIds.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      kind: e.kind,
      diffStatus: (edgeStatus.get(e.id) ?? "unchanged") as ViewGraphNode["diffStatus"],
    }));

  return { nodes: viewNodes, edges };
};

export const buildLogicView = (delta: GraphDelta): { oldGraph: ViewGraph; newGraph: ViewGraph } => {
  const oldParentMap = buildParentMap(delta.oldGraph);
  const newParentMap = buildParentMap(delta.newGraph);

  return {
    oldGraph: buildViewGraph(delta.oldGraph, oldParentMap, delta.nodeStatus, delta.edgeStatus),
    newGraph: buildViewGraph(delta.newGraph, newParentMap, delta.nodeStatus, delta.edgeStatus),
  };
};
