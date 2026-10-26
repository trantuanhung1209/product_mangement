import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";

interface ConfirmDialogProps {
  busy?: boolean;
  confirmLabel?: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}

const FOCUSABLE = "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";

export function ConfirmDialog({
  busy = false,
  confirmLabel = "Xác nhận",
  description,
  onCancel,
  onConfirm,
  title,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Open on the safe choice, give focus back to what opened the dialog, and stop the page
    // behind it from scrolling.
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    cancelRef.current?.focus();
    return () => {
      document.documentElement.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
      if (event.key !== "Tab") return;
      // Keep Tab inside the dialog so keyboard users cannot reach the page behind it.
      const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (!controls.length) {
        event.preventDefault();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel]);

  return (
    <div className="modal-backdrop" role="presentation" data-lenis-prevent>
      <section
        ref={dialogRef}
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
      >
        <AlertTriangle size={24} aria-hidden="true" />
        <h2 id="delete-dialog-title">{title}</h2>
        <p id="delete-dialog-description">{description}</p>
        <div className="dialog-actions">
          <button
            ref={cancelRef}
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onCancel}
          >
            Hủy
          </button>
          <button
            type="button"
            className="danger-button"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Đang xử lý..." : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
