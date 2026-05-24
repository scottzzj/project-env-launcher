import { AlertTriangle, X } from 'lucide-react';

function ConfirmDialog({
  cancelText = '取消',
  confirmText = '确认删除',
  isBusy,
  message,
  onCancel,
  onConfirm,
  title,
}) {
  return (
    <div className="confirm-dialog-overlay" role="presentation" onClick={onCancel}>
      <section
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="confirm-dialog-header">
          <span>
            <AlertTriangle size={22} />
          </span>
          <button type="button" aria-label="关闭确认框" onClick={onCancel} disabled={isBusy}>
            <X size={21} />
          </button>
        </div>
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="confirm-dialog-actions">
          <button type="button" onClick={onCancel} disabled={isBusy}>
            {cancelText}
          </button>
          <button type="button" onClick={onConfirm} disabled={isBusy}>
            {isBusy ? '删除中' : confirmText}
          </button>
        </div>
      </section>
    </div>
  );
}

export default ConfirmDialog;
