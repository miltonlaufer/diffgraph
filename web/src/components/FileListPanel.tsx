import { useMemo } from "react";
import { observer } from "mobx-react-lite";
import { FileListView } from "./fileList/FileListView";
import { useViewBaseRuntime } from "../views/viewBase/runtime";

export const FileListPanel = observer(() => {
  const { state, actions } = useViewBaseRuntime();
  const { files, selectedFilePath, selectedFilePathsForGraph, fileListCollapsed } = state;

  const topRisk = useMemo(
    () => files.reduce((max, file) => Math.max(max, file.riskScore ?? 0), 0),
    [files],
  );

  const selectedFileName = useMemo(() => {
    if (!selectedFilePath) return "";
    const normalized = selectedFilePath.replaceAll("\\", "/");
    const parts = normalized.split("/").filter((part) => part.length > 0);
    return parts[parts.length - 1] ?? normalized;
  }, [selectedFilePath]);

  return (
    <FileListView
      files={files}
      selectedFilePath={selectedFilePath}
      selectedFilePathsForGraph={selectedFilePathsForGraph}
      selectedFileName={selectedFileName}
      collapsed={fileListCollapsed}
      topRisk={topRisk}
      onToggleCollapsed={actions.onToggleFileListCollapsed}
      onSelectFile={actions.onFileSelect}
      onToggleFileForGraph={actions.onToggleFileForGraph}
    />
  );
});
