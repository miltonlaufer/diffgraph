import { useEffect, useCallback } from "react";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  ariaLabel: string;
}

export const ConfirmModal = ({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  ariaLabel,
}: ConfirmModalProps): React.ReactElement | null => {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent): void => {
      if (!open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
          event.stopImmediatePropagation();
        }
        onCancel();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
          event.stopImmediatePropagation();
        }
        onConfirm();
      }
    },
    [onCancel, onConfirm, open],
  );

  useEffect(() => {
    if (!open) return undefined;
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [handleKeyDown, open]);

  if (!open || typeof document === "undefined") return null;

  return (
    <div
      className="confirmModalBackdrop"
      role="presentation"
      onClick={onCancel}
    >
      <section
        className="confirmModal"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="confirmModalHeader">
          <h3 className="confirmModalTitle">{title}</h3>
        </header>
        <div className="confirmModalBody">
          {message}
        </div>
        <footer className="confirmModalFooter">
          <button
            type="button"
            className="confirmModalBtn confirmModalBtnPrimary"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            className="confirmModalBtn confirmModalBtnSecondary"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
        </footer>
      </section>
    </div>
  );
};
