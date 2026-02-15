import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

interface AskLlmButtonProps {
  visible: boolean;
  onAskLlm?: () => Promise<boolean> | boolean;
  style?: CSSProperties;
}

const baseStyle: CSSProperties = {
  zIndex: 20,
  border: "1px solid #38bdf8",
  background: "#082f49",
  color: "#e0f2fe",
  borderRadius: 6,
  padding: "3px 7px",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.2,
  cursor: "pointer",
  boxShadow: "0 0 0 1px rgba(56, 189, 248, 0.35), 0 6px 12px rgba(2, 6, 23, 0.45)",
  lineHeight: 1.2,
  whiteSpace: "nowrap",
};

const messageStyle: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 6px)",
  right: 0,
  background: "#064e3b",
  border: "1px solid #34d399",
  color: "#d1fae5",
  borderRadius: 6,
  padding: "4px 7px",
  fontSize: 10,
  lineHeight: 1.25,
  minWidth: 240,
  boxShadow: "0 6px 14px rgba(2, 6, 23, 0.4)",
  pointerEvents: "none",
};

const anchorStyle: CSSProperties = {
  position: "absolute",
  top: -10,
  right: -10,
  zIndex: 20,
};

const AskLlmButton = ({ visible, onAskLlm, style }: AskLlmButtonProps) => {
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
  }, []);

  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
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

  if (!visible || !onAskLlm) return null;

  return (
    <div style={{ ...anchorStyle, ...style }}>
      <button
        type="button"
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        style={{
          ...baseStyle,
          position: "static",
          ...(status === "copied"
            ? { borderColor: "#34d399", background: "#064e3b", color: "#d1fae5" }
            : status === "failed"
              ? { borderColor: "#fb7185", background: "#4c0519", color: "#ffe4e6" }
              : status === "copying"
                ? { borderColor: "#93c5fd", background: "#0c4a6e", color: "#e0f2fe", cursor: "wait" }
                : {}),
        }}
        title="Copy a ready-to-send LLM prompt with this node and connected context"
      >
        {status === "copying" ? "Copying..." : status === "copied" ? "Copied" : status === "failed" ? "Retry copy" : "ASK LLM"}
      </button>
      {status === "copied" && (
        <div style={messageStyle}>
          Copied! Paste it into your LLM of choice to get an answer.
        </div>
      )}
    </div>
  );
};

export default memo(AskLlmButton);
