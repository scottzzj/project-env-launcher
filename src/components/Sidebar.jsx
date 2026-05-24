import {
  Boxes,
  FolderKanban,
  Grid2X2,
  Leaf,
  Monitor,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';

const navItems = [
  { id: 'dashboard', label: '启动台', icon: Grid2X2 },
  { id: 'projects', label: '项目管理', icon: FolderKanban },
  { id: 'environments', label: '环境管理', icon: Leaf },
  { id: 'configuration', label: '配置管理', icon: SlidersHorizontal },
  { id: 'modules', label: '模块识别', icon: Boxes },
];

function Sidebar({ activeView, onChangeView }) {
  return (
    <aside className="sidebar">
      <div className="brand-mark" aria-label="项目环境启动台">
        <Monitor size={29} strokeWidth={2.2} />
        <Sparkles className="brand-spark" size={13} />
      </div>

      <nav className="nav-list" aria-label="主导航">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={`nav-item${activeView === item.id ? ' active' : ''}`}
              key={item.label}
              type="button"
              title={item.label}
              onClick={() => onChangeView(item.id)}
            >
              <Icon size={25} strokeWidth={2.35} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

    </aside>
  );
}

export default Sidebar;
