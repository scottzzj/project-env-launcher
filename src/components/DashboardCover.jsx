import {
  Activity,
  Boxes,
  ClipboardList,
  Database,
  FolderKanban,
  Server,
} from 'lucide-react';

function percent(value, total) {
  if (!total) {
    return '0%';
  }

  return `${Math.round((value / total) * 100)}%`;
}

function getProjectRuntime(project) {
  return project.runtime ?? {};
}

function DashboardCover({
  dashboardSummary,
  environments,
  modules,
  onCreateProject,
  onOpenControl,
  projects,
}) {
  const leafModules = modules.filter((moduleItem) => !moduleItem.hasChildren);
  const startableModules = leafModules.filter((moduleItem) => moduleItem.defaultPort);
  const summary = dashboardSummary?.overview ?? {};
  const projectCount = summary.projectCount ?? projects.length;
  const readyProjectCount =
    summary.readyProjectCount ?? projects.filter((project) => getProjectRuntime(project).canStart).length;
  const startableModuleCount = summary.startableModuleCount ?? startableModules.length;
  const moduleCount = summary.moduleCount ?? leafModules.length;
  const environmentCount = summary.environmentCount ?? environments.length;
  const savedConfigCount = summary.savedConfigCount ?? 0;
  const expectedConfigCount = summary.expectedConfigCount ?? environmentCount * startableModuleCount;
  const runningModuleCount = projects.reduce(
    (total, project) => total + (getProjectRuntime(project).runningModuleCount ?? 0),
    0,
  );
  const startingModuleCount = projects.reduce(
    (total, project) => total + (getProjectRuntime(project).startingModuleCount ?? 0),
    0,
  );

  if (projectCount === 0) {
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
      <div className="dashboard-metrics" aria-label="真实统计">
        <article>
          <FolderKanban size={22} />
          <span>项目</span>
          <strong>{projectCount}</strong>
          <em>{readyProjectCount} 个可启动</em>
        </article>
        <article>
          <Boxes size={22} />
          <span>模块</span>
          <strong>{startableModuleCount}/{moduleCount}</strong>
          <em>已识别端口</em>
        </article>
        <article>
          <Database size={22} />
          <span>环境配置</span>
          <strong>{savedConfigCount}/{expectedConfigCount}</strong>
          <em>覆盖率 {percent(savedConfigCount, expectedConfigCount)}</em>
        </article>
        <article>
          <Activity size={22} />
          <span>运行模块</span>
          <strong>{runningModuleCount}/{startableModuleCount}</strong>
          <em>{startingModuleCount} 个启动中</em>
        </article>
      </div>

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
