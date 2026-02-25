import { createPortal } from "react-dom";

const EDGE_TOOLTIP_OFFSET_X = 12;
const EDGE_TOOLTIP_OFFSET_Y = 14;

interface EdgeTooltipOverlayProps {
  pointerX: number;
  pointerY: number;
  sourceText: string;
  targetText: string;
}

export const EdgeTooltipOverlay = ({
  pointerX,
  pointerY,
  sourceText,
  targetText,
}: EdgeTooltipOverlayProps) => {
  const style = {
    position: "fixed" as const,
    left: `${pointerX + EDGE_TOOLTIP_OFFSET_X}px`,
    top: `${pointerY + EDGE_TOOLTIP_OFFSET_Y}px`,
    zIndex: 1200,
    pointerEvents: "none" as const,
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 8,
    padding: "8px 10px",
    maxWidth: "min(560px, calc(100vw - 24px))",
    boxShadow: "0 8px 22px rgba(2, 6, 23, 0.75)",
    color: "#e2e8f0",
    fontSize: 11,
    lineHeight: 1.35,
    fontFamily: "JetBrains Mono, Fira Code, Consolas, monospace",
    whiteSpace: "pre-wrap" as const,
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div style={style}>
      <div>
        <strong>Source:</strong> {sourceText}
      </div>
      <div>
        <strong>Target:</strong> {targetText}
      </div>
    </div>,
    document.body,
  );
};
