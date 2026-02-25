import type { FileDiffEntry } from "../../types/graph";
import { FileListGrid } from "./FileListGrid";

interface FileListViewProps {
  files: FileDiffEntry[];
  selectedFilePath: string;
  selectedFileName: string;
  collapsed: boolean;
  topRisk: number;
  onToggleCollapsed: () => void;
  onSelectFile: (filePath: string) => void;
}

export const FileListView = ({
  files,
  selectedFilePath,
  selectedFileName,
  collapsed,
  topRisk,
  onToggleCollapsed,
  onSelectFile,
}: FileListViewProps) => (
  <section className="fileListPanel">
    <button type="button" className="fileListToggle" onClick={onToggleCollapsed}>
      <span className={collapsed ? "toggleArrow collapsed" : "toggleArrow"}>&#9660;</span>
      Changed Files ({files.length})
      {collapsed && selectedFileName && (
        <>
          {" - Selected: "}
          <strong>{selectedFileName}</strong>
        </>
      )}
    </button>
    {!collapsed && (
      <FileListGrid
        files={files}
        selectedFilePath={selectedFilePath}
        topRisk={topRisk}
        onSelectFile={onSelectFile}
      />
    )}
  </section>
);
