import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

interface ConfirmDialogProps {
  busy?: boolean;
  confirmLabel?: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}

export function ConfirmDialog({ busy = false, confirmLabel = "Xác nhận", description, onCancel, onConfirm, title }: ConfirmDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel]);

  return <div className="modal-backdrop" role="presentation"><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title"><AlertTriangle size={24} aria-hidden="true" /><h2 id="delete-dialog-title">{title}</h2><p>{description}</p><div className="dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>Hủy</button><button type="button" className="danger-button" disabled={busy} onClick={onConfirm}>{busy ? "Đang xử lý..." : confirmLabel}</button></div></section></div>;
}
