import { useCallback, type ChangeEvent, type KeyboardEvent } from "react";

interface SearchBoxProps {
  placeholder: string;
  query: string;
  exclude: boolean;
  onSearch: (query: string, exclude: boolean) => void;
  onNext: () => void;
  onPrev: () => void;
  resultCount: number;
  currentIndex: number;
}

export const SearchBox = ({
  placeholder,
  query,
  exclude,
  onSearch,
  onNext,
  onPrev,
  resultCount,
  currentIndex,
}: SearchBoxProps) => {
  /******************* FUNCTIONS ***********************/
  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      onSearch(val, exclude);
    },
    [onSearch, exclude],
  );

  const handleExcludeToggle = useCallback(() => {
    onSearch(query, !exclude);
  }, [exclude, onSearch, query]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (exclude || query.trim().length === 0) return;
      if (e.key === "Enter") {
        if (e.shiftKey) {
          onPrev();
        } else {
          onNext();
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key === "ArrowDown") {
        onNext();
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key === "ArrowUp") {
        onPrev();
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [exclude, onNext, onPrev, query],
  );

  /******************* USEEFFECTS ***********************/

  return (
    <div className="searchBox">
      <input
        type="search"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="searchInput"
      />
      {query.length > 0 && (
        <span className="searchInfo">
          <label className="excludeLabel">
            <input type="checkbox" checked={exclude} onChange={handleExcludeToggle} className="excludeCheckbox" />
            exclude
          </label>
          {!exclude && (
            <>
              {resultCount > 0 ? `${currentIndex + 1}/${resultCount}` : "0"}
              <button type="button" className="searchNavBtn" onClick={onPrev} disabled={resultCount === 0}>&#9650;</button>
              <button type="button" className="searchNavBtn" onClick={onNext} disabled={resultCount === 0}>&#9660;</button>
            </>
          )}
        </span>
      )}
    </div>
  );
};
