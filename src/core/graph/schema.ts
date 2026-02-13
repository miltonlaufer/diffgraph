export type GraphNodeKind =
  | "File"
  | "Module"
  | "Class"
  | "Function"
  | "Method"
  | "Branch"
  | "Endpoint"
  | "Controller"
  | "Service"
  | "ReactComponent"
  | "Hook";

export type GraphEdgeKind =
  | "IMPORTS"
  | "DECLARES"
  | "CALLS"
  | "EXTENDS"
  | "IMPLEMENTS"
  | "RENDERS"
  | "USES_HOOK"
  | "EXPOSES_ENDPOINT";

export type DiffStatus = "added" | "removed" | "modified" | "unchanged";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  name: string;
  qualifiedName: string;
  filePath: string;
  language: "ts" | "js" | "py" | "unknown";
  startLine?: number;
  endLine?: number;
  signatureHash?: string;
  metadata?: Record<string, string | number | boolean>;
  snapshotId: string;
  ref: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
  filePath?: string;
  metadata?: Record<string, string | number | boolean>;
  snapshotId: string;
  ref: string;
}

export interface SnapshotGraph {
  repoId: string;
  snapshotId: string;
  ref: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ViewGraphNode {
  id: string;
  label: string;
  kind: GraphNodeKind | "group";
  diffStatus: DiffStatus;
  filePath: string;
  startLine?: number;
  endLine?: number;
  parentId?: string;
  branchType?: string;
  functionParams?: string;
  returnType?: string;
  documentation?: string;
}

export interface ViewGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
  relation?: "flow" | "invoke" | "hierarchy";
  diffStatus: DiffStatus;
}

export interface ViewGraph {
  nodes: ViewGraphNode[];
  edges: ViewGraphEdge[];
}

export interface SymbolDiffDetail {
  symbolId: string;
  oldNode?: GraphNode;
  newNode?: GraphNode;
  hunks: string[];
}
