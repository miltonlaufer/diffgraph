import { useCallback, useEffect, useRef, useState } from "react";
import type { ViewBaseStoreInstance } from "./store";

export type GraphRenderMode = "both" | "old" | "new";

const UI_LAG_SAMPLE_MS = 500;
const UI_LAG_THRESHOLD_MS = 4000;
const UI_GUARD_COOLDOWN_MS = 12000;

interface UsePerformanceGuardParams {
  store: ViewBaseStoreInstance;
  onShowCallsChange: (nextChecked: boolean) => void;
}

export const usePerformanceGuard = ({
  store,
  onShowCallsChange,
}: UsePerformanceGuardParams): {
  performanceModalOpen: boolean;
  performanceGuardLevel: 0 | 1 | 2;
  graphRenderMode: GraphRenderMode;
  lastUiLagMs: number;
  renderOldGraph: boolean;
  renderNewGraph: boolean;
  handleDisableCallsForPerformance: () => void;
  handleRenderOldGraphToggle: (nextChecked: boolean) => void;
  handleRenderNewGraphToggle: (nextChecked: boolean) => void;
  closePerformanceModal: () => void;
} => {
  const [performanceModalOpen, setPerformanceModalOpen] = useState(false);
  const [performanceGuardLevel, setPerformanceGuardLevel] = useState<0 | 1 | 2>(0);
  const [graphRenderMode, setGraphRenderMode] = useState<GraphRenderMode>("both");
  const [lastUiLagMs, setLastUiLagMs] = useState(0);
  const guardCooldownUntilRef = useRef(0);

  const renderOldGraph = graphRenderMode !== "new";
  const renderNewGraph = graphRenderMode !== "old";

  const handleDisableCallsForPerformance = useCallback(() => {
    if (store.viewType === "logic" && store.showCalls) {
      onShowCallsChange(false);
    }
    setPerformanceModalOpen(false);
  }, [onShowCallsChange, store.showCalls, store.viewType]);

  const handleRenderOldGraphToggle = useCallback((nextChecked: boolean) => {
    setGraphRenderMode((prev) => {
      const prevNew = prev !== "old";
      const nextOld = nextChecked;
      const nextNew = prevNew;
      if (!nextOld && !nextNew) return prev;
      if (nextOld && nextNew) return "both";
      return nextOld ? "old" : "new";
    });
  }, []);

  const handleRenderNewGraphToggle = useCallback((nextChecked: boolean) => {
    setGraphRenderMode((prev) => {
      const prevOld = prev !== "new";
      const nextOld = prevOld;
      const nextNew = nextChecked;
      if (!nextOld && !nextNew) return prev;
      if (nextOld && nextNew) return "both";
      return nextOld ? "old" : "new";
    });
  }, []);

  const closePerformanceModal = useCallback(() => {
    setPerformanceModalOpen(false);
  }, []);

  useEffect(() => {
    if (!performanceModalOpen) return undefined;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      closePerformanceModal();
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [closePerformanceModal, performanceModalOpen]);

  useEffect(() => {
    queueMicrotask(() => {
      setPerformanceModalOpen(false);
      setPerformanceGuardLevel(0);
      setGraphRenderMode("both");
      setLastUiLagMs(0);
    });
    guardCooldownUntilRef.current = 0;
  }, [store.diffId, store.viewType]);

  useEffect(() => {
    queueMicrotask(() => setPerformanceModalOpen(false));
  }, [store.selectedFilePath]);

  useEffect(() => {
    if (store.loading) return;
    let lastTick = performance.now();
    let skipNextVisibleSample = false;

    const resetLagBaseline = (): void => {
      lastTick = performance.now();
      skipNextVisibleSample = true;
    };

    const handleVisibilityChange = (): void => {
      resetLagBaseline();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        resetLagBaseline();
        return;
      }

      if (skipNextVisibleSample) {
        skipNextVisibleSample = false;
        lastTick = performance.now();
        return;
      }

      const now = performance.now();
      const lagMs = now - lastTick - UI_LAG_SAMPLE_MS;
      lastTick = now;
      if (lagMs <= UI_LAG_THRESHOLD_MS) return;

      setLastUiLagMs(Math.round(lagMs));
      const nowEpoch = Date.now();
      if (nowEpoch < guardCooldownUntilRef.current) return;

      if (performanceGuardLevel === 0) {
        setPerformanceGuardLevel(1);
        setPerformanceModalOpen(true);
        guardCooldownUntilRef.current = nowEpoch + UI_GUARD_COOLDOWN_MS;
        return;
      }

      if (performanceGuardLevel === 1 && store.viewType === "logic" && !store.showCalls) {
        setPerformanceGuardLevel(2);
        setPerformanceModalOpen(true);
        guardCooldownUntilRef.current = nowEpoch + UI_GUARD_COOLDOWN_MS;
        return;
      }

      setPerformanceModalOpen(true);
      guardCooldownUntilRef.current = nowEpoch + UI_GUARD_COOLDOWN_MS;
    }, UI_LAG_SAMPLE_MS);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [performanceGuardLevel, store.loading, store.showCalls, store.viewType]);

  return {
    performanceModalOpen,
    performanceGuardLevel,
    graphRenderMode,
    lastUiLagMs,
    renderOldGraph,
    renderNewGraph,
    handleDisableCallsForPerformance,
    handleRenderOldGraphToggle,
    handleRenderNewGraphToggle,
    closePerformanceModal,
  };
};
