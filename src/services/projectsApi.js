const API_BASE = '/api';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(payload?.message ?? '请求失败');
  }

  return payload;
}

export function fetchProjects() {
  return request('/projects');
}

export function fetchDashboardSummary() {
  return request('/dashboard-summary');
}

export function createProject(project) {
  return request('/projects', {
    method: 'POST',
    body: JSON.stringify(project),
  });
}

export function updateProject(id, project) {
  return request(`/projects/${id}`, {
    method: 'PUT',
    body: JSON.stringify(project),
  });
}

export function deleteProject(id) {
  return request(`/projects/${id}`, { method: 'DELETE' });
}

export function refreshProjects() {
  return request('/projects/refresh', { method: 'POST' });
}

function normalizeEnvironmentCodes(environmentCodes) {
  return Array.isArray(environmentCodes) ? environmentCodes : [environmentCodes].filter(Boolean);
}

function normalizeModuleTargets(moduleIdsOrTargets, environmentCodes) {
  const values = Array.isArray(moduleIdsOrTargets)
    ? moduleIdsOrTargets
    : [moduleIdsOrTargets].filter(Boolean);
  const hasTargets = values.some(
    (item) => item && typeof item === 'object' && item.moduleId && item.environmentCode,
  );

  if (hasTargets) {
    return {
      targets: values
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          moduleId: item.moduleId,
          environmentCode: item.environmentCode,
        })),
    };
  }

  return {
    moduleIds: values,
    environmentCodes: normalizeEnvironmentCodes(environmentCodes),
  };
}

export function startProjectModules(projectId, moduleIdsOrTargets, environmentCodes) {
  return request(`/projects/${projectId}/modules/start`, {
    method: 'POST',
    body: JSON.stringify(normalizeModuleTargets(moduleIdsOrTargets, environmentCodes)),
  });
}

export function stopProjectModules(projectId, moduleIdsOrTargets, environmentCodes) {
  return request(`/projects/${projectId}/modules/stop`, {
    method: 'POST',
    body: JSON.stringify(normalizeModuleTargets(moduleIdsOrTargets, environmentCodes)),
  });
}

export function createRunLogEventSource(recordId) {
  return new EventSource(`${API_BASE}/run-records/${encodeURIComponent(recordId)}/logs/stream`);
}

export function fetchModules() {
  return request('/modules');
}

export function refreshModules() {
  return request('/modules/refresh', { method: 'POST' });
}

export function updateModule(id, moduleConfig) {
  return request(`/modules/${id}`, {
    method: 'PUT',
    body: JSON.stringify(moduleConfig),
  });
}

export function deleteModule(id) {
  return request(`/modules/${id}`, { method: 'DELETE' });
}

export function pickPath(type = 'folder') {
  return request('/system/pick-path', {
    method: 'POST',
    body: JSON.stringify({ type }),
  });
}

export function createEnvironment(environment) {
  return request('/environments', {
    method: 'POST',
    body: JSON.stringify(environment),
  });
}

export function updateEnvironment(id, environment) {
  return request(`/environments/${id}`, {
    method: 'PUT',
    body: JSON.stringify(environment),
  });
}

export function deleteEnvironment(id) {
  return request(`/environments/${id}`, { method: 'DELETE' });
}

export function fetchEnvironmentConfig(projectId, moduleId, environmentCode, options = {}) {
  const params = new URLSearchParams({ projectId, moduleId, environmentCode });
  if (options.source) {
    params.set('source', options.source);
  }
  return request(`/environment-config?${params.toString()}`);
}

export function saveEnvironmentConfig(config) {
  return request('/environment-config', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}
