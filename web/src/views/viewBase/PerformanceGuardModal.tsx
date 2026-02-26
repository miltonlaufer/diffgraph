interface PerformanceGuardModalProps {
  lastUiLagMs: number;
  performanceGuardLevel: 0 | 1 | 2;
  renderOldGraph: boolean;
  renderNewGraph: boolean;
  showCalls: boolean;
  viewType: string;
  onClose: () => void;
  onDisableCallsForPerformance: () => void;
  onRenderOldGraphToggle: (checked: boolean) => void;
  onRenderNewGraphToggle: (checked: boolean) => void;
}

export const PerformanceGuardModal = ({
  lastUiLagMs,
  performanceGuardLevel,
  renderOldGraph,
  renderNewGraph,
  showCalls,
  viewType,
  onClose,
  onDisableCallsForPerformance,
  onRenderOldGraphToggle,
  onRenderNewGraphToggle,
}: PerformanceGuardModalProps) => (
  <div className="performanceGuardBackdrop" role="presentation">
    <section
      className="performanceGuardModal"
      role="dialog"
      aria-modal="true"
      aria-label="Performance protection"
    >
      <header className="performanceGuardHeader">
        <h3 className="performanceGuardTitle">UI performance protection</h3>
        <button type="button" className="prDescriptionCloseBtn" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="performanceGuardBody">
        <p className="dimText">
          The graph UI showed a long stall ({lastUiLagMs}ms). We can reduce rendering load progressively.
        </p>
        <p className="performanceGuardEscHint">
          <strong>ESC to dismiss this modal</strong>
        </p>

        {viewType === "logic" && showCalls && (
          <button type="button" className="performanceGuardPrimaryBtn" onClick={onDisableCallsForPerformance}>
            Hide call edges (recommended)
          </button>
        )}

        {performanceGuardLevel >= 2 && (
        <div className="performanceGuardOptions">
          <div className="dimText">Advanced reduction (shown after repeated stalls):</div>
          <label className="showCallsLabel">
            <input
              type="checkbox"
              className="showCallsCheckbox"
              checked={renderOldGraph}
              onChange={(event) => onRenderOldGraphToggle(event.target.checked)}
            />
            Render old graph
          </label>
          <label className="showCallsLabel">
            <input
              type="checkbox"
              className="showCallsCheckbox"
              checked={renderNewGraph}
              onChange={(event) => onRenderNewGraphToggle(event.target.checked)}
            />
            Render new graph
          </label>
        </div>
        )}
      </div>
    </section>
  </div>
);
