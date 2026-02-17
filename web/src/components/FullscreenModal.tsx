import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface FullscreenModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel: string;
  className?: string;
}

export const FullscreenModal = ({
  open,
  onClose,
  children,
  ariaLabel,
  className,
}: FullscreenModalProps) => {
  useEffect(() => {
    if (!open) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fullscreenModalBackdrop"
      role="presentation"
      onClick={onClose}
    >
      <section
        className={`fullscreenModalSurface${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </section>
    </div>,
    document.body,
  );
};

export default FullscreenModal;
