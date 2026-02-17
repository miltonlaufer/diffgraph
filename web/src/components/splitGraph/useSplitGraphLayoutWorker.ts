import { useEffect, useRef } from "react";
import type { Edge, Node } from "@xyflow/react";
import type { ViewGraph } from "#/types/graph";
import type { LayoutWorkerRequest, LayoutWorkerResponse } from "#/workers/layoutTypes";
import { SplitGraphPanelStore } from "./store";
import { hashBoolean, hashFinalize, hashInit, hashNumber, hashString, lruSet } from "#/lib/memoHash";

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

const LAYOUT_CACHE_MAX_ENTRIES = 10;

const hashGraphForLayoutSignature = (hash: number, graph: ViewGraph): number => {
  let next = hashNumber(hash, graph.nodes.length);
  for (const node of graph.nodes) {
    next = hashString(next, node.id);
    next = hashString(next, node.kind);
    next = hashString(next, node.label);
    next = hashString(next, node.filePath);
    next = hashString(next, node.diffStatus);
    next = hashString(next, node.parentId ?? "");
    next = hashString(next, node.branchType ?? "");
    next = hashString(next, node.fileName ?? "");
    next = hashString(next, node.className ?? "");
    next = hashString(next, node.functionParams ?? "");
    next = hashString(next, node.returnType ?? "");
    next = hashNumber(next, node.startLine ?? -1);
    next = hashNumber(next, node.endLine ?? -1);
  }
  next = hashNumber(next, graph.edges.length);
  for (const edge of graph.edges) {
    next = hashString(next, edge.id);
    next = hashString(next, edge.source);
    next = hashString(next, edge.target);
    next = hashString(next, edge.kind);
    next = hashString(next, edge.relation ?? "");
    next = hashString(next, edge.flowType ?? "");
    next = hashString(next, edge.diffStatus);
  }
  return next;
};

const hashFileEntriesForLayoutSignature = (hash: number, fileEntries: Array<[string, string]>): number => {
  let next = hashNumber(hash, fileEntries.length);
  for (const [path, content] of fileEntries) {
    next = hashString(next, path);
    next = hashNumber(next, content.length);
    if (content.length > 0) {
      const head = content.slice(0, 64);
      const tail = content.slice(-64);
      next = hashString(next, head);
      next = hashString(next, tail);
    }
  }
  return next;
};

const buildLayoutInputSignature = (
  graph: ViewGraph,
  viewType: "logic" | "knowledge" | "react",
  showCalls: boolean,
  fileEntries: Array<[string, string]>,
): string => {
  let hash = hashInit();
  hash = hashString(hash, viewType);
  hash = hashBoolean(hash, showCalls);
  hash = hashGraphForLayoutSignature(hash, graph);
  hash = hashFileEntriesForLayoutSignature(hash, fileEntries);
  return `${hashFinalize(hash)}:${graph.nodes.length}:${graph.edges.length}:${fileEntries.length}`;
};

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
  const inFlightSignatureRef = useRef("");
  const signatureByRequestIdRef = useRef<Map<number, string>>(new Map());
  const resultCacheRef = useRef<Map<string, LayoutResult>>(new Map());
  const appliedSignatureRef = useRef("");

  useEffect(() => {
    const worker = new Worker(new URL("../../workers/layoutWorker.ts", import.meta.url), { type: "module" });
    layoutWorkerRef.current = worker;

    const handleMessage = (event: MessageEvent<LayoutWorkerResponse>): void => {
      const data = event.data;
      const inputSignature = signatureByRequestIdRef.current.get(data.requestId) ?? "";
      signatureByRequestIdRef.current.delete(data.requestId);
      if (inputSignature && inFlightSignatureRef.current === inputSignature) {
        inFlightSignatureRef.current = "";
      }
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
      const result = { nodes: data.result.nodes as Node[], edges: data.result.edges as Edge[] };
      if (inputSignature) {
        lruSet(resultCacheRef.current, inputSignature, result, LAYOUT_CACHE_MAX_ENTRIES);
        appliedSignatureRef.current = inputSignature;
      }
      store.setLayoutResult(result);
    };

    const handleError = (): void => {
      inFlightSignatureRef.current = "";
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
    const inputSignature = buildLayoutInputSignature(graph, viewType, showCalls, fileEntries);

    if (graph.nodes.length === 0) {
      store.setLayoutPending(false);
      const emptyResult = { nodes: [], edges: [] };
      lruSet(resultCacheRef.current, inputSignature, emptyResult, LAYOUT_CACHE_MAX_ENTRIES);
      if (appliedSignatureRef.current !== inputSignature) {
        store.setLayoutResult(emptyResult);
        appliedSignatureRef.current = inputSignature;
      }
      return;
    }

    const cachedResult = resultCacheRef.current.get(inputSignature);
    if (cachedResult) {
      if (appliedSignatureRef.current !== inputSignature) {
        store.setLayoutResult(cachedResult);
        appliedSignatureRef.current = inputSignature;
      }
      store.setLayoutPending(false);
      return;
    }

    if (store.workerFailed) {
      const requestId = layoutRequestIdRef.current + 1;
      layoutRequestIdRef.current = requestId;
      store.setLayoutPending(true);
      const fallbackTimer = window.setTimeout(() => {
        if (requestId !== layoutRequestIdRef.current) return;
        try {
          const computed = computeLayoutSync();
          lruSet(resultCacheRef.current, inputSignature, computed, LAYOUT_CACHE_MAX_ENTRIES);
          store.setLayoutResult(computed);
          appliedSignatureRef.current = inputSignature;
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

    if (inFlightSignatureRef.current === inputSignature) return;

    const requestId = layoutRequestIdRef.current + 1;
    layoutRequestIdRef.current = requestId;
    const payload: LayoutWorkerRequest = {
      requestId,
      graph,
      viewType,
      showCalls,
      fileEntries,
    };
    inFlightSignatureRef.current = inputSignature;
    signatureByRequestIdRef.current.set(requestId, inputSignature);
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
          const computed = computeLayoutSync();
          lruSet(resultCacheRef.current, inputSignature, computed, LAYOUT_CACHE_MAX_ENTRIES);
          store.setLayoutResult(computed);
          appliedSignatureRef.current = inputSignature;
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
