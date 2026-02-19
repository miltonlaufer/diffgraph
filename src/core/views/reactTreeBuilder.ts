import type { GraphDelta } from "../diff/graphDelta.js";
import type { DiffStatus, GraphNode, SnapshotGraph, ViewGraph, ViewGraphEdge, ViewGraphNode } from "../graph/schema.js";

const reactKinds = new Set(["ReactComponent", "Hook"]);
const reactEdgeKinds = new Set(["RENDERS", "USES_HOOK", "CALLS"]);

const parseCsvList = (value: string): string[] =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

const isReactBranchNode = (node: GraphNode): boolean => {
  if (node.kind !== "Branch") return false;
  const hookName = (node.metadata?.hookName as string | undefined) ?? "";
  const jsxTagNames = (node.metadata?.jsxTagNames as string | undefined) ?? "";
  const containsJsx = node.metadata?.containsJsx === true;
  return hookName.length > 0 || jsxTagNames.length > 0 || containsJsx;
};

const buildParentMap = (graph: SnapshotGraph): Map<string, GraphNode> => {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const parentMap = new Map<string, GraphNode>();
  for (const edge of graph.edges) {
    if (edge.kind !== "DECLARES") continue;
    const parent = nodeById.get(edge.source);
    if (parent) {
      parentMap.set(edge.target, parent);
    }
  }
  return parentMap;
};

const formatReactNodeLabel = (node: GraphNode): string => {
  if (node.kind === "Branch") {
    const hookName = (node.metadata?.hookName as string | undefined) ?? "";
    const hookDependencies = (node.metadata?.hookDependencies as string | undefined) ?? "";
    if (hookName.length > 0) {
      return hookDependencies.length > 0
        ? `Hook: ${hookName} deps: ${hookDependencies}`
        : `Hook: ${hookName}`;
    }
    const jsxTagNames = parseCsvList((node.metadata?.jsxTagNames as string | undefined) ?? "");
    if (jsxTagNames.length > 0) {
      return `JSX: ${jsxTagNames.map((tag) => `<${tag}>`).join(", ")}`;
    }
    return (node.metadata?.codeSnippet as string | undefined) ?? node.name;
  }

  const wrappedBy = (node.metadata?.wrappedBy as string | undefined) ?? "";
  const hookDependencies = (node.metadata?.hookDependencies as string | undefined) ?? "";
  const wrapperSuffix = wrappedBy.length > 0
    ? ` [${wrappedBy}${hookDependencies.length > 0 ? ` deps: ${hookDependencies}` : ""}]`
    : "";
  return `${node.name}${wrapperSuffix}`;
};

const buildViewGraph = (
  graph: SnapshotGraph,
  nodeStatus: GraphDelta["nodeStatus"],
  edgeStatus: GraphDelta["edgeStatus"],
): ViewGraph => {
  const parentMap = buildParentMap(graph);
  const reactNodes = graph.nodes.filter((node) => reactKinds.has(node.kind) || isReactBranchNode(node));
  const reactNodeIds = new Set(reactNodes.map((node) => node.id));

  const viewNodes: ViewGraphNode[] = reactNodes.map((node) => {
    const parent = parentMap.get(node.id);
    const parentId = parent && reactNodeIds.has(parent.id) ? parent.id : undefined;
    const branchType = node.kind === "Branch"
      ? ((node.metadata?.branchType as string | undefined) ?? undefined)
      : undefined;

    return {
      id: node.id,
      label: formatReactNodeLabel(node),
      kind: node.kind,
      filePath: node.filePath,
      parentId,
      branchType,
      startLine: node.startLine,
      endLine: node.endLine,
      diffStatus: nodeStatus.get(node.id) ?? "unchanged",
    };
  });

  const edges: ViewGraphEdge[] = graph.edges
    .filter((edge) => reactEdgeKinds.has(edge.kind) && reactNodeIds.has(edge.source) && reactNodeIds.has(edge.target))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      diffStatus: edgeStatus.get(edge.id) ?? "unchanged",
    }));

  const existingEdgeKeys = new Set(edges.map((edge) => `${edge.kind}:${edge.source}:${edge.target}`));
  const symbolNodes = reactNodes.filter((node) => reactKinds.has(node.kind));
  const symbolNodesByName = new Map<string, GraphNode[]>();
  for (const node of symbolNodes) {
    const bucket = symbolNodesByName.get(node.name) ?? [];
    bucket.push(node);
    symbolNodesByName.set(node.name, bucket);
  }

  for (const node of reactNodes) {
    if (node.kind !== "Branch") continue;
    const jsxTagNames = parseCsvList((node.metadata?.jsxTagNames as string | undefined) ?? "");
    if (jsxTagNames.length === 0) continue;

    for (const tagName of jsxTagNames) {
      const candidates = symbolNodesByName.get(tagName) ?? [];
      if (candidates.length === 0) continue;
      const sameFileCandidates = candidates.filter((candidate) => candidate.filePath === node.filePath);
      const targets = sameFileCandidates.length > 0 ? sameFileCandidates : candidates;

      for (const target of targets) {
        const edgeKey = `RENDERS:${node.id}:${target.id}`;
        if (existingEdgeKeys.has(edgeKey)) continue;
        existingEdgeKeys.add(edgeKey);
        const sourceStatus = nodeStatus.get(node.id) ?? "unchanged";
        const targetStatus = nodeStatus.get(target.id) ?? "unchanged";
        const diffStatus: DiffStatus = sourceStatus !== "unchanged" ? sourceStatus : targetStatus;

        edges.push({
          id: `react:jsx-render:${node.id}:${target.id}:${tagName}`,
          source: node.id,
          target: target.id,
          kind: "RENDERS",
          diffStatus,
        });
      }
    }
  }

  return {
    nodes: viewNodes,
    edges,
  };
};

export const buildReactView = (delta: GraphDelta): { oldGraph: ViewGraph; newGraph: ViewGraph } => {
  return {
    oldGraph: buildViewGraph(delta.oldGraph, delta.nodeStatus, delta.edgeStatus),
    newGraph: buildViewGraph(delta.newGraph, delta.nodeStatus, delta.edgeStatus),
  };
};
