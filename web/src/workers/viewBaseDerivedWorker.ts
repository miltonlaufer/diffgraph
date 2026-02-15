import { computeViewBaseDerived } from "#/views/viewBase/derived";
import type { ViewBaseDerivedWorkerRequest, ViewBaseDerivedWorkerResponse } from "./viewBaseDerivedTypes";

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<ViewBaseDerivedWorkerRequest>) => void) | null;
  postMessage: (message: ViewBaseDerivedWorkerResponse) => void;
};

workerScope.onmessage = (event: MessageEvent<ViewBaseDerivedWorkerRequest>) => {
  const { requestId, input } = event.data;
  try {
    const result = computeViewBaseDerived(input);
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

