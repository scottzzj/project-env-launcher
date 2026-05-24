import { useCallback, useEffect, useMemo, useState } from 'react';
import ConfigurationManagement from './components/ConfigurationManagement.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import DashboardCover from './components/DashboardCover.jsx';
import DashboardHeader from './components/DashboardHeader.jsx';
import EnvironmentManagement from './components/EnvironmentManagement.jsx';
import EnvironmentFormModal from './components/EnvironmentFormModal.jsx';
import MessageDialog from './components/MessageDialog.jsx';
import ModuleManagement from './components/ModuleManagement.jsx';
import ModuleFormModal from './components/ModuleFormModal.jsx';
import ProjectDetailModal from './components/ProjectDetailModal.jsx';
import ProjectFormModal from './components/ProjectFormModal.jsx';
import ProjectManagement from './components/ProjectManagement.jsx';
import Sidebar from './components/Sidebar.jsx';
import {
  createProject,
  createRunLogEventSource,
  deleteModule,
  fetchDashboardSummary,
  fetchProjects,
  pickPath,
  createEnvironment,
  deleteProject,
  deleteEnvironment,
  fetchEnvironmentConfig,
  fetchModules,
  refreshProjects,
  refreshModules,
  saveEnvironmentConfig,
  startProjectModules,
  stopProjectModules,
  updateEnvironment,
  updateModule,
  updateProject,
} from './services/projectsApi.js';

const deleteDialogCopy = {
  project: {
    title: '删除工作副本',
    message: (item) => `确定删除工作副本“${item.name}”吗？删除后不会影响本地项目文件。`,
  },
  environment: {
    title: '删除环境',
    message: (item) => `确定删除环境“${item.name}”吗？引用该环境的项目会切换到默认环境。`,
  },
  module: {
    title: '删除模块',
    message: (item) => `确定从监控中删除模块“${item.name}”吗？不会删除项目源码。`,
  },
};

const defaultMeta = {
  lastUpdated: '--:--:--',
  autoRefresh: false,
};

function App() {
  const [projects, setProjects] = useState([]);
  const [logicalProjects, setLogicalProjects] = useState([]);
  const [modules, setModules] = useState([]);
  const [runRecords, setRunRecords] = useState([]);
  const [dashboardSummary, setDashboardSummary] = useState(null);
  const [meta, setMeta] = useState(defaultMeta);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [isControlOpen, setIsControlOpen] = useState(false);
  const [activeView, setActiveView] = useState('dashboard');
  const [isProjectBusy, setIsProjectBusy] = useState(false);
  const [environments, setEnvironments] = useState([]);
  const [isEnvironmentBusy, setIsEnvironmentBusy] = useState(false);
  const [projectFormState, setProjectFormState] = useState(null);
  const [environmentFormState, setEnvironmentFormState] = useState(null);
  const [environmentConfig, setEnvironmentConfig] = useState(null);
  const [isEnvironmentConfigBusy, setIsEnvironmentConfigBusy] = useState(false);
  const [moduleFormState, setModuleFormState] = useState(null);
  const [isModuleBusy, setIsModuleBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [messageDialog, setMessageDialog] = useState(null);
  const [isDetailRefreshing, setIsDetailRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0],
    [projects, selectedProjectId],
  );
  const editingProject = useMemo(
    () =>
      projectFormState?.mode === 'edit'
        ? projects.find((project) => project.id === projectFormState.id) ?? null
        : null,
    [projectFormState, projects],
  );

  const editingEnvironment = useMemo(
    () =>
      environmentFormState?.mode === 'edit'
        ? environments.find((environment) => environment.id === environmentFormState.id) ?? null
        : null,
    [environmentFormState, environments],
  );

  const editingModule = useMemo(
    () =>
      moduleFormState?.mode === 'edit'
        ? modules.find((moduleItem) => moduleItem.id === moduleFormState.id) ?? null
        : null,
    [moduleFormState, modules],
  );

  const leafModules = useMemo(
    () => modules.filter((moduleItem) => !moduleItem.hasChildren),
    [modules],
  );

  const loadEnvironmentConfig = useCallback(async (projectId, moduleId, environmentCode, options = {}) => {
    setIsEnvironmentConfigBusy(true);
    try {
      const payload = await fetchEnvironmentConfig(projectId, moduleId, environmentCode, options);
      setEnvironmentConfig(payload);
      setMeta(payload.meta ?? defaultMeta);
      setError('');
      return payload;
    } catch (requestError) {
      setError(requestError.message);
      throw requestError;
    } finally {
      setIsEnvironmentConfigBusy(false);
    }
  }, []);

  const handleSaveEnvironmentConfig = useCallback(async (configData) => {
    setIsEnvironmentConfigBusy(true);
    try {
      const payload = await saveEnvironmentConfig(configData);
      setEnvironmentConfig(payload);
      setMeta(payload.meta ?? defaultMeta);
      setError('');
      return payload;
    } catch (requestError) {
      setError(requestError.message);
      throw requestError;
    } finally {
      setIsEnvironmentConfigBusy(false);
    }
  }, []);

  const applyListPayload = useCallback((payload) => {
    const nextProjects = payload.projects ?? [];
    setProjects(nextProjects);
    setLogicalProjects(payload.logicalProjects ?? []);
    setModules(payload.modules ?? []);
    setEnvironments(payload.environments ?? payload.branches ?? []);
    setRunRecords(payload.runRecords ?? []);
    setMeta(payload.meta ?? defaultMeta);
    setError('');

    setSelectedProjectId((currentProjectId) =>
      nextProjects.some((project) => project.id === currentProjectId)
        ? currentProjectId
        : nextProjects[0]?.id ?? null,
    );
  }, []);

  const loadProjects = useCallback(async () => {
    setIsLoading(true);
    try {
      applyListPayload(await fetchProjects());
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsLoading(false);
    }
  }, [applyListPayload]);

  const loadModules = useCallback(async () => {
    try {
      const payload = await fetchModules();
      setModules(payload.modules ?? []);
      setMeta(payload.meta ?? defaultMeta);
      setError('');
    } catch (requestError) {
      setError(requestError.message);
    }
  }, []);

  const loadDashboardSummary = useCallback(async () => {
    try {
      const payload = await fetchDashboardSummary();
      setDashboardSummary(payload);
      setMeta(payload.meta ?? defaultMeta);
      setError('');
    } catch (requestError) {
      setError(requestError.message);
    }
  }, []);

  useEffect(() => {
    loadProjects();
    loadModules();
    loadDashboardSummary();
  }, [loadDashboardSummary, loadModules, loadProjects]);

  const refreshDashboardData = useCallback(async () => {
    try {
      applyListPayload(await refreshProjects());
      await loadModules();
      await loadDashboardSummary();
    } catch (requestError) {
      setError(requestError.message);
    }
  }, [applyListPayload, loadDashboardSummary, loadModules]);

  const handleDetailRefresh = useCallback(async () => {
    setIsDetailRefreshing(true);
    try {
      await refreshDashboardData();
    } finally {
      setIsDetailRefreshing(false);
    }
  }, [refreshDashboardData]);

  const openProjectControl = useCallback((projectId) => {
    if (!projectId) {
      return;
    }

    setSelectedProjectId(projectId);
    setIsControlOpen(true);
  }, []);

  const handleStartProjectModules = useCallback(async (projectId, moduleIds, environmentCode) => {
    setIsProjectBusy(true);
    try {
      const payload = await startProjectModules(projectId, moduleIds, environmentCode);
      if (payload.projects) {
        setProjects(payload.projects);
      }
      if (payload.logicalProjects) {
        setLogicalProjects(payload.logicalProjects);
      }
      setRunRecords((currentRecords) => [
        ...(payload.runRecords ?? []),
        ...currentRecords.filter((record) => record.projectId !== projectId),
      ]);
      if (payload.project) {
        setProjects((currentProjects) =>
          currentProjects.map((project) => (project.id === payload.project.id ? payload.project : project)),
        );
      }
      await loadDashboardSummary();
      setMeta(payload.meta ?? defaultMeta);
      setError('');
      return payload;
    } catch (requestError) {
      setMessageDialog({ title: '启动失败', message: requestError.message });
      throw requestError;
    } finally {
      setIsProjectBusy(false);
    }
  }, [loadDashboardSummary]);

  const handleStopProjectModules = useCallback(async (projectId, moduleIds, environmentCode) => {
    setIsProjectBusy(true);
    try {
      const payload = await stopProjectModules(projectId, moduleIds, environmentCode);
      if (payload.projects) {
        setProjects(payload.projects);
      }
      if (payload.logicalProjects) {
        setLogicalProjects(payload.logicalProjects);
      }
      setRunRecords((currentRecords) => [
        ...(payload.runRecords ?? []),
        ...currentRecords.filter((record) => record.projectId !== projectId),
      ]);
      if (payload.project) {
        setProjects((currentProjects) =>
          currentProjects.map((project) => (project.id === payload.project.id ? payload.project : project)),
        );
      }
      await loadDashboardSummary();
      setMeta(payload.meta ?? defaultMeta);
      setError('');
      return payload;
    } catch (requestError) {
      setMessageDialog({ title: '关停失败', message: requestError.message });
      throw requestError;
    } finally {
      setIsProjectBusy(false);
    }
  }, [loadDashboardSummary]);

  const handleChangeView = useCallback((view) => {
    setActiveView(view);
    setIsControlOpen(false);
  }, []);

  const handleRefreshModules = useCallback(async () => {
    setIsModuleBusy(true);
    try {
      const payload = await refreshModules();
      setModules(payload.modules ?? []);
      setMeta(payload.meta ?? defaultMeta);
      setError('');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsModuleBusy(false);
    }
  }, []);

  const handleSubmitModuleForm = useCallback(async (moduleData) => {
    setIsModuleBusy(true);
    try {
      const payload = await updateModule(moduleData.moduleId, moduleData);
      setModules(payload.modules ?? []);
      setMeta(payload.meta ?? defaultMeta);
      setError('');
      setModuleFormState(null);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsModuleBusy(false);
    }
  }, [moduleFormState]);

  const handleDeleteModule = useCallback((moduleItem) => {
    setDeleteTarget({ type: 'module', item: moduleItem });
  }, []);

  const confirmDeleteModule = useCallback(async (moduleItem) => {
    setIsModuleBusy(true);
    try {
      const payload = await deleteModule(moduleItem.id);
      setModules(payload.modules ?? []);
      setRunRecords((currentRecords) =>
        currentRecords.filter((record) => record.moduleId !== moduleItem.id),
      );
      setMeta(payload.meta ?? defaultMeta);
      setError('');
      setDeleteTarget(null);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsModuleBusy(false);
    }
  }, []);

  const handleCreateEnvironment = useCallback(async () => {
    setEnvironmentFormState({ mode: 'create' });
  }, []);

  const handleSubmitEnvironmentForm = useCallback(async (environmentData) => {
    setIsEnvironmentBusy(true);
    try {
      const payload =
        environmentFormState?.mode === 'edit'
          ? await updateEnvironment(environmentFormState.id, environmentData)
          : await createEnvironment(environmentData);

      if (payload.environments) {
        setEnvironments(payload.environments);
      } else if (payload.environment) {
        setEnvironments((current) =>
          current.map((environment) =>
            environment.id === payload.environment.id ? payload.environment : environment,
          ),
        );
      }
      setMeta(payload.meta ?? defaultMeta);
      setError('');
      setEnvironmentFormState(null);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsEnvironmentBusy(false);
    }
  }, [environmentFormState]);

  const handleDeleteEnvironment = useCallback((environment) => {
    setDeleteTarget({ type: 'environment', item: environment });
  }, []);

  const confirmDeleteEnvironment = useCallback(async (environment) => {
    setIsEnvironmentBusy(true);
    try {
      const environmentId = environment.id;
      const payload = await deleteEnvironment(environmentId);
      setEnvironments(payload.environments ?? []);
      setMeta(payload.meta ?? defaultMeta);
      setError('');
      setDeleteTarget(null);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsEnvironmentBusy(false);
    }
  }, []);

  const handleCreateProject = useCallback(async () => {
    setProjectFormState({ mode: 'create' });
  }, []);

  const handlePickProjectPath = useCallback(async (type) => {
    const payload = await pickPath(type);
    return payload.path ?? '';
  }, []);

  const handleSubmitProjectForm = useCallback(async (projectData) => {
    setIsProjectBusy(true);
    try {
      const payload =
        projectFormState?.mode === 'edit'
          ? await updateProject(projectFormState.id, projectData)
          : await createProject(projectData);

      if (payload.projects) {
        applyListPayload(payload);
      } else if (payload.project) {
        setProjects((currentProjects) =>
          currentProjects.map((project) =>
            project.id === payload.project.id ? payload.project : project,
          ),
        );
        setMeta(payload.meta ?? defaultMeta);
        setError('');
      }
      setProjectFormState(null);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsProjectBusy(false);
    }
  }, [applyListPayload, projectFormState]);

  const handleDeleteProject = useCallback((project) => {
    setDeleteTarget({ type: 'project', item: project });
  }, []);

  const confirmDeleteProject = useCallback(async (project) => {
    setIsProjectBusy(true);
    try {
      const projectId = project.id;
      const payload = await deleteProject(projectId);
      applyListPayload(payload);
      setSelectedProjectId((currentProjectId) => (currentProjectId === projectId ? null : currentProjectId));
      setDeleteTarget(null);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsProjectBusy(false);
    }
  }, [applyListPayload]);

  const handleConfirmDelete = useCallback(() => {
    if (!deleteTarget) {
      return;
    }

    if (deleteTarget.type === 'project') {
      confirmDeleteProject(deleteTarget.item);
      return;
    }

    if (deleteTarget.type === 'module') {
      confirmDeleteModule(deleteTarget.item);
      return;
    }

    confirmDeleteEnvironment(deleteTarget.item);
  }, [confirmDeleteEnvironment, confirmDeleteModule, confirmDeleteProject, deleteTarget]);

  return (
    <main className="app-shell">
      <Sidebar activeView={activeView} onChangeView={handleChangeView} />

      <section className="dashboard">
        {activeView === 'dashboard' ? (
          <DashboardHeader activeView={activeView} meta={meta} onRefresh={refreshDashboardData} />
        ) : null}

        {error ? <div className="api-error" role="alert">{error}</div> : null}
        {isLoading ? <div className="loading-state">正在加载项目...</div> : null}

        {activeView === 'dashboard' ? (
          projects.length > 0 ? (
            <DashboardCover
              dashboardSummary={dashboardSummary}
              environments={environments}
              modules={leafModules}
              onCreateProject={handleCreateProject}
              onOpenControl={openProjectControl}
              projects={projects}
            />
          ) : !isLoading ? (
            <section className="empty-state dashboard-empty">
              <h2>暂无项目</h2>
              <p>当前 Codex 运行环境没有提供可枚举的已打开项目列表，请手动添加要监控的项目。</p>
              <button type="button" onClick={handleCreateProject} disabled={isProjectBusy}>
                新建项目
              </button>
            </section>
          ) : null
        ) : null}

        {activeView === 'projects' ? (
          <ProjectManagement
            isProjectBusy={isProjectBusy}
            logicalProjects={logicalProjects}
            onCreateProject={handleCreateProject}
            onDeleteProject={handleDeleteProject}
            onEditProject={(projectId) => setProjectFormState({ mode: 'edit', id: projectId })}
            projects={projects}
          />
        ) : null}

        {activeView === 'environments' ? (
          <EnvironmentManagement
            environments={environments}
            isEnvironmentBusy={isEnvironmentBusy}
            onCreateEnvironment={handleCreateEnvironment}
            onDeleteEnvironment={handleDeleteEnvironment}
            onEditEnvironment={(environmentId) =>
              setEnvironmentFormState({ mode: 'edit', id: environmentId })
            }
          />
        ) : null}

        {activeView === 'configuration' ? (
          <ConfigurationManagement
            environments={environments}
            environmentConfig={environmentConfig}
            isEnvironmentConfigBusy={isEnvironmentConfigBusy}
            projects={projects}
            modules={leafModules}
            onLoadEnvironmentConfig={loadEnvironmentConfig}
            onSaveEnvironmentConfig={handleSaveEnvironmentConfig}
          />
        ) : null}

        {activeView === 'modules' ? (
          <ModuleManagement
            isModuleBusy={isModuleBusy}
            modules={leafModules}
            onDeleteModule={handleDeleteModule}
            onEditModule={(moduleId) => setModuleFormState({ mode: 'edit', id: moduleId })}
            onRefreshModules={handleRefreshModules}
          />
        ) : null}
      </section>

      {isControlOpen ? (
        <ProjectDetailModal
          selectedProject={selectedProject}
          environments={environments}
          isRefreshing={isDetailRefreshing}
          isStarting={isProjectBusy}
          modules={leafModules}
          onClose={() => setIsControlOpen(false)}
          onRefresh={handleDetailRefresh}
          onStartModules={handleStartProjectModules}
          onStopModules={handleStopProjectModules}
          onCreateRunLogEventSource={createRunLogEventSource}
          runRecords={runRecords}
        />
      ) : null}

      {projectFormState ? (
        <ProjectFormModal
          mode={projectFormState.mode}
          initialProject={editingProject}
          isBusy={isProjectBusy}
          onClose={() => setProjectFormState(null)}
          onPickPath={handlePickProjectPath}
          onSubmit={handleSubmitProjectForm}
        />
      ) : null}

      {environmentFormState ? (
        <EnvironmentFormModal
          mode={environmentFormState.mode}
          initialEnvironment={editingEnvironment}
          isBusy={isEnvironmentBusy}
          onClose={() => setEnvironmentFormState(null)}
          onSubmit={handleSubmitEnvironmentForm}
        />
      ) : null}

      {moduleFormState ? (
        <ModuleFormModal
          initialModule={editingModule}
          isBusy={isModuleBusy}
          modules={leafModules}
          onClose={() => setModuleFormState(null)}
          onSubmit={handleSubmitModuleForm}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title={deleteDialogCopy[deleteTarget.type].title}
          message={deleteDialogCopy[deleteTarget.type].message(deleteTarget.item)}
          isBusy={isProjectBusy || isEnvironmentBusy || isModuleBusy}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleConfirmDelete}
        />
      ) : null}

      {messageDialog ? (
        <MessageDialog
          title={messageDialog.title}
          message={messageDialog.message}
          onClose={() => setMessageDialog(null)}
        />
      ) : null}
    </main>
  );
}

export default App;
