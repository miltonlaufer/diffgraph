import { useEffect, useRef, type MutableRefObject } from "react";
import { fetchDiffFiles, fetchView } from "#/api";
import type { GraphDiffTarget } from "#/components/splitGraph/types";
import { ViewBaseStore } from "./store";
import type { ViewType } from "./types";

interface UseViewBaseEffectsArgs {
  store: ViewBaseStore;
  diffId: string;
  viewType: ViewType;
  hasSelectedFile: boolean;
  graphSectionRef: MutableRefObject<HTMLDivElement | null>;
  codeDiffSectionRef: MutableRefObject<HTMLDivElement | null>;
  graphDiffTargets: GraphDiffTarget[];
  displayOldChangedCount: number;
  displayNewChangedCount: number;
  highlightTimerRef: MutableRefObject<number | null>;
}

export const useViewBaseEffects = ({
  store,
  diffId,
  viewType,
  hasSelectedFile,
  graphSectionRef,
  codeDiffSectionRef,
  graphDiffTargets,
  displayOldChangedCount,
  displayNewChangedCount,
  highlightTimerRef,
}: UseViewBaseEffectsArgs): void => {
  const didAutoViewportRef = useRef(false);
  const autoViewportRafRef = useRef<number | null>(null);
  const graphDiffIdxRafRef = useRef<number | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        store.clearSelection();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [store]);

  useEffect(() => {
    let mounted = true;
    store.beginLoading();
    didAutoViewportRef.current = false;

    Promise.all([fetchView(diffId, viewType), fetchDiffFiles(diffId)])
      .then(([payload, files]) => {
        if (!mounted) return;
        store.applyFetchedData(payload.oldGraph, payload.newGraph, files);
      })
      .catch((reason: unknown) => {
        if (!mounted) return;
        store.setError(String(reason));
      });

    return () => {
      mounted = false;
    };
  }, [diffId, store, viewType]);

  useEffect(() => {
    if (store.scrollTick <= 0 || !hasSelectedFile) return;
    const frame = window.requestAnimationFrame(() => {
      codeDiffSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [codeDiffSectionRef, hasSelectedFile, store.scrollTick]);

  useEffect(() => {
    if (store.graphTopScrollTick <= 0) return;
    const frame = window.requestAnimationFrame(() => {
      graphSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [graphSectionRef, store.graphTopScrollTick]);

  useEffect(() => {
    if (graphDiffIdxRafRef.current !== null) {
      window.cancelAnimationFrame(graphDiffIdxRafRef.current);
      graphDiffIdxRafRef.current = null;
    }

    if (graphDiffTargets.length === 0) {
      if (store.graphDiffIdx !== 0) {
        graphDiffIdxRafRef.current = window.requestAnimationFrame(() => {
          graphDiffIdxRafRef.current = null;
          store.setGraphDiffIdx(0);
        });
      }
      return;
    }

    if (store.graphDiffIdx >= graphDiffTargets.length) {
      graphDiffIdxRafRef.current = window.requestAnimationFrame(() => {
        graphDiffIdxRafRef.current = null;
        store.setGraphDiffIdx(0);
      });
    }

    return () => {
      if (graphDiffIdxRafRef.current !== null) {
        window.cancelAnimationFrame(graphDiffIdxRafRef.current);
        graphDiffIdxRafRef.current = null;
      }
    };
  }, [graphDiffTargets.length, store, store.graphDiffIdx]);

  useEffect(() => {
    if (autoViewportRafRef.current !== null) {
      window.cancelAnimationFrame(autoViewportRafRef.current);
      autoViewportRafRef.current = null;
    }

    if (store.loading || didAutoViewportRef.current) return;

    const oldTargetsReady = displayOldChangedCount === 0 || store.oldDiffTargets.length > 0;
    const newTargetsReady = displayNewChangedCount === 0 || store.newDiffTargets.length > 0;
    if (!oldTargetsReady || !newTargetsReady) return;

    const sortedTargets = graphDiffTargets.length > 0
      ? graphDiffTargets
      : [...store.oldDiffTargets, ...store.newDiffTargets].sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const preferredTarget = sortedTargets.find((target) => target.kind !== "group") ?? sortedTargets[0];
    if (!preferredTarget) return;

    autoViewportRafRef.current = window.requestAnimationFrame(() => {
      autoViewportRafRef.current = null;
      didAutoViewportRef.current = true;
      store.setSharedViewport({
        x: preferredTarget.viewportX,
        y: preferredTarget.viewportY,
        zoom: preferredTarget.viewportZoom,
      });
    });

    return () => {
      if (autoViewportRafRef.current !== null) {
        window.cancelAnimationFrame(autoViewportRafRef.current);
        autoViewportRafRef.current = null;
      }
    };
  }, [
    displayNewChangedCount,
    displayOldChangedCount,
    graphDiffTargets,
    store,
    store.loading,
    store.newDiffTargets,
    store.oldDiffTargets,
  ]);

  useEffect(() => () => {
    if (autoViewportRafRef.current !== null) {
      window.cancelAnimationFrame(autoViewportRafRef.current);
      autoViewportRafRef.current = null;
    }
    if (graphDiffIdxRafRef.current !== null) {
      window.cancelAnimationFrame(graphDiffIdxRafRef.current);
      graphDiffIdxRafRef.current = null;
    }
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
    }
  }, [highlightTimerRef]);
};
