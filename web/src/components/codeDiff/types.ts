export interface DiffLine {
  text: string;
  type: "same" | "added" | "removed" | "empty";
  lineNumber: number | null;
}

export interface DiffMatrixRow {
  old: DiffLine;
  new: DiffLine;
}
