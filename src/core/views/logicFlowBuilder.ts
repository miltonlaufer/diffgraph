import type { GraphDelta } from "../diff/graphDelta.js";
import type {
  FunctionParameterDiffEntry,
  GraphNode,
  SnapshotGraph,
  ViewGraph,
  ViewGraphNode,
} from "../graph/schema.js";

const functionKinds = new Set(["Function", "Method", "ReactComponent", "Hook"]);
const logicKinds = new Set(["Function", "Method", "ReactComponent", "Hook", "Branch"]);
const logicEdgeKinds = new Set(["CALLS", "DECLARES"]);

const kindBadge: Record<string, string> = {
  ReactComponent: "Component",
  Hook: "Hook",
  Function: "Fn",
  Method: "Method",
};

const fileNameFromPath = (filePath: string): string => {
  const normalized = filePath.replaceAll("\\", "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? normalized;
};

const deepCallbackLineSuffix = /@\d+$/;

const normalizeDeepQualifiedName = (qualifiedName: string): string => {
  if (qualifiedName.includes(".deep.")) {
    return qualifiedName.replace(deepCallbackLineSuffix, "");
  }
  return qualifiedName;
};

const functionNodeMatchKey = (node: GraphNode): string =>
  `${normalizeDeepQualifiedName(node.qualifiedName)}:${node.kind}`;

const sortNodesForMatch = (nodes: GraphNode[]): GraphNode[] =>
  [...nodes].sort(
    (a, b) =>
      (a.startLine ?? Number.MAX_SAFE_INTEGER) - (b.startLine ?? Number.MAX_SAFE_INTEGER) ||
      (a.endLine ?? Number.MAX_SAFE_INTEGER) - (b.endLine ?? Number.MAX_SAFE_INTEGER) ||
      a.id.localeCompare(b.id),
  );

const signatureKey = (node: GraphNode): string => node.signatureHash ?? "__missing_signature__";

const functionParamsFromMetadata = (node: GraphNode): string =>
  ((node.metadata?.paramsFull as string | undefined) ?? (node.metadata?.params as string | undefined) ?? "").trim();

const hookDependenciesFromMetadata = (node: GraphNode): string =>
  ((node.metadata?.hookDependencies as string | undefined) ?? "").trim();

const splitTopLevel = (value: string, delimiter: "," | ":" | "="): string[] => {
  const result: string[] = [];
  let current = "";
  let inQuote: "'" | "\"" | "`" | null = null;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let angleDepth = 0;

  for (let idx = 0; idx < value.length; idx += 1) {
    const ch = value[idx];
    const prev = idx > 0 ? value[idx - 1] : "";

    if (inQuote) {
      current += ch;
      if (ch === inQuote && prev !== "\\") {
        inQuote = null;
      }
      continue;
    }

    if (ch === "'" || ch === "\"" || ch === "`") {
      inQuote = ch as "'" | "\"" | "`";
      current += ch;
      continue;
    }

    if (ch === "(") parenDepth += 1;
    if (ch === ")" && parenDepth > 0) parenDepth -= 1;
    if (ch === "{") braceDepth += 1;
    if (ch === "}" && braceDepth > 0) braceDepth -= 1;
    if (ch === "[") bracketDepth += 1;
    if (ch === "]" && bracketDepth > 0) bracketDepth -= 1;
    if (ch === "<") angleDepth += 1;
    if (ch === ">" && angleDepth > 0) angleDepth -= 1;

    if (
      ch === delimiter
      && parenDepth === 0
      && braceDepth === 0
      && bracketDepth === 0
      && angleDepth === 0
    ) {
      result.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  result.push(current.trim());
  return result;
};

const firstTopLevelIndex = (value: string, delimiter: ":" | "="): number => {
  let inQuote: "'" | "\"" | "`" | null = null;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let angleDepth = 0;

  for (let idx = 0; idx < value.length; idx += 1) {
    const ch = value[idx];
    const prev = idx > 0 ? value[idx - 1] : "";
    if (inQuote) {
      if (ch === inQuote && prev !== "\\") {
        inQuote = null;
      }
      continue;
    }
    if (ch === "'" || ch === "\"" || ch === "`") {
      inQuote = ch as "'" | "\"" | "`";
      continue;
    }
    if (ch === "(") parenDepth += 1;
    if (ch === ")" && parenDepth > 0) parenDepth -= 1;
    if (ch === "{") braceDepth += 1;
    if (ch === "}" && braceDepth > 0) braceDepth -= 1;
    if (ch === "[") bracketDepth += 1;
    if (ch === "]" && bracketDepth > 0) bracketDepth -= 1;
    if (ch === "<") angleDepth += 1;
    if (ch === ">" && angleDepth > 0) angleDepth -= 1;

    if (
      ch === delimiter
      && parenDepth === 0
      && braceDepth === 0
      && bracketDepth === 0
      && angleDepth === 0
    ) {
      return idx;
    }
  }

  return -1;
};

const normalizeParamType = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

const normalizeParamKey = (value: string): string => {
  const withoutPrefix = value.trim().replace(/^\.\.\./, "").replace(/\?$/, "").trim();
  if (withoutPrefix.length === 0) return "";
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(withoutPrefix)) {
    return withoutPrefix;
  }
  return withoutPrefix.replace(/\s+/g, "");
};

interface ParsedParameter {
  index: number;
  text: string;
  key: string;
  normalizedType: string;
}

interface ParsedDependency {
  index: number;
  text: string;
  normalized: string;
}

const parseParameters = (paramsRaw: string): ParsedParameter[] => {
  const trimmed = paramsRaw.trim();
  if (trimmed.length === 0 || trimmed === "()") return [];
  const body = trimmed.startsWith("(") && trimmed.endsWith(")")
    ? trimmed.slice(1, -1).trim()
    : trimmed;
  if (body.length === 0) return [];

  const items = splitTopLevel(body, ",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return items.map((text, index) => {
    const assignmentIndex = firstTopLevelIndex(text, "=");
    const definition = assignmentIndex >= 0 ? text.slice(0, assignmentIndex).trim() : text;
    const typeSeparatorIndex = firstTopLevelIndex(definition, ":");
    const declaration = typeSeparatorIndex >= 0 ? definition.slice(0, typeSeparatorIndex).trim() : definition;
    const typeText = typeSeparatorIndex >= 0 ? definition.slice(typeSeparatorIndex + 1).trim() : "";
    const key = normalizeParamKey(declaration) || declaration.replace(/\s+/g, "") || text.replace(/\s+/g, "");
    return {
      index,
      text,
      key,
      normalizedType: normalizeParamType(typeText),
    };
  });
};

const parseDependencies = (dependenciesRaw: string): ParsedDependency[] => {
  const trimmed = dependenciesRaw.trim();
  if (trimmed.length === 0) return [];
  const body = trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1).trim()
    : trimmed;
  if (body.length === 0) return [];
  return splitTopLevel(body, ",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry, index) => ({
      index,
      text: entry,
      normalized: entry.replace(/\s+/g, ""),
    }));
};

const diffParameters = (
  oldParamsRaw: string,
  newParamsRaw: string,
): { oldDiff: FunctionParameterDiffEntry[]; newDiff: FunctionParameterDiffEntry[] } => {
  const oldParams = parseParameters(oldParamsRaw);
  const newParams = parseParameters(newParamsRaw);

  const oldDiff: FunctionParameterDiffEntry[] = oldParams.map((param) => ({
    text: param.text,
    status: "unchanged",
  }));
  const newDiff: FunctionParameterDiffEntry[] = newParams.map((param) => ({
    text: param.text,
    status: "unchanged",
  }));

  const oldByKey = new Map<string, ParsedParameter[]>();
  const newByKey = new Map<string, ParsedParameter[]>();
  for (const param of oldParams) {
    if (!oldByKey.has(param.key)) oldByKey.set(param.key, []);
    oldByKey.get(param.key)!.push(param);
  }
  for (const param of newParams) {
    if (!newByKey.has(param.key)) newByKey.set(param.key, []);
    newByKey.get(param.key)!.push(param);
  }

  const allKeys = new Set([...oldByKey.keys(), ...newByKey.keys()]);
  for (const key of allKeys) {
    const oldList = oldByKey.get(key) ?? [];
    const newList = newByKey.get(key) ?? [];
    const pairCount = Math.min(oldList.length, newList.length);

    for (let idx = 0; idx < pairCount; idx += 1) {
      const oldParam = oldList[idx];
      const newParam = newList[idx];
      const changedType = oldParam.normalizedType !== newParam.normalizedType;
      const status = changedType ? "modified" : "unchanged";
      oldDiff[oldParam.index] = { text: oldParam.text, status };
      newDiff[newParam.index] = { text: newParam.text, status };
    }

    for (const oldParam of oldList.slice(pairCount)) {
      oldDiff[oldParam.index] = { text: oldParam.text, status: "removed" };
    }
    for (const newParam of newList.slice(pairCount)) {
      newDiff[newParam.index] = { text: newParam.text, status: "added" };
    }
  }

  return { oldDiff, newDiff };
};

const diffDependencies = (
  oldDependenciesRaw: string,
  newDependenciesRaw: string,
): { oldDiff: FunctionParameterDiffEntry[]; newDiff: FunctionParameterDiffEntry[] } => {
  const oldDependencies = parseDependencies(oldDependenciesRaw);
  const newDependencies = parseDependencies(newDependenciesRaw);
  const oldDiff: FunctionParameterDiffEntry[] = oldDependencies.map((dependency) => ({
    text: dependency.text,
    status: "unchanged",
  }));
  const newDiff: FunctionParameterDiffEntry[] = newDependencies.map((dependency) => ({
    text: dependency.text,
    status: "unchanged",
  }));

  const oldByNormalized = new Map<string, ParsedDependency[]>();
  const newByNormalized = new Map<string, ParsedDependency[]>();
  for (const dependency of oldDependencies) {
    if (!oldByNormalized.has(dependency.normalized)) oldByNormalized.set(dependency.normalized, []);
    oldByNormalized.get(dependency.normalized)!.push(dependency);
  }
  for (const dependency of newDependencies) {
    if (!newByNormalized.has(dependency.normalized)) newByNormalized.set(dependency.normalized, []);
    newByNormalized.get(dependency.normalized)!.push(dependency);
  }

  const allKeys = new Set([...oldByNormalized.keys(), ...newByNormalized.keys()]);
  const unmatchedOld: ParsedDependency[] = [];
  const unmatchedNew: ParsedDependency[] = [];

  for (const key of allKeys) {
    const oldList = oldByNormalized.get(key) ?? [];
    const newList = newByNormalized.get(key) ?? [];
    const pairCount = Math.min(oldList.length, newList.length);
    for (let idx = 0; idx < pairCount; idx += 1) {
      const oldDependency = oldList[idx];
      const newDependency = newList[idx];
      oldDiff[oldDependency.index] = { text: oldDependency.text, status: "unchanged" };
      newDiff[newDependency.index] = { text: newDependency.text, status: "unchanged" };
    }
    unmatchedOld.push(...oldList.slice(pairCount));
    unmatchedNew.push(...newList.slice(pairCount));
  }

  const modifiedPairs = Math.min(unmatchedOld.length, unmatchedNew.length);
  for (let idx = 0; idx < modifiedPairs; idx += 1) {
    const oldDependency = unmatchedOld[idx];
    const newDependency = unmatchedNew[idx];
    oldDiff[oldDependency.index] = { text: oldDependency.text, status: "modified" };
    newDiff[newDependency.index] = { text: newDependency.text, status: "modified" };
  }
  for (const oldDependency of unmatchedOld.slice(modifiedPairs)) {
    oldDiff[oldDependency.index] = { text: oldDependency.text, status: "removed" };
  }
  for (const newDependency of unmatchedNew.slice(modifiedPairs)) {
    newDiff[newDependency.index] = { text: newDependency.text, status: "added" };
  }

  return { oldDiff, newDiff };
};

const groupFunctionNodesByKey = (graph: SnapshotGraph): Map<string, GraphNode[]> => {
  const grouped = new Map<string, GraphNode[]>();
  for (const node of graph.nodes) {
    if (!functionKinds.has(node.kind)) continue;
    const key = functionNodeMatchKey(node);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(node);
  }
  return grouped;
};

const computeFunctionDetailDiffByNodeId = (
  delta: GraphDelta,
): {
  oldParamByNodeId: Map<string, FunctionParameterDiffEntry[]>;
  newParamByNodeId: Map<string, FunctionParameterDiffEntry[]>;
  oldHookDepsByNodeId: Map<string, FunctionParameterDiffEntry[]>;
  newHookDepsByNodeId: Map<string, FunctionParameterDiffEntry[]>;
} => {
  const oldParamByNodeId = new Map<string, FunctionParameterDiffEntry[]>();
  const newParamByNodeId = new Map<string, FunctionParameterDiffEntry[]>();
  const oldHookDepsByNodeId = new Map<string, FunctionParameterDiffEntry[]>();
  const newHookDepsByNodeId = new Map<string, FunctionParameterDiffEntry[]>();
  const oldByKey = groupFunctionNodesByKey(delta.oldGraph);
  const newByKey = groupFunctionNodesByKey(delta.newGraph);
  const allKeys = new Set([...oldByKey.keys(), ...newByKey.keys()]);

  for (const key of allKeys) {
    const oldNodes = sortNodesForMatch(oldByKey.get(key) ?? []);
    const newNodes = sortNodesForMatch(newByKey.get(key) ?? []);

    const matchedOld = new Set<string>();
    const matchedNew = new Set<string>();
    const newBySignature = new Map<string, GraphNode[]>();
    for (const node of newNodes) {
      const sig = signatureKey(node);
      if (!newBySignature.has(sig)) newBySignature.set(sig, []);
      newBySignature.get(sig)!.push(node);
    }

    const pickMatch = (bucket: GraphNode[], oldNode: GraphNode): GraphNode | undefined => {
      const samePosition = bucket.find(
        (candidate) =>
          (candidate.startLine ?? -1) === (oldNode.startLine ?? -1)
          && (candidate.endLine ?? -1) === (oldNode.endLine ?? -1),
      );
      if (samePosition) {
        const index = bucket.indexOf(samePosition);
        bucket.splice(index, 1);
        return samePosition;
      }
      return bucket.shift();
    };

    for (const oldNode of oldNodes) {
      const bucket = newBySignature.get(signatureKey(oldNode));
      const match = bucket ? pickMatch(bucket, oldNode) : undefined;
      if (!match) continue;
      matchedOld.add(oldNode.id);
      matchedNew.add(match.id);
      const paramDiff = diffParameters(functionParamsFromMetadata(oldNode), functionParamsFromMetadata(match));
      if (paramDiff.oldDiff.length > 0) oldParamByNodeId.set(oldNode.id, paramDiff.oldDiff);
      if (paramDiff.newDiff.length > 0) newParamByNodeId.set(match.id, paramDiff.newDiff);
      const hookDependencyDiff = diffDependencies(hookDependenciesFromMetadata(oldNode), hookDependenciesFromMetadata(match));
      if (hookDependencyDiff.oldDiff.length > 0) oldHookDepsByNodeId.set(oldNode.id, hookDependencyDiff.oldDiff);
      if (hookDependencyDiff.newDiff.length > 0) newHookDepsByNodeId.set(match.id, hookDependencyDiff.newDiff);
    }

    const unmatchedOld = oldNodes.filter((node) => !matchedOld.has(node.id));
    const unmatchedNew = newNodes.filter((node) => !matchedNew.has(node.id));
    const modifiedPairs = Math.min(unmatchedOld.length, unmatchedNew.length);

    for (let index = 0; index < modifiedPairs; index += 1) {
      const oldNode = unmatchedOld[index];
      const newNode = unmatchedNew[index];
      const paramDiff = diffParameters(functionParamsFromMetadata(oldNode), functionParamsFromMetadata(newNode));
      if (paramDiff.oldDiff.length > 0) oldParamByNodeId.set(oldNode.id, paramDiff.oldDiff);
      if (paramDiff.newDiff.length > 0) newParamByNodeId.set(newNode.id, paramDiff.newDiff);
      const hookDependencyDiff = diffDependencies(hookDependenciesFromMetadata(oldNode), hookDependenciesFromMetadata(newNode));
      if (hookDependencyDiff.oldDiff.length > 0) oldHookDepsByNodeId.set(oldNode.id, hookDependencyDiff.oldDiff);
      if (hookDependencyDiff.newDiff.length > 0) newHookDepsByNodeId.set(newNode.id, hookDependencyDiff.newDiff);
    }

    for (const oldNode of unmatchedOld.slice(modifiedPairs)) {
      const removed = parseParameters(functionParamsFromMetadata(oldNode)).map((param) => ({
        text: param.text,
        status: "removed" as const,
      }));
      if (removed.length > 0) oldParamByNodeId.set(oldNode.id, removed);
      const removedDependencies = parseDependencies(hookDependenciesFromMetadata(oldNode)).map((dependency) => ({
        text: dependency.text,
        status: "removed" as const,
      }));
      if (removedDependencies.length > 0) oldHookDepsByNodeId.set(oldNode.id, removedDependencies);
    }

    for (const newNode of unmatchedNew.slice(modifiedPairs)) {
      const added = parseParameters(functionParamsFromMetadata(newNode)).map((param) => ({
        text: param.text,
        status: "added" as const,
      }));
      if (added.length > 0) newParamByNodeId.set(newNode.id, added);
      const addedDependencies = parseDependencies(hookDependenciesFromMetadata(newNode)).map((dependency) => ({
        text: dependency.text,
        status: "added" as const,
      }));
      if (addedDependencies.length > 0) newHookDepsByNodeId.set(newNode.id, addedDependencies);
    }
  }

  return { oldParamByNodeId, newParamByNodeId, oldHookDepsByNodeId, newHookDepsByNodeId };
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
  functionParamDiffByNodeId: Map<string, FunctionParameterDiffEntry[]>,
  hookDependencyDiffByNodeId: Map<string, FunctionParameterDiffEntry[]>,
): ViewGraph => {
  const allLogicNodes = graph.nodes.filter((n) => logicKinds.has(n.kind));
  const classNodes = graph.nodes.filter((n) => n.kind === "Class");
  const logicNodeIds = new Set(allLogicNodes.map((n) => n.id));
  const functionNodeIds = new Set(allLogicNodes.filter((n) => functionKinds.has(n.kind)).map((n) => n.id));
  const viewNodes: ViewGraphNode[] = [];
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const classNodeByFileAndName = new Map(classNodes.map((n) => [`${n.filePath}:${n.name}`, n]));

  const findOwningClassNode = (node: GraphNode): GraphNode | undefined => {
    let current = parentMap.get(node.id);
    while (current) {
      if (current.kind === "Class") return current;
      current = parentMap.get(current.id);
    }

    if (node.language !== "py") return undefined;

    const colonIndex = node.qualifiedName.indexOf(":");
    const symbolPath = colonIndex >= 0 ? node.qualifiedName.slice(colonIndex + 1) : node.qualifiedName;
    const lastDot = symbolPath.lastIndexOf(".");
    if (lastDot <= 0) return undefined;
    const candidateClassName = symbolPath.slice(0, lastDot);
    const classNode = classNodeByFileAndName.get(`${node.filePath}:${candidateClassName}`);
    if (!classNode) return undefined;

    const startLine = node.startLine ?? Number.MAX_SAFE_INTEGER;
    const classStart = classNode.startLine ?? 0;
    const classEnd = classNode.endLine ?? Number.MAX_SAFE_INTEGER;
    if (startLine < classStart || startLine > classEnd) return undefined;
    return classNode;
  };

  const findOwningClassName = (node: GraphNode): string | undefined => {
    const owningClass = findOwningClassNode(node);
    if (owningClass) return owningClass.name;
    return undefined;
  };

  const classIdsWithChildren = new Set<string>();
  const functionParentById = new Map<string, string | undefined>();
  for (const node of allLogicNodes) {
    if (!functionKinds.has(node.kind)) continue;
    const parentFn = parentMap.get(node.id);
    if (parentFn && functionKinds.has(parentFn.kind) && logicNodeIds.has(parentFn.id)) {
      functionParentById.set(node.id, parentFn.id);
      continue;
    }
    const owningClass = findOwningClassNode(node);
    if (owningClass) {
      functionParentById.set(node.id, owningClass.id);
      classIdsWithChildren.add(owningClass.id);
      continue;
    }
    functionParentById.set(node.id, undefined);
  }

  const classParentById = new Map<string, string | undefined>();
  const resolveClassParentId = (classNode: GraphNode): string | undefined => {
    if (classParentById.has(classNode.id)) {
      return classParentById.get(classNode.id);
    }
    let current = parentMap.get(classNode.id);
    while (current) {
      if (current.kind === "Class" && classIdsWithChildren.has(current.id)) {
        classParentById.set(classNode.id, current.id);
        return current.id;
      }
      current = parentMap.get(current.id);
    }
    classParentById.set(classNode.id, undefined);
    return undefined;
  };

  for (const classNode of classNodes) {
    if (!classIdsWithChildren.has(classNode.id)) continue;
    viewNodes.push({
      id: classNode.id,
      label: `[Class] ${classNode.name}`,
      kind: "group",
      diffStatus: (nodeStatus.get(classNode.id) ?? "unchanged") as ViewGraphNode["diffStatus"],
      filePath: classNode.filePath,
      fileName: fileNameFromPath(classNode.filePath),
      className: classNode.name,
      startLine: classNode.startLine,
      endLine: classNode.endLine,
      parentId: resolveClassParentId(classNode),
    });
  }

  /* Emit function/method/hook/component nodes as group containers */
  for (const node of allLogicNodes) {
    if (!functionKinds.has(node.kind)) {
      continue;
    }
    const badge = kindBadge[node.kind] ?? node.kind;
    const wrappedBy = (node.metadata?.wrappedBy as string | undefined) ?? "";
    const hookDependencies = (node.metadata?.hookDependencies as string | undefined) ?? "";
    const wrapperSuffix = wrappedBy.length > 0
      ? ` [${wrappedBy}${hookDependencies.length > 0 ? ` deps: ${hookDependencies}` : ""}]`
      : "";
    const label = `[${badge}] ${node.name}${wrapperSuffix}`;

    viewNodes.push({
      id: node.id,
      label,
      kind: "group",
      diffStatus: (nodeStatus.get(node.id) ?? "unchanged") as ViewGraphNode["diffStatus"],
      filePath: node.filePath,
      fileName: fileNameFromPath(node.filePath),
      className: findOwningClassName(node),
      startLine: node.startLine,
      endLine: node.endLine,
      parentId: functionParentById.get(node.id),
      functionParams: (node.metadata?.paramsFull as string | undefined) ?? (node.metadata?.params as string | undefined),
      functionParamDiff: functionParamDiffByNodeId.get(node.id),
      hookDependencies,
      hookDependencyDiff: hookDependencyDiffByNodeId.get(node.id),
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
      const sourceNode = nodeById.get(e.source);
      const targetNode = nodeById.get(e.target);
      const branchToFunctionInvoke = e.kind === "CALLS"
        && sourceNode?.kind === "Branch"
        && Boolean(targetNode && functionKinds.has(targetNode.kind));
      const relation: "flow" | "invoke" | "hierarchy" =
        e.kind === "DECLARES"
          ? "hierarchy"
          : branchToFunctionInvoke
            ? "invoke"
            : "flow";
      const rawFlowType = (e.metadata?.flowType as string | undefined) ?? "";
      const flowType: "true" | "false" | "next" | undefined =
        rawFlowType === "true" || rawFlowType === "false" || rawFlowType === "next"
          ? rawFlowType
          : undefined;
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        kind: e.kind,
        relation,
        flowType,
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
  const functionDetailDiff = computeFunctionDetailDiffByNodeId(delta);

  return {
    oldGraph: buildViewGraph(
      delta.oldGraph,
      oldParentMap,
      delta.nodeStatus,
      delta.edgeStatus,
      functionDetailDiff.oldParamByNodeId,
      functionDetailDiff.oldHookDepsByNodeId,
    ),
    newGraph: buildViewGraph(
      delta.newGraph,
      newParentMap,
      delta.nodeStatus,
      delta.edgeStatus,
      functionDetailDiff.newParamByNodeId,
      functionDetailDiff.newHookDepsByNodeId,
    ),
  };
};
