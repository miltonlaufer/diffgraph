export type DiffStatus = "added" | "removed" | "modified" | "unchanged";

export interface ViewGraphNode {
  id: string;
  label: string;
  kind: string;
  diffStatus: DiffStatus;
  filePath: string;
  startLine?: number;
  parentId?: string;
  branchType?: string;
}

export interface ViewGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
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

export interface FileDiffEntry {
  path: string;
  hunks: string[];
  oldContent: string;
  newContent: string;
}

export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}
