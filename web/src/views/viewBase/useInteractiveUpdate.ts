import { useCallback, useEffect, useMemo, useRef, useTransition } from "react";
import type { ViewBaseStoreInstance } from "./store";

export interface InteractiveUpdateContext {
  store: ViewBaseStoreInstance;
  runInteractiveUpdate: (update: () => void) => void;
}

interface UseInteractiveUpdateResult {
  isUiPending: boolean;
  commandContext: InteractiveUpdateContext;
}

export const useInteractiveUpdate = (
  store: ViewBaseStoreInstance,
): UseInteractiveUpdateResult => {
  const [isUiPending, startUiTransition] = useTransition();
  const startRafRef = useRef<number | null>(null);
  const updateRafRef = useRef<number | null>(null);
  const endRafRef = useRef<number | null>(null);
  const recoveryTimerRef = useRef<number | null>(null);
  const interactionTokenRef = useRef(0);

  const clearRecoveryTimer = useCallback(() => {
    if (recoveryTimerRef.current !== null) {
      window.clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }
  }, []);

  const cancelPendingFrames = useCallback(() => {
    if (startRafRef.current !== null) {
      window.cancelAnimationFrame(startRafRef.current);
      startRafRef.current = null;
    }
    if (updateRafRef.current !== null) {
      window.cancelAnimationFrame(updateRafRef.current);
      updateRafRef.current = null;
    }
    if (endRafRef.current !== null) {
      window.cancelAnimationFrame(endRafRef.current);
      endRafRef.current = null;
    }
  }, []);

  const runInteractiveUpdate = useCallback((update: () => void) => {
    interactionTokenRef.current += 1;
    const token = interactionTokenRef.current;
    store.setInteractionBusy(true);
    cancelPendingFrames();
    clearRecoveryTimer();
    recoveryTimerRef.current = window.setTimeout(() => {
      if (interactionTokenRef.current !== token) return;
      store.setInteractionBusy(false);
      recoveryTimerRef.current = null;
    }, 2500);

    startRafRef.current = window.requestAnimationFrame(() => {
      startRafRef.current = null;

      // Let the overlay paint first, then run expensive updates.
      updateRafRef.current = window.requestAnimationFrame(() => {
        updateRafRef.current = null;
        try {
          startUiTransition(() => {
            update();
          });
        } catch {
          if (interactionTokenRef.current === token) {
            store.setInteractionBusy(false);
          }
          clearRecoveryTimer();
          return;
        }

        endRafRef.current = window.requestAnimationFrame(() => {
          endRafRef.current = null;
          if (interactionTokenRef.current === token) {
            store.setInteractionBusy(false);
          }
          clearRecoveryTimer();
        });
      });
    });
  }, [cancelPendingFrames, clearRecoveryTimer, startUiTransition, store]);

  useEffect(() => () => {
    cancelPendingFrames();
    clearRecoveryTimer();
    store.setInteractionBusy(false);
  }, [cancelPendingFrames, clearRecoveryTimer, store]);

  const commandContext = useMemo(
    () => ({ store, runInteractiveUpdate }),
    [store, runInteractiveUpdate],
  );

  return { isUiPending, commandContext };
};
