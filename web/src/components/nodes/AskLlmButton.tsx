import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

interface AskLlmButtonProps {
  visible: boolean;
  onAskLlm?: () => Promise<boolean> | boolean;
  askLlmHref?: string;
  onHoverChange?: (hovered: boolean) => void;
  style?: CSSProperties;
}

const panelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: 4,
  borderRadius: 8,
  background: "rgba(2, 6, 23, 0.94)",
  border: "1px solid rgba(56, 189, 248, 0.5)",
  boxShadow: "0 10px 20px rgba(2, 6, 23, 0.45)",
  minWidth: 104,
};

const actionStyle: CSSProperties = {
  border: "1px solid rgba(56, 189, 248, 0.7)",
  background: "#0c4a6e",
  color: "#e0f2fe",
  borderRadius: 6,
  padding: "4px 8px",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.1,
  cursor: "pointer",
  lineHeight: 1.15,
  whiteSpace: "nowrap",
  textAlign: "center",
  textDecoration: "none",
  display: "block",
  transition: "background-color 120ms ease, border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease",
};

const messageStyle: CSSProperties = {
  position: "fixed",
  background: "#064e3b",
  border: "1px solid #34d399",
  color: "#d1fae5",
  borderRadius: 6,
  padding: "4px 8px",
  fontSize: 10,
  lineHeight: 1.25,
  minWidth: 210,
  boxShadow: "0 6px 14px rgba(2, 6, 23, 0.4)",
  pointerEvents: "none",
  zIndex: 14000,
};

const anchorStyle: CSSProperties = {
  position: "absolute",
  top: 2,
  left: "calc(100% + 4px)",
  zIndex: 5000,
};

const AskLlmButton = ({ visible, onAskLlm, askLlmHref, onHoverChange, style }: AskLlmButtonProps) => {
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const [hoveredAction, setHoveredAction] = useState<"" | "copy" | "open">("");
  const [messagePosition, setMessagePosition] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
  }, []);

  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleClick = useCallback(async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!onAskLlm || status === "copying") return;

    setStatus("copying");
    const ok = await Promise.resolve(onAskLlm()).catch(() => false);
    setStatus(ok ? "copied" : "failed");

    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = window.setTimeout(() => {
      setStatus("idle");
      resetTimerRef.current = null;
    }, ok ? 1800 : 2500);
  }, [onAskLlm, status]);

  const handleLinkClick = useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
    event.stopPropagation();
    if (!askLlmHref) {
      event.preventDefault();
    }
  }, [askLlmHref]);
  const handleCopyHoverEnter = useCallback(() => setHoveredAction("copy"), []);
  const handleOpenHoverEnter = useCallback(() => setHoveredAction("open"), []);
  const handleHoverLeave = useCallback(() => setHoveredAction(""), []);
  const handlePanelMouseEnter = useCallback(() => {
    onHoverChange?.(true);
  }, [onHoverChange]);
  const handlePanelMouseLeave = useCallback(() => {
    onHoverChange?.(false);
    setHoveredAction("");
  }, [onHoverChange]);
  const updateMessagePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setMessagePosition({
      left: rect.left,
      top: rect.bottom + 7,
    });
  }, []);

  useEffect(() => {
    if (status !== "copied") return;
    updateMessagePosition();
    window.addEventListener("resize", updateMessagePosition);
    window.addEventListener("scroll", updateMessagePosition, true);
    return () => {
      window.removeEventListener("resize", updateMessagePosition);
      window.removeEventListener("scroll", updateMessagePosition, true);
    };
  }, [status, updateMessagePosition]);

  if (!visible || (!onAskLlm && !askLlmHref)) return null;

  return (
    <div
      ref={anchorRef}
      style={{ ...anchorStyle, ...style }}
      onMouseEnter={handlePanelMouseEnter}
      onMouseLeave={handlePanelMouseLeave}
    >
      <div style={panelStyle}>
        {onAskLlm && (
          <button
            type="button"
            onMouseDown={handleMouseDown}
            onClick={handleClick}
            onMouseEnter={handleCopyHoverEnter}
            onMouseLeave={handleHoverLeave}
            style={{
              ...actionStyle,
              ...(status === "copied"
                ? { borderColor: "#34d399", background: "#065f46", color: "#d1fae5" }
                : status === "failed"
                  ? { borderColor: "#fb7185", background: "#4c0519", color: "#ffe4e6" }
                  : status === "copying"
                    ? { borderColor: "#93c5fd", background: "#155e75", color: "#e0f2fe", cursor: "wait" }
                    : hoveredAction === "copy"
                      ? {
                        borderColor: "#7dd3fc",
                        background: "#075985",
                        boxShadow: "0 0 0 1px rgba(125, 211, 252, 0.35), 0 0 14px rgba(56, 189, 248, 0.28)",
                        transform: "translateY(-1px)",
                      }
                    : {}),
            }}
            title="Copy a ready-to-send LLM prompt with this node and connected context"
          >
            {status === "copying" ? "Copying..." : status === "copied" ? "Copied" : status === "failed" ? "Retry copy" : "Copy prompt"}
          </button>
        )}
        {askLlmHref && (
          <a
            href={askLlmHref}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              ...actionStyle,
              borderColor: hoveredAction === "open" ? "#a5b4fc" : "rgba(125, 211, 252, 0.6)",
              background: hoveredAction === "open" ? "#312e81" : "#1e3a8a",
              boxShadow: hoveredAction === "open"
                ? "0 0 0 1px rgba(165, 180, 252, 0.3), 0 0 14px rgba(99, 102, 241, 0.25)"
                : "none",
              transform: hoveredAction === "open" ? "translateY(-1px)" : "none",
            }}
            onMouseDown={handleMouseDown}
            onClick={handleLinkClick}
            onMouseEnter={handleOpenHoverEnter}
            onMouseLeave={handleHoverLeave}
          >
            Open ChatGPT ↗
          </a>
        )}
      </div>
      {status === "copied" && typeof document !== "undefined" && createPortal(
        <div style={{ ...messageStyle, left: messagePosition.left, top: messagePosition.top }}>
          Copied! Paste it into your LLM of choice to get an answer.
        </div>,
        document.body,
      )}
    </div>
  );
};

export default memo(AskLlmButton);
