import { useEffect, useState } from "react";

export const useDebouncedValue = <T,>(value: T, delayMs = 500): T => {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [delayMs, value]);

  return debounced;
};

