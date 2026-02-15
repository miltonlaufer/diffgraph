import type { SplitGraphDerivedInput, SplitGraphDerivedResult } from "#/components/splitGraph/derived";

export interface SplitGraphDerivedWorkerRequest {
  requestId: number;
  input: SplitGraphDerivedInput;
}

export interface SplitGraphDerivedWorkerSuccess {
  requestId: number;
  ok: true;
  result: SplitGraphDerivedResult;
}

export interface SplitGraphDerivedWorkerFailure {
  requestId: number;
  ok: false;
  error: string;
}

export type SplitGraphDerivedWorkerResponse = SplitGraphDerivedWorkerSuccess | SplitGraphDerivedWorkerFailure;

