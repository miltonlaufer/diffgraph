import { computeSplitGraphDerived } from "#/components/splitGraph/derived";
import type { SplitGraphDerivedWorkerRequest, SplitGraphDerivedWorkerResponse } from "./splitGraphDerivedTypes";

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<SplitGraphDerivedWorkerRequest>) => void) | null;
  postMessage: (message: SplitGraphDerivedWorkerResponse) => void;
};

workerScope.onmessage = (event: MessageEvent<SplitGraphDerivedWorkerRequest>) => {
  const { requestId, input } = event.data;
  try {
    const result = computeSplitGraphDerived(input);
    workerScope.postMessage({
      requestId,
      ok: true,
      result,
    });
  } catch (reason) {
    workerScope.postMessage({
      requestId,
      ok: false,
      error: reason instanceof Error ? reason.message : String(reason),
    });
  }
};

