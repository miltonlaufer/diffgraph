export type DiffStatus = "added" | "removed" | "modified" | "unchanged";

export interface ViewGraphNode {
  id: string;
  label: string;
  kind: string;
  diffStatus: DiffStatus;
  filePath: string;
  fileName?: string;
  className?: string;
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
  kind: string;
  relation?: "flow" | "invoke" | "hierarchy";
  diffStatus: DiffStatus;
}

export interface ViewGraph {
  nodes: ViewGraphNode[];
  edges: ViewGraphEdge[];
}

export interface SymbolDetail {
  symbolId: string;
  oldNode?: {
    id: string;
    name: string;
    kind: string;
    filePath: string;
  };
  newNode?: {
    id: string;
    name: string;
    kind: string;
    filePath: string;
  };
  hunks: string[];
}

export interface FileSymbol {
  name: string;
  kind: string;
  startLine: number;
  diffStatus: DiffStatus;
}

export interface FileDiffEntry {
  path: string;
  hunks: string[];
  oldContent: string;
  newContent: string;
  symbols: FileSymbol[];
}

export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}
