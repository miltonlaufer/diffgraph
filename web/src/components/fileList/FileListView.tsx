import type { FileDiffEntry } from "../../types/graph";

interface FileListViewProps {
  files: FileDiffEntry[];
  selectedFilePath: string;
  collapsed: boolean;
  topRisk: number;
  onToggleCollapsed: () => void;
  onSelectFile: (filePath: string) => void;
}

export const FileListView = ({
  files,
  selectedFilePath,
  collapsed,
  topRisk,
  onToggleCollapsed,
  onSelectFile,
}: FileListViewProps) => (
  <section className="fileListPanel">
    <button type="button" className="fileListToggle" onClick={onToggleCollapsed}>
      <span className={collapsed ? "toggleArrow collapsed" : "toggleArrow"}>&#9660;</span>
      Changed Files ({files.length})
    </button>
    {!collapsed && (
      <div className="fileListGrid">
        {files.map((entry) => (
          <button
            key={entry.path}
            type="button"
            onClick={() => onSelectFile(entry.path)}
            className={entry.path === selectedFilePath ? "filePill filePillActive" : "filePill"}
          >
            <span className="filePillPath">
              {entry.changeType === "renamed" && entry.oldPath && entry.newPath
                ? `${entry.oldPath} -> ${entry.newPath}`
                : entry.path}
            </span>
            <span
              className="riskBadge"
              style={{
                borderColor:
                  (entry.riskLevel === "high" || (entry.riskScore ?? 0) >= topRisk * 0.75)
                    ? "#fca5a5"
                    : entry.riskLevel === "medium"
                      ? "#facc15"
                      : "#86efac",
                color:
                  entry.riskLevel === "high"
                    ? "#fecaca"
                    : entry.riskLevel === "medium"
                      ? "#fde68a"
                      : "#bbf7d0",
              }}
            >
              R{entry.riskScore ?? 0}
            </span>
          </button>
        ))}
      </div>
    )}
  </section>
);
