import { useMemo } from "react";
import { observer, useLocalObservable } from "mobx-react-lite";
import { FileListView } from "./fileList/FileListView";
import { FileListPanelStore } from "./fileList/store";
import { useViewBaseRuntime } from "../views/viewBase/runtime";

export const FileListPanel = observer(() => {
  const { state, actions } = useViewBaseRuntime();
  const { files, selectedFilePath } = state;
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
      onSelectFile={actions.onFileSelect}
    />
  );
});
