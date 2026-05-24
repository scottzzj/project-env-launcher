import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

function ModuleFormModal({ initialModule, isBusy, modules, onClose, onSubmit }) {
  const [form, setForm] = useState({ moduleId: '', defaultPort: '' });
  const recordKey = initialModule?.id ?? '';

  function getDisplayName(moduleItem) {
    return moduleItem?.name ?? moduleItem?.detectedName ?? moduleItem?.id ?? '';
  }

  useEffect(() => {
    const fallbackModule = initialModule ?? modules[0] ?? null;
    setForm({
      moduleId: fallbackModule?.id ?? '',
      defaultPort: fallbackModule?.defaultPort ? String(fallbackModule.defaultPort) : '',
    });
  }, [modules, recordKey]);

  function handleModuleChange(event) {
    const nextModule = modules.find((moduleItem) => moduleItem.id === event.target.value);
    if (!nextModule) {
      return;
    }

    setForm({
      moduleId: nextModule.id,
      defaultPort: nextModule.defaultPort ? String(nextModule.defaultPort) : '',
    });
  }

  const parsedPort = Number(form.defaultPort);
  const selectedModule = modules.find((moduleItem) => moduleItem.id === form.moduleId) ?? null;
  const canSubmit = form.moduleId && Number.isInteger(parsedPort) && parsedPort > 0 && !isBusy;

  function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    onSubmit({
      moduleId: form.moduleId,
      name: getDisplayName(selectedModule),
      defaultPort: parsedPort,
    });
  }

  return (
    <div className="form-modal-overlay" role="presentation">
      <form className="form-modal" aria-label="编辑模块" onSubmit={handleSubmit}>
        <div className="form-modal-header">
          <h2>编辑模块</h2>
          <button type="button" aria-label="关闭模块表单" onClick={onClose}>
            <X size={22} />
          </button>
        </div>

        <div className="form-modal-body">
          <label htmlFor="module-select-input">
            识别模块
            <select id="module-select-input" value={form.moduleId} onChange={handleModuleChange}>
              {modules.map((moduleItem) => (
                <option value={moduleItem.id} key={moduleItem.id}>
                  {moduleItem.detectedName ?? moduleItem.id}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="module-port-input">
            端口
            <input
              id="module-port-input"
              value={form.defaultPort}
              onChange={(event) => setForm((current) => ({ ...current, defaultPort: event.target.value }))}
              inputMode="numeric"
              placeholder="例如：8084"
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

export default ModuleFormModal;
