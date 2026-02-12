import { useCallback, useMemo, useState, type MouseEvent } from "react";
import type { FileDiffEntry } from "../types/graph";

interface FileListPanelProps {
  files: FileDiffEntry[];
  selectedFilePath: string;
  onFileSelect: (path: string) => void;
}

export const FileListPanel = ({ files, selectedFilePath, onFileSelect }: FileListPanelProps) => {
  /******************* STORE ***********************/
  const [collapsed, setCollapsed] = useState<boolean>(false);

  /******************* COMPUTED ***********************/
  const count = useMemo(() => files.length, [files.length]);

  /******************* FUNCTIONS ***********************/
  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const filePath = event.currentTarget.dataset.path ?? "";
      if (filePath.length > 0) {
        onFileSelect(filePath);
      }
    },
    [onFileSelect],
  );

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  /******************* USEEFFECTS ***********************/

  return (
    <section className="fileListPanel">
      <button type="button" className="fileListToggle" onClick={toggleCollapsed}>
        <span className={collapsed ? "toggleArrow collapsed" : "toggleArrow"}>&#9660;</span>
        Changed Files ({count})
      </button>
      {!collapsed && (
        <div className="fileListGrid">
          {files.map((entry) => (
            <button
              key={entry.path}
              type="button"
              data-path={entry.path}
              onClick={handleClick}
              className={entry.path === selectedFilePath ? "filePill filePillActive" : "filePill"}
            >
              {entry.path}
            </button>
          ))}
        </div>
      )}
    </section>
  );
};
