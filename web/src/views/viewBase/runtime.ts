import { createContext, useContext } from "react";
import type { FileDiffEntry } from "../../types/graph";

interface ViewBaseRuntimeState {
  files: FileDiffEntry[];
  selectedFilePath: string;
  selectedFile: FileDiffEntry | null;
  targetLine: number;
  targetSide: "old" | "new";
  scrollTick: number;
}

interface ViewBaseRuntimeActions {
  onFileSelect: (filePath: string) => void;
  onCodeLineClick: (line: number, side: "old" | "new") => void;
}

export interface ViewBaseRuntimeContextValue {
  state: ViewBaseRuntimeState;
  actions: ViewBaseRuntimeActions;
}

const ViewBaseRuntimeContext = createContext<ViewBaseRuntimeContextValue | null>(null);

export const ViewBaseRuntimeProvider = ViewBaseRuntimeContext.Provider;

export const useViewBaseRuntime = (): ViewBaseRuntimeContextValue => {
  const value = useContext(ViewBaseRuntimeContext);
  if (!value) {
    throw new Error("useViewBaseRuntime must be used inside ViewBaseRuntimeProvider");
  }
  return value;
};
