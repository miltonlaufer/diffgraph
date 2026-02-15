import { useEffect, type MutableRefObject } from "react";
import { SplitGraphPanelStore } from "./store";

export const useFlowContainerSize = (
  flowContainerRef: MutableRefObject<HTMLDivElement | null>,
  store: SplitGraphPanelStore,
): void => {
  useEffect(() => {
    const el = flowContainerRef.current;
    if (!el) return;

    const update = (): void => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        store.setFlowSize({ width: rect.width, height: rect.height });
      }
    };

    update();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => update());
      observer.observe(el);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [flowContainerRef, store]);
};
