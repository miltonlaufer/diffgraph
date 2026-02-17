import { useEffect, useRef, useState } from "react";
import {
  buildViewBaseDerivedInputSignature,
  computeViewBaseDerived,
  type ViewBaseDerivedInput,
  type ViewBaseDerivedResult,
} from "./derived";
import { createSignatureCache } from "#/lib/cachedComputation";
import type { ViewBaseDerivedWorkerRequest, ViewBaseDerivedWorkerResponse } from "#/workers/viewBaseDerivedTypes";

const VIEW_BASE_DERIVED_CACHE_MAX_ENTRIES = 12;
const SYNC_INITIAL_DERIVED_NODE_THRESHOLD = 600;
const DERIVED_WORKER_WATCHDOG_MS = 3500;
const EMPTY_GRAPH = { nodes: [], edges: [] };
const EMPTY_DERIVED_RESULT: ViewBaseDerivedResult = {
  displayOldGraph: EMPTY_GRAPH,
  displayNewGraph: EMPTY_GRAPH,
  diffStats: { added: 0, removed: 0, modified: 0 },
  displayOldChangedCount: 0,
  displayNewChangedCount: 0,
};

export const useViewBaseDerivedWorker = (
  input: ViewBaseDerivedInput,
): ViewBaseDerivedResult => {
  const [initialState] = useState(() => {
    const totalNodeCount = input.oldGraph.nodes.length + input.newGraph.nodes.length;
    const shouldComputeSyncInitially = totalNodeCount <= SYNC_INITIAL_DERIVED_NODE_THRESHOLD;
    const initialResult = shouldComputeSyncInitially ? computeViewBaseDerived(input) : EMPTY_DERIVED_RESULT;
    const initialSignature = buildViewBaseDerivedInputSignature(input);
    const cache = createSignatureCache<ViewBaseDerivedResult>(VIEW_BASE_DERIVED_CACHE_MAX_ENTRIES);
    if (shouldComputeSyncInitially) {
      cache.set(initialSignature, initialResult);
    }
    return { initialResult, initialSignature, cache };
  });
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const inFlightSignatureRef = useRef("");
  const signatureByRequestIdRef = useRef<Map<number, string>>(new Map());
  const watchdogTimerRef = useRef<number | null>(null);
  const resultCacheRef = useRef(initialState.cache);
  const appliedSignatureRef = useRef(initialState.initialSignature);
  const [workerFailed, setWorkerFailed] = useState(false);
  const [derived, setDerived] = useState<ViewBaseDerivedResult>(initialState.initialResult);

  useEffect(() => {
    const worker = new Worker(new URL("../../workers/viewBaseDerivedWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    const handleMessage = (event: MessageEvent<ViewBaseDerivedWorkerResponse>): void => {
      const data = event.data;
      const inputSignature = signatureByRequestIdRef.current.get(data.requestId) ?? "";
      signatureByRequestIdRef.current.delete(data.requestId);
      if (data.requestId === requestIdRef.current && watchdogTimerRef.current !== null) {
        window.clearTimeout(watchdogTimerRef.current);
        watchdogTimerRef.current = null;
      }
      if (inputSignature && inFlightSignatureRef.current === inputSignature) {
        inFlightSignatureRef.current = "";
      }
      if (data.requestId !== requestIdRef.current) return;
      if (!data.ok) {
        setWorkerFailed(true);
        return;
      }
      if (inputSignature) {
        resultCacheRef.current.set(inputSignature, data.result);
        appliedSignatureRef.current = inputSignature;
      }
      setDerived(data.result);
    };

    const handleError = (): void => {
      if (watchdogTimerRef.current !== null) {
        window.clearTimeout(watchdogTimerRef.current);
        watchdogTimerRef.current = null;
      }
      inFlightSignatureRef.current = "";
      setWorkerFailed(true);
    };

    worker.addEventListener("message", handleMessage as EventListener);
    worker.addEventListener("error", handleError as EventListener);

    return () => {
      worker.removeEventListener("message", handleMessage as EventListener);
      worker.removeEventListener("error", handleError as EventListener);
      worker.terminate();
      if (watchdogTimerRef.current !== null) {
        window.clearTimeout(watchdogTimerRef.current);
        watchdogTimerRef.current = null;
      }
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const inputSignature = buildViewBaseDerivedInputSignature(input);
    const cached = resultCacheRef.current.get(inputSignature);
    if (cached) {
      if (appliedSignatureRef.current !== inputSignature) {
        appliedSignatureRef.current = inputSignature;
        setDerived(cached);
      }
      return;
    }

    if (workerFailed || !workerRef.current) {
      const computed = computeViewBaseDerived(input);
      resultCacheRef.current.set(inputSignature, computed);
      appliedSignatureRef.current = inputSignature;
      setDerived(computed);
      return;
    }

    if (inFlightSignatureRef.current === inputSignature) return;

    const nextRequestId = requestIdRef.current + 1;
    requestIdRef.current = nextRequestId;
    inFlightSignatureRef.current = inputSignature;
    signatureByRequestIdRef.current.set(nextRequestId, inputSignature);
    if (watchdogTimerRef.current !== null) {
      window.clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
    const payload: ViewBaseDerivedWorkerRequest = {
      requestId: nextRequestId,
      input,
    };
    workerRef.current.postMessage(payload);
    watchdogTimerRef.current = window.setTimeout(() => {
      if (nextRequestId !== requestIdRef.current) return;
      if (inFlightSignatureRef.current !== inputSignature) return;
      inFlightSignatureRef.current = "";
      setWorkerFailed(true);
      const computed = computeViewBaseDerived(input);
      resultCacheRef.current.set(inputSignature, computed);
      appliedSignatureRef.current = inputSignature;
      setDerived(computed);
    }, DERIVED_WORKER_WATCHDOG_MS);
  }, [input, workerFailed]);

  return derived;
};
