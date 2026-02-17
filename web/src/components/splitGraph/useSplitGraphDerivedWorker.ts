import { useEffect, useRef, useState } from "react";
import {
  computeSplitGraphDerived,
  type SplitGraphDerivedInput,
  type SplitGraphDerivedResult,
} from "./derived";
import type { SplitGraphDerivedWorkerRequest, SplitGraphDerivedWorkerResponse } from "#/workers/splitGraphDerivedTypes";
import { hashBoolean, hashFinalize, hashInit, hashNumber, hashString, lruSet } from "#/lib/memoHash";

const DERIVED_CACHE_MAX_ENTRIES = 24;

const buildDerivedInputSignature = (input: SplitGraphDerivedInput): string => {
  let hash = hashInit();
  hash = hashString(hash, input.searchQuery);
  hash = hashBoolean(hash, input.searchExclude);
  hash = hashNumber(hash, input.positionedNodeIds.length);
  for (const nodeId of input.positionedNodeIds) {
    hash = hashString(hash, nodeId);
  }
  hash = hashNumber(hash, input.positionedEdges.length);
  for (const edge of input.positionedEdges) {
    hash = hashString(hash, edge.id);
    hash = hashString(hash, edge.source);
    hash = hashString(hash, edge.target);
    hash = hashString(hash, edge.relation ?? "-");
  }
  return `${hashFinalize(hash)}:${input.positionedNodeIds.length}:${input.positionedEdges.length}`;
};

export const useSplitGraphDerivedWorker = (
  input: SplitGraphDerivedInput,
): SplitGraphDerivedResult => {
  const initialResultRef = useRef<SplitGraphDerivedResult | null>(null);
  if (!initialResultRef.current) {
    initialResultRef.current = computeSplitGraphDerived(input);
  }
  const initialSignatureRef = useRef("");
  if (!initialSignatureRef.current) {
    initialSignatureRef.current = buildDerivedInputSignature(input);
  }
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const inFlightSignatureRef = useRef("");
  const signatureByRequestIdRef = useRef<Map<number, string>>(new Map());
  const resultCacheRef = useRef<Map<string, SplitGraphDerivedResult>>(new Map([
    [initialSignatureRef.current, initialResultRef.current!],
  ]));
  const appliedSignatureRef = useRef(initialSignatureRef.current);
  const [workerFailed, setWorkerFailed] = useState(false);
  const [derived, setDerived] = useState<SplitGraphDerivedResult>(initialResultRef.current!);

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
        lruSet(resultCacheRef.current, inputSignature, data.result, DERIVED_CACHE_MAX_ENTRIES);
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
    const inputSignature = buildDerivedInputSignature(input);
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
      lruSet(resultCacheRef.current, inputSignature, computed, DERIVED_CACHE_MAX_ENTRIES);
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
