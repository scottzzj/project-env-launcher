import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

function EnvironmentFormModal({ initialEnvironment, isBusy, mode, onClose, onSubmit }) {
  const [form, setForm] = useState({
    name: '',
  });
  const recordKey = mode === 'edit' ? initialEnvironment?.id ?? '' : 'create';

  useEffect(() => {
    setForm({
      name: initialEnvironment?.name ?? '',
    });
  }, [recordKey]);

  const title = mode === 'edit' ? '编辑环境' : '新建环境';
  const canSubmit = form.name.trim() && !isBusy;

  function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    onSubmit({
      name: form.name.trim(),
    });
  }

  return (
    <div className="form-modal-overlay" role="presentation">
      <form className="form-modal" aria-label={title} onSubmit={handleSubmit}>
        <div className="form-modal-header">
          <h2>{title}</h2>
          <button type="button" aria-label="关闭环境表单" onClick={onClose}>
            <X size={22} />
          </button>
        </div>

        <div className="form-modal-body">
          <label htmlFor="environment-name-input">
            环境名称
            <input
              id="environment-name-input"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="例如：开发环境"
            />
          </label>
        </div>

        <div className="form-modal-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="submit" disabled={!canSubmit}>
            {isBusy ? '保存中' : '保存'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default EnvironmentFormModal;
