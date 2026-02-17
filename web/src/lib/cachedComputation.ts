import { lruSet } from "./memoHash";

interface CachedComputationOptions<Input, Result> {
  maxEntries: number;
  buildSignature: (input: Input) => string;
  compute: (input: Input) => Result;
}

export interface SignatureCache<Result> {
  has: (signature: string) => boolean;
  get: (signature: string) => Result | undefined;
  set: (signature: string, value: Result) => void;
  clear: () => void;
}

interface CachedComputationRunner<Input, Result> {
  run: (input: Input) => Result;
}

export const createSignatureCache = <Result>(maxEntries: number): SignatureCache<Result> => {
  const cache = new Map<string, Result>();
  return {
    has: (signature: string): boolean => cache.has(signature),
    get: (signature: string): Result | undefined => {
      if (!cache.has(signature)) return undefined;
      const cached = cache.get(signature) as Result;
      cache.delete(signature);
      cache.set(signature, cached);
      return cached;
    },
    set: (signature: string, value: Result): void => {
      lruSet(cache, signature, value, maxEntries);
    },
    clear: (): void => {
      cache.clear();
    },
  };
};

export const createCachedComputation = <Input, Result>({
  maxEntries,
  buildSignature,
  compute,
}: CachedComputationOptions<Input, Result>): CachedComputationRunner<Input, Result> => {
  const cache = createSignatureCache<Result>(maxEntries);
  return {
    run: (input: Input): Result => {
      const signature = buildSignature(input);
      if (cache.has(signature)) {
        return cache.get(signature) as Result;
      }
      const computed = compute(input);
      cache.set(signature, computed);
      return computed;
    },
  };
};
