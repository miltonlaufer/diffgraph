import { useEffect, useRef, useState } from "react";
import { computeViewBaseDerived, type ViewBaseDerivedInput, type ViewBaseDerivedResult } from "./derived";
import type { ViewBaseDerivedWorkerRequest, ViewBaseDerivedWorkerResponse } from "#/workers/viewBaseDerivedTypes";
import { hashBoolean, hashFinalize, hashInit, hashNumber, hashString, lruSet } from "#/lib/memoHash";

const VIEW_BASE_DERIVED_CACHE_MAX_ENTRIES = 12;

const hashGraphForSignature = (
  hash: number,
  graph: ViewBaseDerivedInput["oldGraph"],
): number => {
  let next = hashNumber(hash, graph.nodes.length);
  for (const node of graph.nodes) {
    next = hashString(next, node.id);
    next = hashString(next, node.kind);
    next = hashString(next, node.label);
    next = hashString(next, node.filePath);
    next = hashString(next, node.diffStatus);
    next = hashString(next, node.parentId ?? "");
    next = hashString(next, node.branchType ?? "");
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

const buildViewBaseInputSignature = (input: ViewBaseDerivedInput): string => {
  let hash = hashInit();
  hash = hashGraphForSignature(hash, input.oldGraph);
  hash = hashGraphForSignature(hash, input.newGraph);
  hash = hashString(hash, input.selectedFilePath);
  hash = hashBoolean(hash, input.showChangesOnly);
  hash = hashString(hash, input.viewType);
  return `${hashFinalize(hash)}:${input.oldGraph.nodes.length}:${input.newGraph.nodes.length}`;
};

export const useViewBaseDerivedWorker = (
  input: ViewBaseDerivedInput,
): ViewBaseDerivedResult => {
  const initialResultRef = useRef<ViewBaseDerivedResult | null>(null);
  if (!initialResultRef.current) {
    initialResultRef.current = computeViewBaseDerived(input);
  }
  const initialSignatureRef = useRef("");
  if (!initialSignatureRef.current) {
    initialSignatureRef.current = buildViewBaseInputSignature(input);
  }
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const inFlightSignatureRef = useRef("");
  const signatureByRequestIdRef = useRef<Map<number, string>>(new Map());
  const resultCacheRef = useRef<Map<string, ViewBaseDerivedResult>>(new Map([
    [initialSignatureRef.current, initialResultRef.current!],
  ]));
  const appliedSignatureRef = useRef(initialSignatureRef.current);
  const [workerFailed, setWorkerFailed] = useState(false);
  const [derived, setDerived] = useState<ViewBaseDerivedResult>(initialResultRef.current!);

  useEffect(() => {
    const worker = new Worker(new URL("../../workers/viewBaseDerivedWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    const handleMessage = (event: MessageEvent<ViewBaseDerivedWorkerResponse>): void => {
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
        lruSet(resultCacheRef.current, inputSignature, data.result, VIEW_BASE_DERIVED_CACHE_MAX_ENTRIES);
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
    const inputSignature = buildViewBaseInputSignature(input);
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
      lruSet(resultCacheRef.current, inputSignature, computed, VIEW_BASE_DERIVED_CACHE_MAX_ENTRIES);
      appliedSignatureRef.current = inputSignature;
      setDerived(computed);
      return;
    }

    if (inFlightSignatureRef.current === inputSignature) return;

    const nextRequestId = requestIdRef.current + 1;
    requestIdRef.current = nextRequestId;
    inFlightSignatureRef.current = inputSignature;
    signatureByRequestIdRef.current.set(nextRequestId, inputSignature);
    const payload: ViewBaseDerivedWorkerRequest = {
      requestId: nextRequestId,
      input,
    };
    workerRef.current.postMessage(payload);
  }, [input, workerFailed]);

  return derived;
};
