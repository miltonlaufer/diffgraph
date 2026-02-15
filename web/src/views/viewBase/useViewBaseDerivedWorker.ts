import { useEffect, useRef, useState } from "react";
import { computeViewBaseDerived, type ViewBaseDerivedInput, type ViewBaseDerivedResult } from "./derived";
import type { ViewBaseDerivedWorkerRequest, ViewBaseDerivedWorkerResponse } from "#/workers/viewBaseDerivedTypes";

export const useViewBaseDerivedWorker = (
  input: ViewBaseDerivedInput,
): ViewBaseDerivedResult => {
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const [workerFailed, setWorkerFailed] = useState(false);
  const [derived, setDerived] = useState<ViewBaseDerivedResult>(() => computeViewBaseDerived(input));

  useEffect(() => {
    const worker = new Worker(new URL("../../workers/viewBaseDerivedWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    const handleMessage = (event: MessageEvent<ViewBaseDerivedWorkerResponse>): void => {
      const data = event.data;
      if (data.requestId !== requestIdRef.current) return;
      if (!data.ok) {
        setWorkerFailed(true);
        return;
      }
      setDerived(data.result);
    };

    const handleError = (): void => {
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
    if (workerFailed || !workerRef.current) {
      setDerived(computeViewBaseDerived(input));
      return;
    }
    const nextRequestId = requestIdRef.current + 1;
    requestIdRef.current = nextRequestId;
    const payload: ViewBaseDerivedWorkerRequest = {
      requestId: nextRequestId,
      input,
    };
    workerRef.current.postMessage(payload);
  }, [input, workerFailed]);

  return derived;
};

