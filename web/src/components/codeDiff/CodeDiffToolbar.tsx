import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from "react";

interface CodeDiffToolbarProps {
  filePath: string;
  textSearch: string;
  textSearchIdx: number;
  textSearchMatchesCount: number;
  hunkCount: number;
  currentHunkIdx: number;
  onTextSearchChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onTextSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onPrevTextMatch: () => void;
  onNextTextMatch: () => void;
  onPrevHunk: () => void;
  onNextHunk: () => void;
  showChangeNavigation?: boolean;
}

export const CodeDiffToolbar = ({
  filePath,
  textSearch,
  textSearchIdx,
  textSearchMatchesCount,
  hunkCount,
  currentHunkIdx,
  onTextSearchChange,
  onTextSearchKeyDown,
  onPrevTextMatch,
  onNextTextMatch,
  onPrevHunk,
  onNextHunk,
  showChangeNavigation = true,
}: CodeDiffToolbarProps) => (
  <div className="diffNavBar">
    <h4 className="codeDiffTitle">{filePath}</h4>
    <div className="diffNavControls">
      <div className="searchBox">
        <input
          type="search"
          value={textSearch}
          onChange={onTextSearchChange}
          onKeyDown={onTextSearchKeyDown}
          placeholder="Search code..."
          className="searchInput"
        />
        {textSearch.length > 0 && (
          <span className="searchInfo">
            {textSearchMatchesCount > 0 ? `${textSearchIdx + 1}/${textSearchMatchesCount}` : "0"}
            <button type="button" className="searchNavBtn" onClick={onPrevTextMatch} disabled={textSearchMatchesCount === 0}>&#9650;</button>
            <button type="button" className="searchNavBtn" onClick={onNextTextMatch} disabled={textSearchMatchesCount === 0}>&#9660;</button>
          </span>
        )}
      </div>
      {showChangeNavigation && (
        <>
          <span className="diffCount">{hunkCount} change{hunkCount !== 1 ? "s" : ""}</span>
          <button type="button" className="diffNavBtn" onClick={onPrevHunk} disabled={hunkCount === 0} title="Previous change">
            &#9650;
          </button>
          <span className="diffNavPos">{hunkCount > 0 ? `${currentHunkIdx + 1}/${hunkCount}` : "0/0"}</span>
          <button type="button" className="diffNavBtn" onClick={onNextHunk} disabled={hunkCount === 0} title="Next change">
            &#9660;
          </button>
        </>
      )}
    </div>
  </div>
);
