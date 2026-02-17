import { createContext, useContext } from "react";
import type { FileDiffEntry } from "#/types/graph";

interface ViewBaseRuntimeState {
  files: FileDiffEntry[];
  selectedFilePath: string;
  fileListCollapsed: boolean;
  hoveredCodeLine: number;
  hoveredCodeSide: "old" | "new";
  selectedFile: FileDiffEntry | null;
  targetLine: number;
  targetSide: "old" | "new";
  scrollTick: number;
  codeSearchNavDirection: "next" | "prev";
  codeSearchNavTick: number;
  codeLogicTreeRequestTick: number;
  codeLogicTreeRequestSide: "old" | "new";
  codeLogicTreeRequestLines: number[];
}

interface ViewBaseRuntimeActions {
  onFileSelect: (filePath: string) => void;
  onToggleFileListCollapsed: () => void;
  onCodeLineClick: (line: number, side: "old" | "new") => void;
  onCodeLineHover: (line: number, side: "old" | "new") => void;
  onCodeLineHoverClear: () => void;
  onCodeLineDoubleClick: (line: number, side: "old" | "new", word: string) => void;
  onCodeSearchStateChange: (active: boolean) => void;
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
