import { useMemo } from "react";
import { observer, useLocalObservable } from "mobx-react-lite";
import type { FileDiffEntry } from "../types/graph";
import { FileListView } from "./fileList/FileListView";
import { FileListPanelStore } from "./fileList/store";

interface FileListPanelProps {
  files: FileDiffEntry[];
  selectedFilePath: string;
  onFileSelect: (path: string) => void;
}

export const FileListPanel = observer(({ files, selectedFilePath, onFileSelect }: FileListPanelProps) => {
  const store = useLocalObservable(() => new FileListPanelStore());

  const topRisk = useMemo(
    () => files.reduce((max, file) => Math.max(max, file.riskScore ?? 0), 0),
    [files],
  );

  return (
    <FileListView
      files={files}
      selectedFilePath={selectedFilePath}
      collapsed={store.collapsed}
      topRisk={topRisk}
      onToggleCollapsed={store.toggleCollapsed}
      onSelectFile={onFileSelect}
    />
  );
});
