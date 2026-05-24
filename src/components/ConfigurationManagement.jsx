import { FileCog, RefreshCw, Save, Server } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

function cloneEditableGroups(groups = []) {
  return groups.map((group) => ({
    ...group,
    fields: (group.fields ?? []).map((field) => ({ ...field })),
  }));
}

function flattenFields(groups = []) {
  return groups.flatMap((group) =>
    (group.fields ?? []).map((field) => ({
      path: field.path,
      value: field.value ?? '',
    })),
  );
}

function isStartupGroup(group) {
  return group.groupKey === 'startup-nacos';
}

function getDefaultProject(projects = []) {
  return projects[0] ?? null;
}

function getPreferredModule(modules = []) {
  return modules.find((moduleItem) => moduleItem.defaultPort) ?? null;
}

function ConfigurationManagement({
  environments,
  environmentConfig,
  isEnvironmentConfigBusy,
  modules,
  onLoadEnvironmentConfig,
  onSaveEnvironmentConfig,
  projects,
}) {
  const [environmentCode, setEnvironmentCode] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [content, setContent] = useState('');
  const [editableGroups, setEditableGroups] = useState([]);
  const [notice, setNotice] = useState('');

  const selectedProject = useMemo(
    () => getDefaultProject(projects),
    [projects],
  );
  const selectedEnvironment = useMemo(
    () => environments.find((environment) => environment.code === environmentCode) ?? environments[0] ?? null,
    [environmentCode, environments],
  );
  const availableModules = useMemo(
    () =>
      selectedProject
        ? modules.filter(
            (moduleItem) => moduleItem.projectIds?.includes(selectedProject.id) && moduleItem.defaultPort,
          )
        : modules.filter((moduleItem) => moduleItem.defaultPort),
    [modules, selectedProject],
  );
  const selectedModule = useMemo(
    () => availableModules.find((moduleItem) => moduleItem.id === moduleId) ?? getPreferredModule(availableModules),
    [availableModules, moduleId],
  );

  const isLoadedSelection =
    environmentConfig?.project?.id === selectedProject?.id &&
    environmentConfig?.module?.id === selectedModule?.id &&
    environmentConfig?.environment?.code === selectedEnvironment?.code;
  const hasEditableFields = editableGroups.some((group) => group.fields?.length > 0);
  const canSaveConfig = isLoadedSelection && (content.trim() || hasEditableFields);

  useEffect(() => {
    setEnvironmentCode((currentCode) =>
      environments.some((environment) => environment.code === currentCode)
        ? currentCode
        : environments[0]?.code ?? '',
    );
  }, [environments]);

  useEffect(() => {
    setModuleId((currentId) =>
      availableModules.some((moduleItem) => moduleItem.id === currentId)
        ? currentId
        : getPreferredModule(availableModules)?.id ?? '',
    );
  }, [availableModules]);

  useEffect(() => {
    setNotice('');
  }, [selectedEnvironment?.code, selectedModule?.id]);

  useEffect(() => {
    if (!selectedProject || !selectedEnvironment || !selectedModule || !onLoadEnvironmentConfig) {
      return;
    }

    if (isLoadedSelection) {
      return;
    }

    onLoadEnvironmentConfig(selectedProject.id, selectedModule.id, selectedEnvironment.code);
  }, [isLoadedSelection, onLoadEnvironmentConfig, selectedProject, selectedEnvironment, selectedModule]);

  useEffect(() => {
    if (isLoadedSelection) {
      setContent(environmentConfig?.config?.content ?? '');
      setEditableGroups(cloneEditableGroups(environmentConfig?.config?.editableGroups ?? []));
      return;
    }

    setContent('');
    setEditableGroups([]);
  }, [environmentConfig?.config?.hash, isLoadedSelection]);

  function updateEditableField(groupKey, fieldPath, value) {
    const pathKey = fieldPath.join('.');
    setEditableGroups((currentGroups) =>
      currentGroups.map((group) =>
        group.groupKey === groupKey
          ? {
              ...group,
              fields: group.fields.map((field) =>
                field.path.join('.') === pathKey ? { ...field, value } : field,
              ),
            }
          : group,
      ),
    );
  }

  async function handleReloadConfig() {
    if (!selectedProject || !selectedEnvironment || !selectedModule || !onLoadEnvironmentConfig) {
      return;
    }

    setNotice('');
    try {
      await onLoadEnvironmentConfig(selectedProject.id, selectedModule.id, selectedEnvironment.code, {
        source: 'default',
      });
      setNotice('已从项目默认配置重新获取，保存后才会写入当前环境和模块的数据库配置。');
    } catch (error) {
      setNotice(`获取默认配置失败：${error.message}`);
    }
  }

  async function handleSaveConfig() {
    if (!selectedProject || !selectedEnvironment || !selectedModule || !onSaveEnvironmentConfig) {
      return;
    }

    try {
      const payload = await onSaveEnvironmentConfig({
        projectId: selectedProject.id,
        moduleId: selectedModule.id,
        environmentCode: selectedEnvironment.code,
        content,
        fields: flattenFields(editableGroups),
      });
      setNotice(payload.config?.saved ? '已保存到数据库，不会影响其他环境或模块。' : '已保存配置。');
    } catch (error) {
      setNotice(`保存失败：${error.message}`);
    }
  }

  if (projects.length === 0) {
    return (
      <section className="config-page" aria-label="配置管理">
        <div className="project-page-header">
          <div>
            <h2>配置管理</h2>
            <p>先添加项目目录后，再维护具体模块和环境的配置。</p>
          </div>
        </div>
        <section className="config-detail-empty">
          <Server size={34} />
          <h3>暂无项目</h3>
          <p>请先到项目管理添加本地项目目录。</p>
        </section>
      </section>
    );
  }

  if (!selectedProject || !selectedEnvironment || !selectedModule) {
    return (
      <section className="config-page" aria-label="配置管理">
        <div className="project-page-header">
          <div>
            <h2>配置管理</h2>
            <p>选择环境和模块后，维护常用运行配置。</p>
          </div>
        </div>
        <section className="config-detail-empty">
          <FileCog size={34} />
          <h3>暂无可编辑配置</h3>
          <p>需要至少一个项目、一个环境和一个已识别模块。</p>
        </section>
      </section>
    );
  }

  return (
    <section className="config-page" aria-label="配置管理">
      <div className="project-page-header">
        <div>
          <h2>配置管理</h2>
          <p>只维护 Nacos、RabbitMQ、Redis 和数据库这些常改配置。</p>
        </div>
      </div>

      <section className="config-edit-page">
        <div className="config-selector-bar config-two-selectors">
          <label htmlFor="environment-select">
            环境
            <select
              id="environment-select"
              value={selectedEnvironment?.code ?? ''}
              onChange={(event) => setEnvironmentCode(event.target.value)}
            >
              {environments.map((environment) => (
                <option value={environment.code} key={environment.id}>
                  {environment.name}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="module-select">
            模块
            <select
              id="module-select"
              value={selectedModule?.id ?? ''}
              onChange={(event) => setModuleId(event.target.value)}
            >
              {availableModules.map((moduleItem) => (
                <option value={moduleItem.id} key={moduleItem.id}>
                  {moduleItem.name}{moduleItem.defaultPort ? ` / ${moduleItem.defaultPort}` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        <section className="environment-config-panel config-yaml-panel" aria-label="模块环境配置">
          <div className="environment-config-header compact">
            <div>
              <h3>配置项</h3>
            </div>
            <div className="environment-config-header-actions">
              <button type="button" onClick={handleReloadConfig} disabled={isEnvironmentConfigBusy}>
                <RefreshCw size={18} />
                {isEnvironmentConfigBusy ? '读取中' : '获取默认配置'}
              </button>
              <button
                type="button"
                onClick={handleSaveConfig}
                disabled={isEnvironmentConfigBusy || !canSaveConfig}
              >
                <Save size={18} />
                {isEnvironmentConfigBusy ? '保存中' : '保存配置'}
              </button>
            </div>
          </div>

          {isLoadedSelection ? (
            <>
              {hasEditableFields ? (
                <div className="environment-config-editor-grid">
                  {editableGroups.map((group) => (
                    <article
                      className={`environment-config-form-card${isStartupGroup(group) ? ' runtime-card' : ''}`}
                      key={group.groupKey}
                    >
                      <h4>{group.groupTitle}</h4>
                      <div className="environment-field-grid">
                        {group.fields.map((field) => (
                          <label htmlFor={`${group.groupKey}-${field.path.join('-')}`} key={field.path.join('.')}>
                            {field.label}
                            <input
                              id={`${group.groupKey}-${field.path.join('-')}`}
                              value={field.value ?? ''}
                              onChange={(event) =>
                                updateEditableField(group.groupKey, field.path, event.target.value)
                              }
                              type={field.secret ? 'password' : 'text'}
                              inputMode={field.path.join('.') === 'server.port' ? 'numeric' : undefined}
                              autoComplete="off"
                            />
                          </label>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="environment-config-empty compact">
                  未识别到 Nacos、RabbitMQ、Redis 或数据库配置项。
                </div>
              )}

              <div className="environment-config-actions">
                {notice ? <span>{notice}</span> : <span>保存的是当前“环境 + 模块”的独立配置。</span>}
              </div>
            </>
          ) : (
            <div className="environment-config-empty">正在读取当前环境和模块对应的配置。</div>
          )}
        </section>
      </section>
    </section>
  );
}

export default ConfigurationManagement;
