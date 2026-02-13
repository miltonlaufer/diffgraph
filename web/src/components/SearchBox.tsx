import { useCallback, useState, type ChangeEvent, type KeyboardEvent } from "react";

interface SearchBoxProps {
  placeholder: string;
  onSearch: (query: string, exclude: boolean) => void;
  onNext: () => void;
  onPrev: () => void;
  resultCount: number;
  currentIndex: number;
}

export const SearchBox = ({ placeholder, onSearch, onNext, onPrev, resultCount, currentIndex }: SearchBoxProps) => {
  /******************* STORE ***********************/
  const [query, setQuery] = useState("");
  const [exclude, setExclude] = useState(false);

  /******************* FUNCTIONS ***********************/
  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setQuery(val);
      onSearch(val, exclude);
    },
    [onSearch, exclude],
  );

  const handleExcludeToggle = useCallback(() => {
    setExclude((prev) => {
      const next = !prev;
      onSearch(query, next);
      return next;
    });
  }, [onSearch, query]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        if (e.shiftKey) {
          onPrev();
        } else {
          onNext();
        }
        e.preventDefault();
      }
    },
    [onNext, onPrev],
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
          {resultCount > 0 ? `${currentIndex + 1}/${resultCount}` : "0"}
          <button type="button" className="searchNavBtn" onClick={onPrev} disabled={resultCount === 0}>&#9650;</button>
          <button type="button" className="searchNavBtn" onClick={onNext} disabled={resultCount === 0}>&#9660;</button>
        </span>
      )}
    </div>
  );
};
