import { memo, useCallback } from "react";
import type { FileDiffEntry } from "../../types/graph";

interface FileListGridProps {
  files: FileDiffEntry[];
  selectedFilePath: string;
  selectedFilePathsForGraph: string[];
  topRisk: number;
  onSelectFile: (filePath: string) => void;
  onToggleFileForGraph: (filePath: string) => void;
  normalizePathForCompare: (p: string) => string;
}

export const FileListGrid = memo(({
  files,
  selectedFilePath,
  selectedFilePathsForGraph,
  topRisk,
  onSelectFile,
  onToggleFileForGraph,
  normalizePathForCompare,
}: FileListGridProps) => (
  <div className="fileListGrid">
    {files.map((entry) => (
      <FilePill
        key={entry.path}
        entry={entry}
        isSelected={entry.path === selectedFilePath}
        isCheckedForGraph={
          selectedFilePathsForGraph.length === 0 ||
          selectedFilePathsForGraph.some((p) => normalizePathForCompare(p) === normalizePathForCompare(entry.path))
        }
        topRisk={topRisk}
        onSelect={onSelectFile}
        onToggleCheckbox={(e) => {
          e.stopPropagation();
          onToggleFileForGraph(entry.path);
        }}
      />
    ))}
  </div>
));

FileListGrid.displayName = "FileListGrid";

interface FilePillProps {
  entry: FileDiffEntry;
  isSelected: boolean;
  isCheckedForGraph: boolean;
  topRisk: number;
  onSelect: (filePath: string) => void;
  onToggleCheckbox: (e: React.MouseEvent | React.ChangeEvent<HTMLInputElement>) => void;
}

const FilePill = memo(({ entry, isSelected, isCheckedForGraph, topRisk, onSelect, onToggleCheckbox }: FilePillProps) => {
  const handleClick = useCallback(() => {
    onSelect(entry.path);
  }, [entry.path, onSelect]);

  return (
    <div className={isSelected ? "filePill filePillActive" : "filePill"}>
      <input
        type="checkbox"
        checked={isCheckedForGraph}
        onChange={onToggleCheckbox}
        aria-label={`Show ${entry.path} in graph`}
        className="filePillCheckbox"
      />
      <button
        type="button"
        onClick={handleClick}
        className="filePillContent"
      >
      <span className="filePillPath">
        {entry.changeType === "renamed" && entry.oldPath && entry.newPath
          ? `${entry.oldPath} -> ${entry.newPath}`
          : entry.path}
      </span>
      <span
        className="riskBadge"
        title={`Risk score R${entry.riskScore ?? 0}: higher means this file is more likely to be impactful or risky.`}
        aria-label={`Risk score ${entry.riskScore ?? 0}`}
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
    </div>
  );
});

FilePill.displayName = "FilePill";
