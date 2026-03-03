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

  const selectedFilesSummary = useMemo(() => {
    const basename = (p: string) => {
      const normalized = p.replaceAll("\\", "/");
      const parts = normalized.split("/").filter((part) => part.length > 0);
      return parts[parts.length - 1] ?? normalized;
    };
    const maxShow = 4;
    const paths =
      selectedFilePathsForGraph.length > 0
        ? selectedFilePathsForGraph
        : files.map((f) => f.path);
    if (paths.length === 0) return "";
    if (paths.length === 1) return basename(paths[0] ?? "");
    const shown = paths.slice(0, maxShow).map(basename);
    if (paths.length <= maxShow) return shown.join(", ");
    const remaining = paths.length - maxShow;
    return `${shown.join(", ")} + ${remaining} more file${remaining === 1 ? "" : "s"}`;
  }, [selectedFilePathsForGraph, files]);

  return (
    <FileListView
      files={files}
      selectedFilePath={selectedFilePath}
      selectedFilePathsForGraph={selectedFilePathsForGraph}
      selectedFilesSummary={selectedFilesSummary}
      collapsed={fileListCollapsed}
      topRisk={topRisk}
      onToggleCollapsed={actions.onToggleFileListCollapsed}
      onSelectFile={actions.onFileSelect}
      onFileHover={actions.onFileHover}
      onFileHoverClear={actions.onFileHoverClear}
      onToggleFileForGraph={actions.onToggleFileForGraph}
    />
  );
});
