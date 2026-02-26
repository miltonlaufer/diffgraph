import type { FileDiffEntry } from "../../types/graph";
import { FileListGrid } from "./FileListGrid";

interface FileListViewProps {
  files: FileDiffEntry[];
  selectedFilePath: string;
  selectedFilePathsForGraph: string[];
  selectedFileName: string;
  collapsed: boolean;
  topRisk: number;
  onToggleCollapsed: () => void;
  onSelectFile: (filePath: string) => void;
  onToggleFileForGraph: (filePath: string) => void;
}

const normalizePathForCompare = (p: string): string =>
  p.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");

export const FileListView = ({
  files,
  selectedFilePath,
  selectedFilePathsForGraph,
  selectedFileName,
  collapsed,
  topRisk,
  onToggleCollapsed,
  onSelectFile,
  onToggleFileForGraph,
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
        selectedFilePathsForGraph={selectedFilePathsForGraph}
        topRisk={topRisk}
        onSelectFile={onSelectFile}
        onToggleFileForGraph={onToggleFileForGraph}
        normalizePathForCompare={normalizePathForCompare}
      />
    )}
  </section>
);
