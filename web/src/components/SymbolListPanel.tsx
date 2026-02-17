import { useCallback, useMemo, useState } from "react";
import type { FileSymbol } from "../types/graph";

interface SymbolListPanelProps {
  symbols: FileSymbol[];
  onSymbolClick: (startLine: number) => void;
}

const statusDot: Record<string, string> = {
  added: "#4ade80",
  removed: "#f87171",
  modified: "#facc15",
  unchanged: "#64748b",
};

const kindBadge: Record<string, string> = {
  Function: "fn",
  Method: "method",
  Class: "class",
  ReactComponent: "component",
  Hook: "hook",
};

export const SymbolListPanel = ({ symbols, onSymbolClick }: SymbolListPanelProps) => {
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

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const line = Number(event.currentTarget.dataset.line ?? "0");
      if (line > 0) {
        onSymbolClick(line);
      }
    },
    [onSymbolClick],
  );

  /******************* USEEFFECTS ***********************/

  if (count === 0) return null;

  return (
    <section className="symbolListPanel">
      <button type="button" className="symbolListToggle" onClick={toggleCollapsed}>
        <span className={collapsed ? "toggleArrow collapsed" : "toggleArrow"}>&#9660;</span>
        Functions &amp; Methods ({count}{changedCount > 0 ? `, ${changedCount} changed` : ""})
      </button>
      {!collapsed && (
        <div className="symbolListGrid">
          {symbols.map((sym, i) => (
            <button
              key={`${sym.name}-${sym.startLine}-${i}`}
              type="button"
              data-line={sym.startLine}
              onClick={handleClick}
              className="symbolItem"
            >
              <span className="symbolDot" style={{ background: statusDot[sym.diffStatus] ?? "#64748b" }} />
              <span className="symbolBadge">{kindBadge[sym.kind] ?? sym.kind}</span>
              <span className="symbolName">{sym.name}</span>
              <span
                className="riskBadge riskBadgeSymbol"
                title={`Risk score R${sym.riskScore}: higher means this symbol is more likely to be impactful or risky.`}
                aria-label={`Risk score ${sym.riskScore}`}
                style={{
                  borderColor: sym.riskScore >= Math.max(8, topRisk * 0.75) ? "#fca5a5" : sym.riskScore >= 4 ? "#facc15" : "#86efac",
                  color: sym.riskScore >= Math.max(8, topRisk * 0.75) ? "#fecaca" : sym.riskScore >= 4 ? "#fde68a" : "#bbf7d0",
                }}
              >
                R{sym.riskScore}
              </span>
              <span className="symbolLine">:{sym.startLine}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
};
