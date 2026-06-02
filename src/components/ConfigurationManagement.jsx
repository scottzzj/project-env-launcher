import { FileCog, RefreshCw, Save, Server } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

function getDefaultProject(projects = [], modules = []) {
  const firstProjectWithModules = projects.find((project) =>
    modules.some(
      (moduleItem) =>
        moduleItem.projectIds?.includes(project.id) && !moduleItem.hasChildren && moduleItem.defaultPort,
    ),
  );

  return firstProjectWithModules ?? projects[0] ?? null;
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
  const [notice, setNotice] = useState('');

  const selectedProject = useMemo(
    () => getDefaultProject(projects, modules),
    [modules, projects],
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
  const canSaveConfig = isLoadedSelection && content.trim();

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
      return;
    }

    setContent('');
  }, [environmentConfig?.config?.hash, isLoadedSelection]);

  async function handleReloadConfig() {
    if (!selectedProject || !selectedEnvironment || !selectedModule || !onLoadEnvironmentConfig) {
      return;
    }

    setNotice('');
    try {
      await onLoadEnvironmentConfig(selectedProject.id, selectedModule.id, selectedEnvironment.code, {
        source: 'default',
      });
      setNotice('已从项目默认配置重新获取，保存后会写入当前环境和模块的完整配置。');
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
        fields: [],
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
            <p>选择环境和模块后，维护完整运行配置。</p>
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
          <p>按环境和模块维护完整 YAML 配置。</p>
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
              <h3>完整配置</h3>
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
              <label className="environment-yaml-editor" htmlFor="environment-yaml-content">
                YAML
                <textarea
                  id="environment-yaml-content"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  spellCheck={false}
                  wrap="off"
                />
              </label>

              <div className="environment-config-actions">
                {notice ? <span>{notice}</span> : <span>保存的是当前“环境 + 模块”的完整独立配置。</span>}
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
