const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;

export const hashInit = (): number => FNV_OFFSET_BASIS;

export const hashString = (hash: number, value: string): number => {
  let next = hash >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    next ^= value.charCodeAt(i);
    next = Math.imul(next, FNV_PRIME);
  }
  return next >>> 0;
};

export const hashBoolean = (hash: number, value: boolean): number =>
  hashString(hash, value ? "1" : "0");

export const hashNumber = (hash: number, value: number): number =>
  hashString(hash, String(value));

export const hashFinalize = (hash: number): string =>
  (hash >>> 0).toString(16);

export const lruSet = <T>(
  cache: Map<string, T>,
  key: string,
  value: T,
  maxEntries: number,
): void => {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);
  if (cache.size <= maxEntries) return;
  const oldestKey = cache.keys().next().value as string | undefined;
  if (oldestKey !== undefined) {
    cache.delete(oldestKey);
  }
};
