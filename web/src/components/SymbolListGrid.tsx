import { memo, useCallback } from "react";
import type { FileSymbol } from "../types/graph";

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

interface SymbolListGridProps {
  symbols: FileSymbol[];
  topRisk: number;
  onSymbolClick: (startLine: number) => void;
}

export const SymbolListGrid = memo(({ symbols, topRisk, onSymbolClick }: SymbolListGridProps) => (
  <div className="symbolListGrid">
    {symbols.map((sym) => (
      <SymbolItem
        key={`${sym.name}-${sym.startLine}`}
        symbol={sym}
        topRisk={topRisk}
        onClick={onSymbolClick}
      />
    ))}
  </div>
));

SymbolListGrid.displayName = "SymbolListGrid";

interface SymbolItemProps {
  symbol: FileSymbol;
  topRisk: number;
  onClick: (startLine: number) => void;
}

const SymbolItem = memo(({ symbol, topRisk, onClick }: SymbolItemProps) => {
  const handleClick = useCallback(() => {
    if (symbol.startLine > 0) {
      onClick(symbol.startLine);
    }
  }, [symbol.startLine, onClick]);

  return (
    <button
      type="button"
      data-line={symbol.startLine}
      onClick={handleClick}
      className="symbolItem"
    >
      <span className="symbolDot" style={{ background: statusDot[symbol.diffStatus] ?? "#64748b" }} />
      <span className="symbolBadge">{kindBadge[symbol.kind] ?? symbol.kind}</span>
      <span className="symbolName">{symbol.name}</span>
      <span
        className="riskBadge riskBadgeSymbol"
        title={`Risk score R${symbol.riskScore}: higher means this symbol is more likely to be impactful or risky.`}
        aria-label={`Risk score ${symbol.riskScore}`}
        style={{
          borderColor: symbol.riskScore >= Math.max(8, topRisk * 0.75) ? "#fca5a5" : symbol.riskScore >= 4 ? "#facc15" : "#86efac",
          color: symbol.riskScore >= Math.max(8, topRisk * 0.75) ? "#fecaca" : symbol.riskScore >= 4 ? "#fde68a" : "#bbf7d0",
        }}
      >
        R{symbol.riskScore}
      </span>
      <span className="symbolLine">:{symbol.startLine}</span>
    </button>
  );
});

SymbolItem.displayName = "SymbolItem";
