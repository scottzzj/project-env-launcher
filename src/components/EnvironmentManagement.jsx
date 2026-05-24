import { Leaf, Pencil, Plus, Trash2 } from 'lucide-react';

function EnvironmentManagement({
  environments,
  isEnvironmentBusy,
  onCreateEnvironment,
  onDeleteEnvironment,
  onEditEnvironment,
}) {
  return (
    <section className="environment-page" aria-label="环境管理">
      <div className="environment-title">
        <div>
          <h2>环境管理</h2>
          <p>这里只维护环境名称；每个模块在不同环境下的具体配置，到配置管理里维护。</p>
        </div>
        <button className="create-env-button" type="button" onClick={onCreateEnvironment} disabled={isEnvironmentBusy}>
          <Plus size={18} />
          新建环境
        </button>
      </div>

      {environments.length === 0 ? (
        <section className="project-admin-empty">
          <h3>暂无环境</h3>
          <p>新增环境后，就可以在配置管理里为每个模块维护对应配置。</p>
          <button type="button" onClick={onCreateEnvironment} disabled={isEnvironmentBusy}>
            新建环境
          </button>
        </section>
      ) : (
        <div className="environment-list">
          {environments.map((environment) => (
            <article className="environment-list-card" key={environment.id}>
              <span className={`environment-icon ${environment.accent ?? 'green'}`}>
                <Leaf size={28} />
              </span>
              <div className="environment-copy">
                <div className="environment-name-line">
                  <h3>{environment.name}</h3>
                </div>
              </div>
              <div className="environment-card-actions">
                <button
                  className="environment-edit-button"
                  type="button"
                  onClick={() => onEditEnvironment(environment.id)}
                  disabled={isEnvironmentBusy}
                >
                  <Pencil size={15} />
                  编辑
                </button>
                <button
                  className="environment-delete-button"
                  type="button"
                  aria-label={`删除${environment.name}`}
                  onClick={() => onDeleteEnvironment(environment)}
                  disabled={isEnvironmentBusy}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export default EnvironmentManagement;
