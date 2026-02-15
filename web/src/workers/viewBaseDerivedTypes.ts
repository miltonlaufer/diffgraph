import type { ViewBaseDerivedInput, ViewBaseDerivedResult } from "#/views/viewBase/derived";

export interface ViewBaseDerivedWorkerRequest {
  requestId: number;
  input: ViewBaseDerivedInput;
}

export interface ViewBaseDerivedWorkerSuccess {
  requestId: number;
  ok: true;
  result: ViewBaseDerivedResult;
}

export interface ViewBaseDerivedWorkerFailure {
  requestId: number;
  ok: false;
  error: string;
}

export type ViewBaseDerivedWorkerResponse = ViewBaseDerivedWorkerSuccess | ViewBaseDerivedWorkerFailure;

