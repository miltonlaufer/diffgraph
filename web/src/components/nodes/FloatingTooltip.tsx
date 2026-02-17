import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface CursorAnchor {
  type: "cursor";
  x: number;
  y: number;
}

interface ElementAnchor {
  type: "element";
  ref: React.RefObject<HTMLElement | null>;
}

type TooltipAnchor = CursorAnchor | ElementAnchor;

interface FloatingTooltipProps {
  visible: boolean;
  anchor: TooltipAnchor;
  children: React.ReactNode;
  style?: React.CSSProperties;
  offset?: number;
  viewportMargin?: number;
}

const DEFAULT_OFFSET = 8;
const DEFAULT_MARGIN = 12;

const FloatingTooltip = ({
  visible,
  anchor,
  children,
  style,
  offset = DEFAULT_OFFSET,
  viewportMargin = DEFAULT_MARGIN,
}: FloatingTooltipProps) => {
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [tooltipSize, setTooltipSize] = useState({ width: 0, height: 0 });
  const [position, setPosition] = useState({ left: viewportMargin, top: viewportMargin });

  const updatePosition = useCallback(() => {
    if (!visible || typeof window === "undefined") return;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = tooltipSize.width;
    const height = tooltipSize.height;

    let anchorLeft = 0;
    let anchorTop = 0;
    let anchorBottom = 0;

    if (anchor.type === "cursor") {
      anchorLeft = anchor.x;
      anchorTop = anchor.y;
      anchorBottom = anchor.y;
    } else {
      if (!anchor.ref.current) return;
      const rect = anchor.ref.current.getBoundingClientRect();
      anchorLeft = rect.left + (rect.width / 2);
      anchorTop = rect.top;
      anchorBottom = rect.bottom;
    }

    const preferredLeft = anchorLeft - (width / 2);
    const maxLeft = Math.max(viewportMargin, viewportWidth - width - viewportMargin);
    const left = Math.min(Math.max(viewportMargin, preferredLeft), maxLeft);

    const preferredTop = anchor.type === "cursor" ? anchorTop - offset - height : anchorBottom + offset;
    const wouldOverflowBottom = preferredTop + height + viewportMargin > viewportHeight;
    const topWhenAbove = anchorTop - offset - height;
    const topUnclamped = anchor.type === "cursor" || !wouldOverflowBottom ? preferredTop : topWhenAbove;
    const maxTop = Math.max(viewportMargin, viewportHeight - height - viewportMargin);
    const top = Math.min(Math.max(viewportMargin, topUnclamped), maxTop);

    setPosition((prev) => (
      Math.abs(prev.left - left) < 0.5 && Math.abs(prev.top - top) < 0.5
        ? prev
        : { left, top }
    ));
  }, [anchor, offset, tooltipSize.height, tooltipSize.width, viewportMargin, visible]);

  useLayoutEffect(() => {
    if (!visible || !tooltipRef.current) return;
    const rect = tooltipRef.current.getBoundingClientRect();
    setTooltipSize((prev) => (
      Math.abs(prev.width - rect.width) < 0.5 && Math.abs(prev.height - rect.height) < 0.5
        ? prev
        : { width: rect.width, height: rect.height }
    ));
  }, [children, visible]);

  useEffect(() => {
    if (!visible || typeof window === "undefined") return undefined;
    let animationFrameId = 0;
    const tick = () => {
      updatePosition();
      animationFrameId = window.requestAnimationFrame(tick);
    };
    tick();
    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [updatePosition, visible]);

  const mergedStyle = useMemo<React.CSSProperties>(
    () => ({
      position: "fixed",
      left: position.left,
      top: position.top,
      zIndex: 3000,
      pointerEvents: "none",
      visibility: tooltipSize.width > 0 && tooltipSize.height > 0 ? "visible" : "hidden",
      ...style,
    }),
    [position.left, position.top, style, tooltipSize.height, tooltipSize.width],
  );

  if (!visible || typeof document === "undefined") return null;

  return createPortal(
    <div ref={tooltipRef} style={mergedStyle}>
      {children}
    </div>,
    document.body,
  );
};

export default memo(FloatingTooltip);
