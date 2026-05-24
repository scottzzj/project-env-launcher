import { Info, X } from 'lucide-react';

function MessageDialog({ message, onClose, title = '提示' }) {
  return (
    <div className="confirm-dialog-overlay" role="presentation" onClick={onClose}>
      <section
        className="confirm-dialog message-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="confirm-dialog-header">
          <span>
            <Info size={22} />
          </span>
          <button type="button" aria-label="关闭提示框" onClick={onClose}>
            <X size={21} />
          </button>
        </div>
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="confirm-dialog-actions">
          <button type="button" onClick={onClose}>
            我知道了
          </button>
        </div>
      </section>
    </div>
  );
}

export default MessageDialog;
