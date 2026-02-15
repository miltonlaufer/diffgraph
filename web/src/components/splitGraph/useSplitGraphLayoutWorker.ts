import { useEffect, useRef } from "react";
import type { Edge, Node } from "@xyflow/react";
import type { ViewGraph } from "../../types/graph";
import type { LayoutWorkerRequest, LayoutWorkerResponse } from "../../workers/layoutTypes";
import { SplitGraphPanelStore } from "./store";

interface LayoutResult {
  nodes: Node[];
  edges: Edge[];
}

interface UseSplitGraphLayoutWorkerArgs {
  store: SplitGraphPanelStore;
  graph: ViewGraph;
  viewType: "logic" | "knowledge" | "react";
  showCalls: boolean;
  fileEntries: Array<[string, string]>;
  computeLayoutSync: () => LayoutResult;
}

export const useSplitGraphLayoutWorker = ({
  store,
  graph,
  viewType,
  showCalls,
  fileEntries,
  computeLayoutSync,
}: UseSplitGraphLayoutWorkerArgs): void => {
  const layoutWorkerRef = useRef<Worker | null>(null);
  const layoutRequestIdRef = useRef(0);
  const layoutWatchdogTimerRef = useRef<number | null>(null);
  const layoutSoftFallbackTimerRef = useRef<number | null>(null);
  const forcedRecoverySignatureRef = useRef("");

  useEffect(() => {
    const worker = new Worker(new URL("../../workers/layoutWorker.ts", import.meta.url), { type: "module" });
    layoutWorkerRef.current = worker;

    const handleMessage = (event: MessageEvent<LayoutWorkerResponse>): void => {
      const data = event.data;
      if (data.requestId !== layoutRequestIdRef.current) return;
      if (layoutWatchdogTimerRef.current !== null) {
        window.clearTimeout(layoutWatchdogTimerRef.current);
        layoutWatchdogTimerRef.current = null;
      }
      if (layoutSoftFallbackTimerRef.current !== null) {
        window.clearTimeout(layoutSoftFallbackTimerRef.current);
        layoutSoftFallbackTimerRef.current = null;
      }
      if (!data.ok) {
        store.setLayoutPending(false);
        store.setWorkerFailed(true);
        return;
      }
      store.setLayoutPending(false);
      store.setLayoutResult({ nodes: data.result.nodes as Node[], edges: data.result.edges as Edge[] });
    };

    const handleError = (): void => {
      if (layoutWatchdogTimerRef.current !== null) {
        window.clearTimeout(layoutWatchdogTimerRef.current);
        layoutWatchdogTimerRef.current = null;
      }
      if (layoutSoftFallbackTimerRef.current !== null) {
        window.clearTimeout(layoutSoftFallbackTimerRef.current);
        layoutSoftFallbackTimerRef.current = null;
      }
      store.setLayoutPending(false);
      store.setWorkerFailed(true);
    };

    worker.addEventListener("message", handleMessage as EventListener);
    worker.addEventListener("error", handleError as EventListener);
    store.setWorkerReady(true);

    return () => {
      worker.removeEventListener("message", handleMessage as EventListener);
      worker.removeEventListener("error", handleError as EventListener);
      worker.terminate();
      if (layoutWatchdogTimerRef.current !== null) {
        window.clearTimeout(layoutWatchdogTimerRef.current);
        layoutWatchdogTimerRef.current = null;
      }
      if (layoutSoftFallbackTimerRef.current !== null) {
        window.clearTimeout(layoutSoftFallbackTimerRef.current);
        layoutSoftFallbackTimerRef.current = null;
      }
      layoutWorkerRef.current = null;
      store.setWorkerReady(false);
    };
  }, [store]);

  useEffect(() => {
    const requestId = layoutRequestIdRef.current + 1;
    layoutRequestIdRef.current = requestId;

    if (graph.nodes.length === 0) {
      store.setLayoutPending(false);
      store.setLayoutResult({ nodes: [], edges: [] });
      return;
    }

    if (store.workerFailed) {
      store.setLayoutPending(true);
      const fallbackTimer = window.setTimeout(() => {
        if (requestId !== layoutRequestIdRef.current) return;
        try {
          store.setLayoutResult(computeLayoutSync());
        } catch {
          store.setWorkerFailed(true);
        }
        store.setLayoutPending(false);
      }, 0);
      return () => {
        window.clearTimeout(fallbackTimer);
        if (requestId === layoutRequestIdRef.current) {
          store.setLayoutPending(false);
        }
      };
    }

    if (!store.workerReady || !layoutWorkerRef.current) {
      store.setLayoutPending(false);
      return;
    }

    const payload: LayoutWorkerRequest = {
      requestId,
      graph,
      viewType,
      showCalls,
      fileEntries,
    };
    store.setLayoutPending(true);
    if (layoutWatchdogTimerRef.current !== null) {
      window.clearTimeout(layoutWatchdogTimerRef.current);
    }
    if (layoutSoftFallbackTimerRef.current !== null) {
      window.clearTimeout(layoutSoftFallbackTimerRef.current);
      layoutSoftFallbackTimerRef.current = null;
    }
    layoutWatchdogTimerRef.current = window.setTimeout(() => {
      if (requestId !== layoutRequestIdRef.current) return;
      if (store.layoutResult.nodes.length > 0) {
        store.setLayoutPending(false);
        return;
      }
      store.setLayoutPending(false);
      store.setWorkerFailed(true);
    }, 2500);
    if (graph.nodes.length <= 300) {
      layoutSoftFallbackTimerRef.current = window.setTimeout(() => {
        if (requestId !== layoutRequestIdRef.current) return;
        if (!store.layoutPending) return;
        try {
          store.setLayoutResult(computeLayoutSync());
          store.setLayoutPending(false);
        } catch {
          store.setWorkerFailed(true);
          store.setLayoutPending(false);
        }
      }, 1000);
    }
    layoutWorkerRef.current.postMessage(payload);
  }, [computeLayoutSync, fileEntries, graph, showCalls, store, viewType, store.workerFailed, store.workerReady]);

  useEffect(() => {
    const hasInputNodes = graph.nodes.length > 0;
    const hasRenderedNodes = store.layoutResult.nodes.length > 0;
    if (!hasInputNodes || hasRenderedNodes || store.layoutPending) return;

    const signature = `${viewType}:${showCalls}:${graph.nodes.length}:${graph.edges.length}`;
    if (forcedRecoverySignatureRef.current === signature) return;
    forcedRecoverySignatureRef.current = signature;

    store.setLayoutPending(true);
    const timer = window.setTimeout(() => {
      try {
        const recovered = computeLayoutSync();
        store.setLayoutResult(recovered);
      } catch {
        store.setWorkerFailed(true);
      } finally {
        store.setLayoutPending(false);
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    computeLayoutSync,
    graph.edges.length,
    graph.nodes.length,
    showCalls,
    store,
    store.layoutPending,
    store.layoutResult.nodes.length,
    viewType,
  ]);
};
