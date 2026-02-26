import { memo, useCallback } from "react";
import type { FileDiffEntry } from "../../types/graph";

interface FileListGridProps {
  files: FileDiffEntry[];
  selectedFilePath: string;
  topRisk: number;
  onSelectFile: (filePath: string) => void;
}

export const FileListGrid = memo(({
  files,
  selectedFilePath,
  topRisk,
  onSelectFile,
}: FileListGridProps) => (
  <div className="fileListGrid">
    {files.map((entry) => (
      <FilePill
        key={entry.path}
        entry={entry}
        isSelected={entry.path === selectedFilePath}
        topRisk={topRisk}
        onSelect={onSelectFile}
      />
    ))}
  </div>
));

FileListGrid.displayName = "FileListGrid";

interface FilePillProps {
  entry: FileDiffEntry;
  isSelected: boolean;
  topRisk: number;
  onSelect: (filePath: string) => void;
}

const FilePill = memo(({ entry, isSelected, topRisk, onSelect }: FilePillProps) => {
  const handleClick = useCallback(() => {
    onSelect(entry.path);
  }, [entry.path, onSelect]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={isSelected ? "filePill filePillActive" : "filePill"}
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
  );
});

FilePill.displayName = "FilePill";
