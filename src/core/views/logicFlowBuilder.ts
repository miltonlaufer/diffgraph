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
  const functionNodeIds = new Set(allLogicNodes.filter((n) => functionKinds.has(n.kind)).map((n) => n.id));
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
      functionParams: (node.metadata?.paramsFull as string | undefined) ?? (node.metadata?.params as string | undefined),
      returnType: (node.metadata?.returnType as string | undefined) ?? undefined,
      documentation: (node.metadata?.documentation as string | undefined) ?? undefined,
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
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const normalizeSymbolName = (value: string): string =>
    value
      .replace(/\(\)$/g, "")
      .replace(/\?\./g, ".")
      .split(".")
      .at(-1)
      ?.trim() ?? value.trim();

  const resolveOwnerFunctionId = (nodeId: string): string | undefined => {
    let current = parentMap.get(nodeId);
    while (current) {
      if (functionNodeIds.has(current.id)) {
        return current.id;
      }
      current = parentMap.get(current.id);
    }
    return undefined;
  };

  const callBranchesByOwner = new Map<string, GraphNode[]>();
  for (const node of allLogicNodes) {
    if (node.kind !== "Branch") continue;
    if ((node.metadata?.branchType as string) !== "call") continue;
    const ownerFnId = resolveOwnerFunctionId(node.id);
    if (!ownerFnId) continue;
    if (!callBranchesByOwner.has(ownerFnId)) {
      callBranchesByOwner.set(ownerFnId, []);
    }
    callBranchesByOwner.get(ownerFnId)!.push(node);
  }

  const invokeEdgeStatus = new Map<string, ViewGraphNode["diffStatus"]>();
  const functionNodes = allLogicNodes.filter((n) => functionKinds.has(n.kind));
  const functionNodesByName = new Map<string, GraphNode[]>();
  for (const fn of functionNodes) {
    const key = normalizeSymbolName(fn.name);
    if (!functionNodesByName.has(key)) {
      functionNodesByName.set(key, []);
    }
    functionNodesByName.get(key)!.push(fn);
  }
  const invokeEdges = graph.edges.filter((e) => {
    if (e.kind !== "CALLS") return false;
    const sourceNode = nodeById.get(e.source);
    const targetNode = nodeById.get(e.target);
    return Boolean(sourceNode && targetNode && functionKinds.has(sourceNode.kind) && functionKinds.has(targetNode.kind));
  });
  for (const e of invokeEdges) {
    invokeEdgeStatus.set(e.id, (edgeStatus.get(e.id) ?? "unchanged") as ViewGraphNode["diffStatus"]);
  }

  const edges: ViewGraph["edges"] = graph.edges
    .filter((e) => logicEdgeKinds.has(e.kind) && viewNodeIds.has(e.source) && viewNodeIds.has(e.target))
    .filter((e) => {
      if (e.kind !== "CALLS") return true;
      const sourceNode = nodeById.get(e.source);
      const targetNode = nodeById.get(e.target);
      if (!sourceNode || !targetNode) return true;
      return !(functionKinds.has(sourceNode.kind) && functionKinds.has(targetNode.kind));
    })
    .map((e) => {
      const relation: "flow" | "invoke" | "hierarchy" =
        e.kind === "DECLARES"
          ? "hierarchy"
          : "flow";
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        kind: e.kind,
        relation,
        diffStatus: (edgeStatus.get(e.id) ?? "unchanged") as ViewGraphNode["diffStatus"],
      };
    });

  for (const e of invokeEdges) {
    const targetNode = nodeById.get(e.target);
    if (!targetNode) continue;
    const targetName = normalizeSymbolName(targetNode.name);
    const sourceCallBranches = callBranchesByOwner.get(e.source) ?? [];
    const matchingCallBranch = sourceCallBranches.find((branch) => {
      const callee = (branch.metadata?.callee as string | undefined) ?? "";
      if (!callee) return false;
      return normalizeSymbolName(callee) === targetName;
    });
    const sourceId = matchingCallBranch?.id ?? e.source;
    if (!viewNodeIds.has(sourceId) || !viewNodeIds.has(e.target)) continue;
    edges.push({
      id: `${e.id}:logic-invoke:${sourceId}:${e.target}`,
      source: sourceId,
      target: e.target,
      kind: e.kind,
      relation: "invoke",
      diffStatus: invokeEdgeStatus.get(e.id) ?? "unchanged",
    });
  }

  const existingInvokeKeys = new Set(
    edges
      .filter((e) => e.relation === "invoke")
      .map((e) => `${e.source}->${e.target}`),
  );

  /* Fallback: connect call branch -> function by callee name when CALLS symbol edge is missing. */
  for (const branches of callBranchesByOwner.values()) {
    for (const branch of branches) {
      const calleeRaw = (branch.metadata?.callee as string | undefined) ?? "";
      if (!calleeRaw) continue;
      const nameKey = normalizeSymbolName(calleeRaw);
      const candidates = functionNodesByName.get(nameKey) ?? [];
      if (candidates.length === 0) continue;

      const sameFileCandidates = candidates.filter((fn) => fn.filePath === branch.filePath);
      const chosenTargets =
        sameFileCandidates.length > 0
          ? sameFileCandidates
          : candidates.length === 1
            ? candidates
            : [];

      for (const target of chosenTargets) {
        if (!viewNodeIds.has(branch.id) || !viewNodeIds.has(target.id)) continue;
        const edgeKey = `${branch.id}->${target.id}`;
        if (existingInvokeKeys.has(edgeKey)) continue;
        existingInvokeKeys.add(edgeKey);
        edges.push({
          id: `logic-fallback-invoke:${branch.id}:${target.id}`,
          source: branch.id,
          target: target.id,
          kind: "CALLS",
          relation: "invoke",
          diffStatus: (nodeStatus.get(branch.id) ?? "unchanged") as ViewGraphNode["diffStatus"],
        });
      }

    }
  }

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
