interface LogicToolbarProps {
  showCalls: boolean;
  diffCountLabel: string;
  canNavigate: boolean;
  onShowCallsChange: (nextChecked: boolean) => void;
  onPrev: () => void;
  onNext: () => void;
}

export const LogicToolbar = ({
  showCalls,
  diffCountLabel,
  canNavigate,
  onShowCallsChange,
  onPrev,
  onNext,
}: LogicToolbarProps) => (
  <div className="logicToolbar">
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
