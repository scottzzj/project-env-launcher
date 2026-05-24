import { FolderPlus, Pencil, Trash2 } from 'lucide-react';

function getDisplayCopyName(copy) {
  return copy?.runtime?.copyName ?? copy?.name ?? '';
}

function getProjectModuleStats(logicalProject) {
  const moduleCount = logicalProject.moduleCount ?? logicalProject.modules?.length ?? 0;
  const detectedPortModuleCount =
    logicalProject.detectedPortModuleCount ??
    logicalProject.modules?.filter((moduleItem) => moduleItem.defaultPort).length ??
    0;
  const missingPortModuleCount =
    logicalProject.missingPortModuleCount ?? Math.max(moduleCount - detectedPortModuleCount, 0);

  return {
    copyCount: logicalProject.copyCount ?? logicalProject.copies?.length ?? 0,
    moduleCount,
    detectedPortModuleCount,
    missingPortModuleCount,
  };
}

function ProjectManagement({
  isProjectBusy,
  logicalProjects,
  onCreateProject,
  onDeleteProject,
  onEditProject,
  projects,
}) {
  return (
    <section className="project-page" aria-label="项目管理">
      <div className="project-page-header">
        <div>
          <h2>项目管理</h2>
          <p>这里只维护本地工作副本目录；模块、端口和配置文件由系统自动扫描。</p>
        </div>
        <button className="create-env-button" type="button" onClick={onCreateProject} disabled={isProjectBusy}>
          <FolderPlus size={18} />
          新建工作副本
        </button>
      </div>

      {projects.length === 0 ? (
        <section className="project-admin-empty">
          <h3>暂无工作副本</h3>
          <p>添加本地项目目录后，系统会自动识别模块、端口和配置文件。</p>
          <button type="button" onClick={onCreateProject} disabled={isProjectBusy}>
            新建工作副本
          </button>
        </section>
      ) : (
        <div className="management-list">
          {logicalProjects.map((logicalProject) => {
            const stats = getProjectModuleStats(logicalProject);

            return (
              <section className="management-panel" key={logicalProject.id}>
                <div className="management-header">
                  <div>
                    <h3>{logicalProject.name}</h3>
                    <p>
                      {stats.copyCount} 个工作副本，共 {stats.moduleCount} 个模块，
                      {stats.detectedPortModuleCount} 个已识别端口，
                      {stats.missingPortModuleCount} 个未识别端口
                    </p>
                  </div>
                </div>

                <div className="management-list">
                  {(logicalProject.copies ?? []).map((copy) => (
                    <article className="management-row project-management-row" key={copy.id}>
                      <div>
                        <strong>{getDisplayCopyName(copy)}</strong>
                        <span>{copy.path}</span>
                      </div>
                      <small>{copy.runtime?.statusText ?? '未检测'}</small>
                      <div className="management-actions">
                        <button type="button" onClick={() => onEditProject(copy.id)} disabled={isProjectBusy}>
                          <Pencil size={15} />
                          编辑
                        </button>
                        <button
                          className="danger"
                          type="button"
                          onClick={() => onDeleteProject(copy)}
                          disabled={isProjectBusy}
                        >
                          <Trash2 size={15} />
                          删除
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default ProjectManagement;
