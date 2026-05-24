import { RefreshCw } from 'lucide-react';

const pageCopy = {
  dashboard: {
    title: '项目环境启动台',
    subtitle: '管理本地项目环境配置与模块启动',
  },
  projects: {
    title: '项目管理',
    subtitle: '维护本地工作副本目录',
  },
  environments: {
    title: '环境管理',
    subtitle: '维护可复用的环境名称',
  },
  configuration: {
    title: '配置管理',
    subtitle: '按项目、模块和环境维护配置',
  },
  modules: {
    title: '模块识别',
    subtitle: '查看自动识别的模块和端口',
  },
};

function DashboardHeader({ activeView, meta, onRefresh }) {
  const copy = pageCopy[activeView] ?? pageCopy.dashboard;

  return (
    <header className="dashboard-header">
      <div>
        <h1>{copy.title}</h1>
        <p>{copy.subtitle}</p>
      </div>

      <div className="refresh-panel">
        <span>
          最后更新：{meta.lastUpdated}
        </span>
        <button type="button" onClick={onRefresh}>
          <RefreshCw size={15} />
          手动刷新
        </button>
      </div>
    </header>
  );
}

export default DashboardHeader;
