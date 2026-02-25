import { memo, useCallback, useMemo, useState } from "react";
import type { FileSymbol } from "../types/graph";
import { SymbolListGrid } from "./SymbolListGrid";

interface SymbolListPanelProps {
  symbols: FileSymbol[];
  onSymbolClick: (startLine: number) => void;
}

export const SymbolListPanel = memo(({ symbols, onSymbolClick }: SymbolListPanelProps) => {
  /******************* STORE ***********************/
  const [collapsed, setCollapsed] = useState(true);

  /******************* COMPUTED ***********************/
  const count = useMemo(() => symbols.length, [symbols.length]);
  const changedCount = useMemo(
    () => symbols.filter((s) => s.diffStatus !== "unchanged").length,
    [symbols],
  );
  const topRisk = useMemo(
    () => symbols.reduce((max, symbol) => Math.max(max, symbol.riskScore), 0),
    [symbols],
  );

  /******************* FUNCTIONS ***********************/
  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  const handleSymbolClick = useCallback((startLine: number) => {
    if (startLine > 0) {
      onSymbolClick(startLine);
    }
  }, [onSymbolClick]);

  /******************* USEEFFECTS ***********************/

  if (count === 0) return null;

  return (
    <section className="symbolListPanel">
      <button type="button" className="symbolListToggle" onClick={toggleCollapsed}>
        <span className={collapsed ? "toggleArrow collapsed" : "toggleArrow"}>&#9660;</span>
        Functions &amp; Methods ({count}{changedCount > 0 ? `, ${changedCount} changed` : ""})
      </button>
      {!collapsed && (
        <SymbolListGrid symbols={symbols} topRisk={topRisk} onSymbolClick={handleSymbolClick} />
      )}
    </section>
  );
});

SymbolListPanel.displayName = "SymbolListPanel";
