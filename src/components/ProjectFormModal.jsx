import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

function inferProjectNameFromPath(projectPath = '') {
  const normalizedPath = String(projectPath).trim().replace(/[\\/]+$/g, '');
  const pathParts = normalizedPath.split(/[\\/]+/).filter(Boolean);

  return pathParts.at(-1) ?? '';
}

function ProjectFormModal({ initialProject, isBusy, mode, onClose, onPickPath, onSubmit }) {
  const [form, setForm] = useState({ name: '', path: '' });
  const [pathPickerType, setPathPickerType] = useState('');
  const [pathPickerError, setPathPickerError] = useState('');
  const recordKey = mode === 'edit' ? initialProject?.id ?? '' : 'create';

  useEffect(() => {
    setForm({
      name: initialProject?.name ?? '',
      path: initialProject?.path ?? '',
    });
    setPathPickerError('');
  }, [recordKey]);

  const title = mode === 'edit' ? '编辑工作副本' : '新建工作副本';
  const canSubmit = form.name.trim() && form.path.trim() && !isBusy;

  function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    onSubmit({ name: form.name.trim(), path: form.path.trim() });
  }

  function updateProjectPath(pathValue) {
    setForm((current) => {
      const inferredName = inferProjectNameFromPath(pathValue);
      const previousInferredName = inferProjectNameFromPath(current.path);
      const canAutoFillName =
        mode === 'create' && inferredName && (!current.name.trim() || current.name === previousInferredName);

      // Only auto-fill while creating, and do not overwrite a name the user has customized.
      return {
        ...current,
        path: pathValue,
        name: canAutoFillName ? inferredName : current.name,
      };
    });
  }

  async function handlePickPath(type) {
    if (!onPickPath || pathPickerType) {
      return;
    }

    setPathPickerType(type);
    setPathPickerError('');
    try {
      const selectedPath = await onPickPath(type);
      if (selectedPath) {
        updateProjectPath(selectedPath);
      }
    } catch (error) {
      setPathPickerError(error.message || '路径选择失败');
    } finally {
      setPathPickerType('');
    }
  }

  return (
    <div className="form-modal-overlay" role="presentation">
      <form className="form-modal" aria-label={title} onSubmit={handleSubmit}>
        <div className="form-modal-header">
          <h2>{title}</h2>
          <button type="button" aria-label="关闭项目表单" onClick={onClose}>
            <X size={22} />
          </button>
        </div>

        <div className="form-modal-body">
          <label htmlFor="project-name-input">
            工作副本名称
            <input
              id="project-name-input"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="例如：本地服务"
            />
          </label>
          <label htmlFor="project-path-input">
            工作副本路径
            <div className="path-input-row">
              <input
                id="project-path-input"
                value={form.path}
                onChange={(event) => updateProjectPath(event.target.value)}
                placeholder="例如：D:\\Workspace\\order-service"
              />
              <button
                type="button"
                onClick={() => handlePickPath('folder')}
                disabled={isBusy || Boolean(pathPickerType)}
              >
                {pathPickerType === 'folder' ? '选择中' : '选择文件夹'}
              </button>
            </div>
            {pathPickerError ? <span className="field-error">{pathPickerError}</span> : null}
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

export default ProjectFormModal;
