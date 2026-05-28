import {
  ClipboardList,
  Server,
} from 'lucide-react';

function getProjectRuntime(project) {
  return project.runtime ?? {};
}

function DashboardCover({
  onCreateProject,
  onOpenControl,
  projects,
}) {
  if (projects.length === 0) {
    return (
      <section className="empty-state dashboard-empty">
        <h2>暂无项目</h2>
        <p>当前没有已添加的本地项目目录。</p>
        <button type="button" onClick={onCreateProject}>
          新建项目
        </button>
      </section>
    );
  }

  return (
    <section className="dashboard-cover" aria-label="项目环境启动台">
      <section className="dashboard-project-table" aria-label="项目运行状态">
        <div className="panel-heading">
          <div>
            <h2>项目状态</h2>
            <p>来自项目扫描和当前 Maven 进程状态</p>
          </div>
        </div>

        <div className="project-status-grid">
          {projects.map((project) => {
            const runtime = getProjectRuntime(project);
            const activeEnvironment = runtime.activeEnvironment;
            return (
              <article className="project-status-card" key={project.id}>
                <div className="project-status-icon">
                  <Server size={22} />
                </div>
                <div className="project-status-card-main">
                  <strong>{project.name}</strong>
                </div>
                <div className="project-status-runtime">
                  <span>{activeEnvironment ? activeEnvironment.name : '当前无运行环境'}</span>
                  {activeEnvironment?.moduleNames?.length ? (
                    <div className="project-status-runtime-modules">
                      {activeEnvironment.moduleNames.map((moduleName) => (
                        <em key={moduleName}>{moduleName}</em>
                      ))}
                    </div>
                  ) : (
                    <em>未运行模块</em>
                  )}
                </div>
                <button type="button" onClick={() => onOpenControl(project.id)}>
                  <ClipboardList size={16} />
                  控制
                </button>
              </article>
            );
          })}
        </div>
      </section>
    </section>
  );
}

export default DashboardCover;
