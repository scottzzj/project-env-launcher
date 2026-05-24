import { Pencil, RefreshCw, Trash2 } from 'lucide-react';

function ModuleManagement({
  isModuleBusy,
  modules,
  onDeleteModule,
  onEditModule,
  onRefreshModules,
}) {
  const leafModules = modules.filter((moduleItem) => !moduleItem.hasChildren);
  const startableModules = leafModules.filter((moduleItem) => moduleItem.defaultPort);
  const libraryModules = leafModules.filter((moduleItem) => !moduleItem.defaultPort);

  return (
    <section className="config-page" aria-label="模块识别">
      <div className="project-page-header">
        <div>
          <h2>模块识别</h2>
          <p>模块从项目自动扫描；端口来自模块配置，识别不准时可手工修正。</p>
        </div>
        <button className="create-env-button" type="button" onClick={onRefreshModules} disabled={isModuleBusy}>
          <RefreshCw size={18} />
          {isModuleBusy ? '扫描中' : '重新扫描'}
        </button>
      </div>

      {leafModules.length === 0 ? (
        <section className="project-admin-empty">
          <h3>暂无模块</h3>
          <p>请先添加项目目录，或点击重新扫描读取项目中的模块和端口。</p>
          <button type="button" onClick={onRefreshModules} disabled={isModuleBusy}>
            重新扫描
          </button>
        </section>
      ) : (
        <section className="management-panel">
          <div className="management-header">
            <div>
              <h3>可启动模块</h3>
              <p>{startableModules.length} 个模块已从配置中识别到端口。</p>
            </div>
          </div>

          <div className="management-list">
            {startableModules.map((moduleItem) => (
              <article className="management-row module-management-row" key={moduleItem.id}>
                <div>
                  <strong>{moduleItem.name}</strong>
                </div>
                <small>端口 {moduleItem.defaultPort}</small>
                <div className="management-actions">
                  <button type="button" onClick={() => onEditModule(moduleItem.id)} disabled={isModuleBusy}>
                    <Pencil size={15} />
                    编辑
                  </button>
                  <button
                    className="danger"
                    type="button"
                    onClick={() => onDeleteModule(moduleItem)}
                    disabled={isModuleBusy}
                  >
                    <Trash2 size={15} />
                    删除
                  </button>
                </div>
              </article>
            ))}
          </div>

          {libraryModules.length > 0 ? (
            <div className="module-library-note">
              {libraryModules.length} 个公共库模块没有启动端口，已从启动模块列表中弱化展示。
            </div>
          ) : null}
        </section>
      )}
    </section>
  );
}

export default ModuleManagement;
