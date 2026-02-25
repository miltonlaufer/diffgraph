interface LogicToolbarProps {
  showCalls: boolean;
  diffCountLabel: string;
  canNavigate: boolean;
  hasSelectedNode: boolean;
  searchActive: boolean;
  onShowCallsChange: (nextChecked: boolean) => void;
  onPrev: () => void;
  onNext: () => void;
}

export const LogicToolbar = ({
  showCalls,
  diffCountLabel,
  canNavigate,
  hasSelectedNode,
  searchActive,
  onShowCallsChange,
  onPrev,
  onNext,
}: LogicToolbarProps) => (
  <div className="logicToolbar">
    <div className="logicArrowHints" aria-label="Keyboard arrow shortcuts">
      <strong>prev / next:</strong>
      {hasSelectedNode && (
        <>
          <span className="logicArrowHintItem">
            <span className="logicArrowKey" aria-hidden>&larr;</span>
            <span className="logicArrowKey" aria-hidden>&rarr;</span>
            <span className="logicArrowHintLabel">logic tree</span>
          </span>
          <span className="logicArrowHintDivider" aria-hidden />
        </>
      )}
      <span className="logicArrowHintItem">
        <span className="logicArrowKey" aria-hidden>&uarr;</span>
        <span className="logicArrowKey" aria-hidden>&darr;</span>
        <span className="logicArrowHintLabel">{searchActive ? "search" : "changed"}</span>
      </span>
    </div>
    <label className="showCallsLabel">
      <input
        type="checkbox"
        checked={showCalls}
        onChange={(event) => onShowCallsChange(event.target.checked)}
        className="showCallsCheckbox"
      />
      Show calls
    </label>
    <div className="graphDiffNav">
      <span className="diffCount">{diffCountLabel}</span>
      <button
        type="button"
        className="diffNavBtn"
        onClick={onPrev}
        disabled={!canNavigate}
        title="Previous graph change"
      >
        &#9650;
      </button>
      <button
        type="button"
        className="diffNavBtn"
        onClick={onNext}
        disabled={!canNavigate}
        title="Next graph change"
      >
        &#9660;
      </button>
    </div>
  </div>
);
