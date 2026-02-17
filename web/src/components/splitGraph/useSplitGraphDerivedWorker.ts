import { useEffect, useRef, useState } from "react";
import {
  buildSplitGraphDerivedInputSignature,
  computeSplitGraphDerived,
  type SplitGraphDerivedInput,
  type SplitGraphDerivedResult,
} from "./derived";
import { createSignatureCache } from "#/lib/cachedComputation";
import type { SplitGraphDerivedWorkerRequest, SplitGraphDerivedWorkerResponse } from "#/workers/splitGraphDerivedTypes";

const DERIVED_CACHE_MAX_ENTRIES = 24;

export const useSplitGraphDerivedWorker = (
  input: SplitGraphDerivedInput,
): SplitGraphDerivedResult => {
  const [initialState] = useState(() => {
    const initialResult = computeSplitGraphDerived(input);
    const initialSignature = buildSplitGraphDerivedInputSignature(input);
    const cache = createSignatureCache<SplitGraphDerivedResult>(DERIVED_CACHE_MAX_ENTRIES);
    cache.set(initialSignature, initialResult);
    return { initialResult, initialSignature, cache };
  });
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const inFlightSignatureRef = useRef("");
  const signatureByRequestIdRef = useRef<Map<number, string>>(new Map());
  const resultCacheRef = useRef(initialState.cache);
  const appliedSignatureRef = useRef(initialState.initialSignature);
  const [workerFailed, setWorkerFailed] = useState(false);
  const [derived, setDerived] = useState<SplitGraphDerivedResult>(initialState.initialResult);

  useEffect(() => {
    const worker = new Worker(new URL("../../workers/splitGraphDerivedWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    const handleMessage = (event: MessageEvent<SplitGraphDerivedWorkerResponse>): void => {
      const data = event.data;
      const inputSignature = signatureByRequestIdRef.current.get(data.requestId) ?? "";
      signatureByRequestIdRef.current.delete(data.requestId);
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
      inFlightSignatureRef.current = "";
      setWorkerFailed(true);
    };

    worker.addEventListener("message", handleMessage as EventListener);
    worker.addEventListener("error", handleError as EventListener);

    return () => {
      worker.removeEventListener("message", handleMessage as EventListener);
      worker.removeEventListener("error", handleError as EventListener);
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const inputSignature = buildSplitGraphDerivedInputSignature(input);
    const cached = resultCacheRef.current.get(inputSignature);
    if (cached) {
      if (appliedSignatureRef.current !== inputSignature) {
        appliedSignatureRef.current = inputSignature;
        setDerived(cached);
      }
      return;
    }

    if (workerFailed || !workerRef.current) {
      const computed = computeSplitGraphDerived(input);
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
    const payload: SplitGraphDerivedWorkerRequest = {
      requestId: nextRequestId,
      input,
    };
    workerRef.current.postMessage(payload);
  }, [input, workerFailed]);

  return derived;
};
