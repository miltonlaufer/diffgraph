import { SearchBox } from "../SearchBox";
import type { DiffStats } from "./types";

interface GraphPanelHeaderProps {
  title: string;
  isOld: boolean;
  stats: DiffStats;
  searchMatchCount: number;
  searchIndex: number;
  onSearch: (query: string, exclude: boolean) => void;
  onSearchNext: () => void;
  onSearchPrev: () => void;
}

export const GraphPanelHeader = ({
  title,
  isOld,
  stats,
  searchMatchCount,
  searchIndex,
  onSearch,
  onSearchNext,
  onSearchPrev,
}: GraphPanelHeaderProps) => (
  <>
    <h3>{title}</h3>
    <div className="panelToolbar">
      {!isOld && (
        <div className="legendRow">
          <span className="legendItem addedLegend">Added {stats.added}</span>
          <span className="legendItem removedLegend">Removed {stats.removed}</span>
          <span className="legendItem modifiedLegend">Modified {stats.modified}</span>
        </div>
      )}
      <SearchBox
        placeholder="Search nodes..."
        onSearch={onSearch}
        onNext={onSearchNext}
        onPrev={onSearchPrev}
        resultCount={searchMatchCount}
        currentIndex={searchIndex}
      />
    </div>
  </>
);
