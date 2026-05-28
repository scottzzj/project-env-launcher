import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWriteStream } from 'node:fs';
import { TextDecoder } from 'node:util';
import { getLatestProjectChatMessage } from './codex-sessions.js';
import {
  getConfigPaths,
  getSavedEnvironmentConfig,
  initStore,
  listSavedEnvironmentConfigs,
  loadEnvironments,
  loadModuleSettings,
  loadProjects,
  saveEnvironments,
  saveModuleSettings,
  saveProjects,
  saveSavedEnvironmentConfig,
} from './config-store.js';
import {
  applyEnvironmentConfigFields,
  buildRuntimeOverrideYaml,
  buildEditableEnvironmentGroups,
  getContentHash,
  getYamlScalar,
  getYamlScalarValue,
  normalizeEditableConfigFields,
  parsePortValue,
  SERVER_PORT_PATH,
  setRequiredYamlScalar,
  summarizeEnvironmentConfig,
} from './environment-config-utils.js';
import { decodeRouteParam, fileExists } from './filesystem-utils.js';
import { buildMavenStartCommand, resolveMavenRuntime } from './maven-utils.js';
import { readModuleConfigPort, readModuleEntries, readModuleExtraPorts, readPomArtifactId } from './project-module-utils.js';
import { sendJson, sendSseEvent, readJson, writeSseHeaders } from './http-utils.js';
import { serveStaticFile } from './static-server.js';
import { execFileText, isPortListening, listSystemJavaProcesses, pickLocalPath, wait } from './system-utils.js';

const PORT = Number(process.env.API_PORT ?? 3001);
const DIST_DIR = path.resolve('dist');
const LOG_DIR = path.join(getConfigPaths().dataDir, 'logs');
const RUNTIME_CONFIG_DIR = path.join(getConfigPaths().dataDir, 'runtime-configs');
const PROJECT_ACCENTS = ['blue', 'green', 'amber', 'violet', 'red'];
const ACTIVE_RUN_STATUSES = new Set(['starting', 'running']);
const MAX_LOG_PREVIEW_LENGTH = 4000;
const MAX_SSE_LOG_SNAPSHOT_LENGTH = 60000;
const UTF8_PROCESS_LOG_DECODER = new TextDecoder('utf-8', { fatal: true });
const GB18030_PROCESS_LOG_DECODER = new TextDecoder('gb18030');

let projects = [];
let environments = [];
let modules = [];
let moduleSettings = [];
let runRecords = [];
let lastUpdated = new Date();
let autoRefresh = true;
let projectWorkspaceMeta = new Map();
const managedProcesses = new Map();
const logSubscribers = new Map();

function getProject(id) {
  return projects.find((project) => project.id === id);
}

function getEnvironment(id) {
  return environments.find((environment) => environment.id === id);
}

function getEnvironmentByCode(code) {
  const normalizedCode = normalizeEnvironmentCode(code);
  return environments.find((environment) => environment.code === normalizedCode);
}

function normalizeRequiredString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeComparablePath(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }

  const resolvedPath = path.resolve(value.trim());
  const normalizedPath = resolvedPath.replace(/[\\/]+/g, path.sep).replace(/[\\/]$/, '');
  return process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
}

function slugifyEnvironmentName(name) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'env';
}

function createUniqueEnvironmentCode(name, currentId = '') {
  const baseCode = slugifyEnvironmentName(name);
  let code = baseCode;
  let index = 2;

  while (environments.some((environment) => environment.id !== currentId && environment.code === code)) {
    code = `${baseCode}-${index}`;
    index += 1;
  }

  return code;
}

function slugifyModuleId(value) {
  const slug = normalizeRequiredString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'module';
}

function titleFromModuleId(moduleId) {
  return moduleId
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function createEnvironmentRecord(environment) {
  return {
    id: environment.id,
    code: environment.code,
    name: environment.name,
    profile: environment.profile ?? normalizeEnvironmentProfile(environment),
    accent: environment.accent ?? 'green',
  };
}

function ensureDefaultEnvironments() {
  let changed = false;
  const dedupedEnvironments = [];
  const seenCodes = new Set();
  for (const environment of environments) {
    if (seenCodes.has(environment.code)) {
      changed = true;
      continue;
    }

    seenCodes.add(environment.code);
    dedupedEnvironments.push(environment);
  }
  environments = dedupedEnvironments;

  return changed;
}

function normalizeEnvironmentCode(value) {
  return normalizeRequiredString(value);
}

function normalizeEnvironmentReferences() {
  let changed = false;

  projects = projects.map((project) => {
    const nextEnv = normalizeEnvironmentCode(project.env);
    if (nextEnv === project.env) {
      return project;
    }

    changed = true;
    return { ...project, env: nextEnv };
  });

  return changed;
}

function normalizeEnvironmentProfile(environment) {
  const explicitProfile = normalizeRequiredString(environment?.profile)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (explicitProfile) {
    return explicitProfile;
  }

  const nameProfile = normalizeRequiredString(environment?.name)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (nameProfile) {
    return nameProfile;
  }

  return normalizeRequiredString(environment?.code)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'default';
}

function normalizeEnvironmentProfileFromName(name) {
  const normalizedName = normalizeRequiredString(name);
  if (!normalizedName) {
    return '';
  }

  return normalizedName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getModuleAbsolutePath(project, moduleConfig) {
  const projectPath = path.resolve(project.path);
  const modulePath = path.resolve(projectPath, moduleConfig.path);
  if (modulePath !== projectPath && !modulePath.startsWith(`${projectPath}${path.sep}`)) {
    return null;
  }

  return modulePath;
}

function getProjectRelativePath(project, filePath) {
  return path.relative(project.path, filePath).replace(/[\\/]+/g, '/');
}

async function readProjectWorkspaceMeta(project) {
  const rootPath = normalizeRequiredString(project.path);
  const fallbackName = normalizeRequiredString(project.logicalName) || normalizeRequiredString(project.name) || '项目';
  const pathExists = rootPath ? await fileExists(rootPath) : false;
  const fallback = {
    logicalId: normalizeRequiredString(project.logicalId) || slugifyModuleId(fallbackName),
    logicalName: fallbackName,
    copyName: normalizeRequiredString(project.name) || fallbackName,
    worktreeRoot: rootPath,
    pathExists,
    gitBranch: '',
  };

  if (!pathExists) {
    return fallback;
  }

  const commonDirResult = await execFileText('git', ['-C', rootPath, 'rev-parse', '--git-common-dir']);
  const branchResult = await execFileText('git', ['-C', rootPath, 'branch', '--show-current']);
  const commonDir = commonDirResult.ok
    ? path.resolve(rootPath, commonDirResult.stdout)
    : rootPath;
  const commonRoot = commonDir.toLowerCase().endsWith(`${path.sep}.git`)
    ? path.dirname(commonDir)
    : commonDir;
  const logicalName = normalizeRequiredString(project.logicalName) || path.basename(commonRoot).toUpperCase();

  return {
    logicalId: normalizeRequiredString(project.logicalId) || slugifyModuleId(logicalName),
    logicalName,
    copyName: normalizeRequiredString(project.name) || path.basename(rootPath),
    worktreeRoot: commonRoot,
    pathExists,
    gitBranch: branchResult.ok ? branchResult.stdout : '',
  };
}

async function refreshProjectWorkspaceMeta() {
  const entries = await Promise.all(
    projects.map(async (project) => [project.id, await readProjectWorkspaceMeta(project)]),
  );
  projectWorkspaceMeta = new Map(entries);
}

async function findFirstExistingFile(filePaths) {
  for (const filePath of filePaths) {
    if (await fileExists(filePath)) {
      return filePath;
    }
  }

  return null;
}

async function readFirstExistingConfig(filePaths) {
  const filePath = await findFirstExistingFile(filePaths);
  if (!filePath) {
    return null;
  }

  return {
    filePath,
    content: await readFile(filePath, 'utf8'),
  };
}

function parseActiveProfiles(configContent) {
  const yamlValue = getYamlScalarValue(configContent, ['spring', 'profiles', 'active']);
  const propertiesMatch = String(configContent ?? '').match(/^\s*spring\.profiles\.active\s*=\s*([^#\r\n]+)/m);
  const activeValue = yamlValue || propertiesMatch?.[1] || '';

  return activeValue
    .split(',')
    .map((profile) => normalizeRequiredString(profile).toLowerCase())
    .filter(Boolean);
}

async function readModuleProfileConfigs(resourcePath, baseConfig) {
  let entries = [];
  try {
    entries = await readdir(resourcePath, { withFileTypes: true });
  } catch {
    return [];
  }

  const profileConfigNames = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /^application-[^.]+\.(ya?ml|properties)$/i.test(name))
    .sort((first, second) => first.localeCompare(second, 'zh-CN'));

  const activeProfiles = parseActiveProfiles(baseConfig?.content ?? '');
  const preferredNames = activeProfiles.flatMap((profile) => [
    `application-${profile}.yml`,
    `application-${profile}.yaml`,
    `application-${profile}.properties`,
  ]);
  const orderedNames = [
    ...preferredNames.filter((name) => profileConfigNames.some((configName) => configName.toLowerCase() === name)),
    ...profileConfigNames.filter(
      (name) => !preferredNames.some((preferredName) => preferredName === name.toLowerCase()),
    ),
  ];
  const configs = [];
  const seenNames = new Set();

  for (const name of orderedNames) {
    const normalizedName = name.toLowerCase();
    if (seenNames.has(normalizedName)) {
      continue;
    }
    seenNames.add(normalizedName);

    const config = await readFirstExistingConfig([path.join(resourcePath, name)]);
    if (config) {
      configs.push(config);
    }
  }

  return configs;
}

function mergeConfigContents(configContents = []) {
  return configContents
    .map((content) => String(content ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
}

async function resolveEnvironmentConfig(project, moduleConfig, environment) {
  const modulePath = getModuleAbsolutePath(project, moduleConfig);
  if (!modulePath) {
    return { error: '模块路径不在项目目录内' };
  }

  const resourcePath = path.join(modulePath, 'src', 'main', 'resources');
  const profile = normalizeEnvironmentProfile(environment);
  const baseFileNames = ['application.yml', 'application.yaml', 'application.properties'];
  const baseCandidates = baseFileNames.map((fileName) => path.join(resourcePath, fileName));
  const baseConfig = await readFirstExistingConfig(baseCandidates);
  const profileConfigs = await readModuleProfileConfigs(resourcePath, baseConfig);
  const templatePath = profileConfigs[0]?.filePath ?? baseConfig?.filePath ?? null;
  const activePath = templatePath;

  if (!activePath) {
    return {
      resourcePath,
      profile,
      targetPath: path.join(resourcePath, `application-${profile}.yml`),
      targetExists: false,
      templatePath: '',
      templateExists: false,
      source: 'missing',
      content: '',
    };
  }

  const targetPath = path.join(resourcePath, `application-${profile}${path.extname(activePath) || '.yml'}`);

  const content = mergeConfigContents([baseConfig?.content, ...profileConfigs.map((config) => config.content)]);

  return {
    resourcePath,
    profile,
    targetPath,
    targetExists: false,
    templatePath,
    templateExists: Boolean(templatePath),
    profileTemplatePaths: profileConfigs.map((config) => config.filePath),
    basePath: baseConfig?.filePath ?? '',
    baseExists: Boolean(baseConfig),
    activePath,
    source: baseConfig && profileConfigs.length > 0 ? 'merged' : profileConfigs.length > 0 ? 'template' : 'base',
    content,
  };
}

function buildEnvironmentConfigId(environmentCode, moduleId) {
  return `${normalizeEnvironmentCode(environmentCode)}:${slugifyModuleId(moduleId)}`;
}

function resolvePayloadEnvironments(payload = {}, { fallbackToFirst = false } = {}) {
  const rawCodes = Array.isArray(payload.environmentCodes)
    ? payload.environmentCodes
    : [payload.environmentCode ?? payload.branch].filter(Boolean);
  const requestedCodes = Array.from(
    new Set(rawCodes.map((code) => normalizeEnvironmentCode(code)).filter(Boolean)),
  );

  if (requestedCodes.length === 0) {
    return {
      environments: fallbackToFirst && environments[0] ? [environments[0]] : [],
      missingCodes: [],
    };
  }

  const resolvedEnvironments = requestedCodes
    .map((code) => getEnvironmentByCode(code) ?? getEnvironment(code))
    .filter(Boolean);
  const resolvedCodes = new Set(resolvedEnvironments.map((environment) => environment.code));

  return {
    environments: resolvedEnvironments,
    missingCodes: requestedCodes.filter((code) => !resolvedCodes.has(code)),
  };
}

function resolvePayloadModuleTargets(payload = {}, { fallbackToFirst = false } = {}) {
  if (Array.isArray(payload.targets)) {
    const targets = [];
    const seenKeys = new Set();
    const missingCodes = new Set();

    for (const rawTarget of payload.targets) {
      const moduleId = normalizeRequiredString(rawTarget?.moduleId);
      const environmentCode = normalizeEnvironmentCode(rawTarget?.environmentCode ?? rawTarget?.branch);
      if (!moduleId || !environmentCode) {
        continue;
      }

      const environment = getEnvironmentByCode(environmentCode) ?? getEnvironment(environmentCode);
      if (!environment) {
        missingCodes.add(environmentCode);
        continue;
      }

      const key = `${environment.code}:${moduleId}`;
      if (seenKeys.has(key)) {
        continue;
      }

      seenKeys.add(key);
      targets.push({ moduleId, environment });
    }

    return {
      targets,
      missingCodes: Array.from(missingCodes),
      usesExplicitTargets: true,
    };
  }

  const moduleIds = Array.isArray(payload.moduleIds)
    ? Array.from(new Set(payload.moduleIds.map((moduleId) => normalizeRequiredString(moduleId)).filter(Boolean)))
    : [];
  const { environments: targetEnvironments, missingCodes } = resolvePayloadEnvironments(payload, {
    fallbackToFirst,
  });

  return {
    targets: targetEnvironments.flatMap((environment) =>
      moduleIds.map((moduleId) => ({ moduleId, environment })),
    ),
    moduleIds,
    environments: targetEnvironments,
    missingCodes,
    usesExplicitTargets: false,
  };
}

function savedEnvironmentConfigPayload(savedConfig) {
  if (!savedConfig) {
    return null;
  }

  return {
    content: savedConfig.content ?? '',
    source: 'database',
    exists: true,
    savedAt: savedConfig.savedAt ?? '',
  };
}

function environmentConfigPayload(project, moduleConfig, environment, resolvedConfig, extra = {}) {
  const activePath = resolvedConfig.activePath ?? resolvedConfig.targetPath;
  return {
    environment: {
      id: environment.id,
      code: environment.code,
      name: environment.name,
    },
    project: {
      id: project.id,
      name: project.name,
    },
    module: {
      id: moduleConfig.id,
      name: moduleConfig.name,
      path: moduleConfig.path,
    },
    config: {
      profile: resolvedConfig.profile,
      source: resolvedConfig.source,
      configId: buildEnvironmentConfigId(environment.code, moduleConfig.id),
      exists: resolvedConfig.targetExists,
      editableGroups: buildEditableEnvironmentGroups(resolvedConfig.content, moduleConfig),
      fileName: activePath ? path.basename(activePath) : '',
      filePath: activePath ?? '',
      relativePath: activePath ? getProjectRelativePath(project, activePath) : '',
      targetFileName: path.basename(resolvedConfig.targetPath),
      targetPath: resolvedConfig.targetPath,
      targetRelativePath: getProjectRelativePath(project, resolvedConfig.targetPath),
      templatePath: resolvedConfig.templatePath ?? '',
      templateRelativePath: resolvedConfig.templatePath
        ? getProjectRelativePath(project, resolvedConfig.templatePath)
        : '',
      hash: getContentHash(resolvedConfig.content),
      summary: summarizeEnvironmentConfig(resolvedConfig.content),
      content: resolvedConfig.content,
      ...extra,
    },
    meta: {
      lastUpdated: formatTime(lastUpdated),
      autoRefresh,
    },
  };
}

async function getEnvironmentConfig(projectId, moduleId, environmentCode) {
  const project = getProject(projectId);
  const normalizedEnvironmentCode = normalizeEnvironmentCode(environmentCode);
  const environment = getEnvironmentByCode(normalizedEnvironmentCode) ?? getEnvironment(normalizedEnvironmentCode);
  const moduleConfig = project ? findProjectModule(project.id, moduleId) : null;

  if (!project) {
    return { error: '项目不存在', statusCode: 404 };
  }

  if (!environment) {
    return { error: '环境不存在', statusCode: 404 };
  }

  if (!moduleConfig) {
    return { error: '模块不存在', statusCode: 404 };
  }

  const fileConfig = await resolveEnvironmentConfig(project, moduleConfig, environment);
  if (fileConfig.error) {
    return { error: fileConfig.error, statusCode: 400 };
  }

  const savedConfig = await getSavedEnvironmentConfig(buildEnvironmentConfigId(environment.code, moduleConfig.id));
  const savedPayload = savedEnvironmentConfigPayload(savedConfig);
  const resolvedConfig = savedPayload
    ? {
        ...fileConfig,
        ...savedPayload,
      }
    : fileConfig;

  return environmentConfigPayload(project, moduleConfig, environment, resolvedConfig, {
    hasSavedConfig: Boolean(savedConfig),
    savedAt: savedConfig?.savedAt ?? '',
  });
}

async function getDefaultEnvironmentConfig(projectId, moduleId, environmentCode) {
  const project = getProject(projectId);
  const normalizedEnvironmentCode = normalizeEnvironmentCode(environmentCode);
  const environment = getEnvironmentByCode(normalizedEnvironmentCode) ?? getEnvironment(normalizedEnvironmentCode);
  const moduleConfig = project ? findProjectModule(project.id, moduleId) : null;

  if (!project) {
    return { error: '项目不存在', statusCode: 404 };
  }

  if (!environment) {
    return { error: '环境不存在', statusCode: 404 };
  }

  if (!moduleConfig) {
    return { error: '模块不存在', statusCode: 404 };
  }

  const resolvedConfig = await resolveEnvironmentConfig(project, moduleConfig, environment);
  if (resolvedConfig.error) {
    return { error: resolvedConfig.error, statusCode: 400 };
  }

  return environmentConfigPayload(project, moduleConfig, environment, resolvedConfig, {
    hasSavedConfig: false,
    reloadedDefault: true,
  });
}

async function resolveRuntimeEnvironmentConfig(project, moduleConfig, environment) {
  const savedConfig = await getSavedEnvironmentConfig(buildEnvironmentConfigId(environment.code, moduleConfig.id));
  if (!savedConfig?.content?.trim()) {
    return {
      error: '请先在配置管理中保存当前环境和模块的数据库配置',
      source: 'missing',
      content: '',
    };
  }

  const fileConfig = await resolveEnvironmentConfig(project, moduleConfig, environment);
  if (fileConfig.error) {
    return fileConfig;
  }

  return {
    ...fileConfig,
    content: savedConfig.content,
    source: 'database',
    savedAt: savedConfig.savedAt ?? '',
  };
}

async function resolveModuleStartPorts(project, moduleConfig, environment) {
  const runtimeConfig = await resolveRuntimeEnvironmentConfig(project, moduleConfig, environment);
  const configuredPort = runtimeConfig.error ? null : parsePortValue(getYamlScalarValue(runtimeConfig.content, SERVER_PORT_PATH));
  return {
    config: runtimeConfig,
    serverPort: configuredPort,
  };
}

async function writeRuntimeEnvironmentConfig(project, moduleConfig, environment, runtimeConfig, ports) {
  if (runtimeConfig?.error || !runtimeConfig?.content?.trim()) {
    return null;
  }

  const profile = normalizeEnvironmentProfile(environment);
  const runtimeDirectory = buildRuntimeConfigDirectory(project, moduleConfig, environment);
  const runtimeFilePath = path.join(runtimeDirectory, `application-${profile}.yml`);
  const runtimeContent = buildRuntimeOverrideYaml(runtimeConfig.content, ports);

  await mkdir(runtimeDirectory, { recursive: true });
  await writeFile(runtimeFilePath, runtimeContent, { encoding: 'utf8' });

  return {
    directory: runtimeDirectory,
    filePath: runtimeFilePath,
    fileUrl: pathToFileURL(`${runtimeDirectory}${path.sep}`).href,
    content: runtimeContent,
    source: runtimeConfig.source,
  };
}

async function saveEnvironmentConfig(payload = {}) {
  const projectId = normalizeRequiredString(payload.projectId);
  const moduleId = normalizeRequiredString(payload.moduleId);
  const environmentCode = normalizeEnvironmentCode(payload.environmentCode);
  const rawContent = typeof payload.content === 'string' ? payload.content : '';
  const fields = normalizeEditableConfigFields(payload.fields);
  const project = getProject(projectId);
  const environment = getEnvironmentByCode(environmentCode) ?? getEnvironment(environmentCode);
  const moduleConfig = project ? findProjectModule(project.id, moduleId) : null;

  if (!project) {
    return { error: '项目不存在', statusCode: 404 };
  }

  if (!environment) {
    return { error: '环境不存在', statusCode: 404 };
  }

  if (!moduleConfig) {
    return { error: '模块不存在', statusCode: 404 };
  }

  const requestedServerPort = normalizeEditableConfigFields(fields).find(
    (field) => field.path.join('.') === SERVER_PORT_PATH.join('.'),
  )?.value;
  if (requestedServerPort !== undefined && !parsePortValue(requestedServerPort)) {
    return { error: '启动端口必须是正整数', statusCode: 400 };
  }

  const fileConfig = await resolveEnvironmentConfig(project, moduleConfig, environment);
  if (fileConfig.error) {
    return { error: fileConfig.error, statusCode: 400 };
  }

  const baseContent = rawContent.trim() ? rawContent : fileConfig.content ?? '';
  if (!baseContent.trim()) {
    return { error: '配置内容不能为空', statusCode: 400 };
  }

  const content = fields.length > 0 ? applyEnvironmentConfigFields(baseContent, fields) : baseContent;
  const configId = buildEnvironmentConfigId(environment.code, moduleConfig.id);
  const savedAt = new Date().toISOString();
  await saveSavedEnvironmentConfig({
    id: configId,
    environmentCode: environment.code,
    environmentName: environment.name,
    moduleId: moduleConfig.id,
    moduleName: moduleConfig.name,
    content,
    savedAt,
  });
  setUpdated();

  return environmentConfigPayload(project, moduleConfig, environment, {
    ...fileConfig,
    content,
    source: 'database',
    exists: true,
    savedAt,
  }, {
    hasSavedConfig: true,
    savedAt,
    saved: true,
  });
}

async function scanProjectModules(project) {
  const rootPath = normalizeRequiredString(project.path);
  if (!rootPath) {
    return [];
  }

  const visited = new Set();
  const configuredProfiles = environments.map((environment) => normalizeEnvironmentProfile(environment));

  async function scanDirectory(relativePath = '') {
    const normalizedRelativePath = relativePath.replace(/[\\/]+/g, '/').replace(/^\/+|\/+$/g, '');
    const absolutePath = path.join(rootPath, normalizedRelativePath);
    const pomPath = path.join(absolutePath, 'pom.xml');
    const comparablePomPath = normalizeComparablePath(pomPath);

    if (visited.has(comparablePomPath) || !(await fileExists(pomPath))) {
      return [];
    }
    visited.add(comparablePomPath);

    const pomContent = await readFile(pomPath, 'utf8');
    const childModules = readModuleEntries(pomContent);
    const moduleId = slugifyModuleId(readPomArtifactId(pomContent) || path.basename(absolutePath));
    const currentModule =
      normalizedRelativePath
        ? [
            {
              id: moduleId,
              path: normalizedRelativePath,
              projectIds: [project.id],
              projectNames: [project.name],
              hasChildren: childModules.length > 0,
              detectedName: moduleId,
              detectedPort: await readModuleConfigPort(absolutePath, configuredProfiles),
              detectedExtraPorts: await readModuleExtraPorts(absolutePath, configuredProfiles),
            },
          ]
        : [];

    const childResults = await Promise.all(
      childModules.map((modulePath) => scanDirectory(path.join(normalizedRelativePath, modulePath))),
    );
    return [...currentModule, ...childResults.flat()];
  }

  if (await fileExists(path.join(rootPath, 'pom.xml'))) {
    return scanDirectory();
  }

  // Some projects keep the Maven aggregator under modules/pom.xml instead of the project root.
  return scanDirectory('modules');
}

function normalizeModuleSetting(setting = {}) {
  const id = normalizeRequiredString(setting.id);
  if (!id) {
    return null;
  }

  const defaultPort = Number(setting.defaultPort);
  const normalizedId = slugifyModuleId(id);
  return {
    id: normalizedId,
    name: normalizeRequiredString(setting.name),
    defaultPort: Number.isInteger(defaultPort) && defaultPort > 0 ? defaultPort : null,
    extraPorts: Array.isArray(setting.extraPorts) ? setting.extraPorts : [],
    hidden: setting.hidden === true,
  };
}

function normalizeModuleSettings(settings = []) {
  const mergedSettings = new Map();

  for (const setting of settings) {
    const normalized = normalizeModuleSetting(setting);
    if (!normalized) {
      continue;
    }

    mergedSettings.set(normalized.id, {
      ...(mergedSettings.get(normalized.id) ?? {}),
      ...normalized,
    });
  }

  return Array.from(mergedSettings.values());
}

function getModuleSetting(moduleId) {
  return moduleSettings.find((setting) => setting.id === moduleId);
}

function isModuleHidden(moduleId) {
  return getModuleSetting(moduleId)?.hidden === true;
}

async function refreshModulesFromProjects() {
  const scanResults = await Promise.all(projects.map((project) => scanProjectModules(project)));
  const moduleMap = new Map();

  for (const moduleRecord of scanResults.flat()) {
    const existing = moduleMap.get(moduleRecord.id);
    if (!existing) {
      moduleMap.set(moduleRecord.id, moduleRecord);
      continue;
    }

    existing.projectIds = Array.from(new Set([...existing.projectIds, ...moduleRecord.projectIds]));
    existing.projectNames = Array.from(new Set([...existing.projectNames, ...moduleRecord.projectNames]));
    existing.hasChildren = existing.hasChildren || moduleRecord.hasChildren;
    existing.detectedPort = existing.detectedPort ?? moduleRecord.detectedPort;
    existing.detectedName = existing.detectedName ?? moduleRecord.detectedName;
    existing.detectedExtraPorts = existing.detectedExtraPorts?.length
      ? existing.detectedExtraPorts
      : moduleRecord.detectedExtraPorts;
    if (moduleRecord.path.length < existing.path.length) {
      existing.path = moduleRecord.path;
    }
  }

  modules = Array.from(moduleMap.values())
    .filter((moduleRecord) => !isModuleHidden(moduleRecord.id))
    .map((moduleRecord) => {
      const setting = getModuleSetting(moduleRecord.id);
      return {
        ...moduleRecord,
        name: setting?.name || moduleRecord.detectedName || titleFromModuleId(moduleRecord.id),
        defaultPort: setting?.defaultPort ?? moduleRecord.detectedPort ?? null,
        extraPorts: setting?.extraPorts?.length ? setting.extraPorts : moduleRecord.detectedExtraPorts ?? [],
        configured: Boolean(setting?.defaultPort ?? moduleRecord.detectedPort),
      };
    })
    .sort((first, second) => first.path.localeCompare(second.path, 'zh-CN'));
}

function getProjectRunRecords(projectId) {
  return runRecords.filter((record) => record.projectId === projectId).map(publicRunRecord);
}

function getActiveProjectRunRecords(projectId) {
  return runRecords.filter(
    (record) => record.projectId === projectId && ACTIVE_RUN_STATUSES.has(record.status),
  );
}

function getProjectActiveEnvironment(projectId) {
  const activeRecords = getActiveProjectRunRecords(projectId);
  const activeEnvironmentCodes = Array.from(
    new Set(activeRecords.map((record) => normalizeEnvironmentCode(record.environmentCode)).filter(Boolean)),
  );
  if (activeEnvironmentCodes.length === 0) {
    return null;
  }

  const environmentCode = activeEnvironmentCodes[0];
  const environment = getEnvironmentByCode(environmentCode) ?? getEnvironment(environmentCode);
  return {
    code: environmentCode,
    name: environment?.name ?? activeRecords.find((record) => record.environmentCode === environmentCode)?.environmentName ?? environmentCode,
    moduleNames: activeRecords
      .filter((record) => normalizeEnvironmentCode(record.environmentCode) === environmentCode)
      .map((record) => record.moduleName ?? record.moduleId),
  };
}

function buildProjectEnvironmentConflict(projectId, environmentCode) {
  const requestedEnvironmentCode = normalizeEnvironmentCode(environmentCode);
  const activeEnvironment = getProjectActiveEnvironment(projectId);
  if (!activeEnvironment || activeEnvironment.code === requestedEnvironmentCode) {
    return null;
  }

  const requestedEnvironment = getEnvironmentByCode(requestedEnvironmentCode) ?? getEnvironment(requestedEnvironmentCode);
  return {
    activeEnvironment,
    requestedEnvironment: {
      code: requestedEnvironmentCode,
      name: requestedEnvironment?.name ?? requestedEnvironmentCode,
    },
    message: `当前项目已经在运行 ${activeEnvironment.name}，请先关停后再启动 ${requestedEnvironment?.name ?? requestedEnvironmentCode}`,
  };
}

function getSavedEnvironmentModulePort(savedConfigMap, moduleRecord, environmentCode) {
  const normalizedEnvironmentCode = normalizeEnvironmentCode(environmentCode);
  const configId = buildEnvironmentConfigId(normalizedEnvironmentCode, moduleRecord.id);
  const savedConfig = savedConfigMap.get(configId);
  const savedPort = savedConfig?.content ? parsePortValue(getYamlScalarValue(savedConfig.content, SERVER_PORT_PATH)) : null;
  return {
    port: savedPort ?? null,
    source: savedPort ? 'database' : 'missing',
    hasSavedConfig: Boolean(savedConfig),
  };
}

function hasSavedEnvironmentModulePort(environmentPorts = {}) {
  return Object.values(environmentPorts).some((portConfig) => {
    const port = typeof portConfig === 'object' && portConfig !== null ? portConfig.port : portConfig;
    return Number.isInteger(Number(port)) && Number(port) > 0;
  });
}

function getModuleEnvironmentPorts(savedConfigMap, moduleRecord) {
  return Object.fromEntries(
    environments.map((environment) => [
      environment.code,
      getSavedEnvironmentModulePort(savedConfigMap, moduleRecord, environment.code),
    ]),
  );
}

function getProjectRuntimeModules(projectId, savedConfigMap = new Map()) {
  return modules
    .filter((moduleRecord) => moduleRecord.projectIds.includes(projectId) && !moduleRecord.hasChildren)
    .map((moduleRecord) => {
      const environmentPorts = getModuleEnvironmentPorts(savedConfigMap, moduleRecord);
      const moduleRecords = runRecords.filter(
        (record) => record.projectId === projectId && record.moduleId === moduleRecord.id,
      );
      const activeRecord =
        moduleRecords.find((record) => ACTIVE_RUN_STATUSES.has(record.status)) ?? moduleRecords[0];
      const configured = hasSavedEnvironmentModulePort(environmentPorts);
      return {
        id: moduleRecord.id,
        name: moduleRecord.name,
        defaultPort: moduleRecord.defaultPort,
        environmentPorts,
        configured,
        status: activeRecord?.status ?? (configured ? 'ready' : 'not-configured'),
        statusText: activeRecord?.statusText ?? (configured ? '可启动' : '缺少端口'),
        environmentName: activeRecord?.environmentName ?? activeRecord?.branchName ?? '',
        ports: activeRecord?.ports ?? null,
        processId: activeRecord?.processId ?? null,
        command: activeRecord?.command ?? '',
        cwd: activeRecord?.cwd ?? '',
      };
    });
}

function buildProjectRuntime(project, savedConfigMap = new Map()) {
  const workspace = projectWorkspaceMeta.get(project.id) ?? {
    logicalId: project.id,
    logicalName: project.name,
    copyName: project.name,
    pathExists: Boolean(project.path),
    worktreeRoot: project.path,
    gitBranch: '',
  };
  const runtimeModules = getProjectRuntimeModules(project.id, savedConfigMap);
  const configuredCount = runtimeModules.filter((moduleRecord) => moduleRecord.configured).length;
  const detectedPortCount = runtimeModules.filter((moduleRecord) => moduleRecord.defaultPort).length;
  const runningCount = runtimeModules.filter((moduleRecord) => moduleRecord.status === 'running').length;
  const startingCount = runtimeModules.filter((moduleRecord) => moduleRecord.status === 'starting').length;
  const failedCount = runtimeModules.filter((moduleRecord) => moduleRecord.status === 'failed').length;
  const notConfiguredCount = runtimeModules.filter((moduleRecord) => moduleRecord.status === 'not-configured').length;
  const activeEnvironment = getProjectActiveEnvironment(project.id);
  const canStart = Boolean(workspace.pathExists && configuredCount > 0 && environments.length > 0);
  const blockedReasons = [
    !workspace.pathExists ? '项目路径不存在' : '',
    runtimeModules.length === 0 ? '未识别到可启动模块' : '',
    runtimeModules.length > 0 && configuredCount === 0 ? '模块端口未识别' : '',
    environments.length === 0 ? '未配置环境' : '',
  ].filter(Boolean);

  return {
    logicalId: workspace.logicalId,
    logicalName: workspace.logicalName,
    copyName: workspace.copyName,
    worktreeRoot: workspace.worktreeRoot,
    gitBranch: workspace.gitBranch,
    pathExists: workspace.pathExists,
    canStart,
    status: runningCount > 0 ? 'running' : startingCount > 0 ? 'starting' : failedCount > 0 ? 'failed' : canStart ? 'ready' : 'blocked',
    statusText: runningCount > 0 ? '运行中' : startingCount > 0 ? '启动中' : failedCount > 0 ? '启动失败' : canStart ? '可启动' : '不可启动',
    blockedReasons,
    moduleCount: runtimeModules.length,
    configuredModuleCount: configuredCount,
    detectedPortModuleCount: detectedPortCount,
    missingPortModuleCount: runtimeModules.length - detectedPortCount,
    notConfiguredModuleCount: notConfiguredCount,
    commandReadyModuleCount: runningCount + startingCount,
    runningModuleCount: runningCount,
    startingModuleCount: startingCount,
    failedModuleCount: failedCount,
    activeEnvironment,
    modules: runtimeModules,
  };
}

function projectPayload(project, savedConfigMap = new Map()) {
  return {
    ...project,
    runtime: buildProjectRuntime(project, savedConfigMap),
  };
}

function buildLogicalProjectsPayload(projectPayloads) {
  const logicalMap = new Map();

  for (const project of projectPayloads) {
    const logicalId = project.runtime.logicalId || project.id;
    if (!logicalMap.has(logicalId)) {
      logicalMap.set(logicalId, {
        id: logicalId,
        name: project.runtime.logicalName || project.name,
        accent: project.accent,
        copies: [],
        moduleMap: new Map(),
      });
    }

    const logicalProject = logicalMap.get(logicalId);
    logicalProject.copies.push(project);

    for (const moduleRecord of project.runtime.modules) {
      const existing = logicalProject.moduleMap.get(moduleRecord.id) ?? {
        id: moduleRecord.id,
        name: moduleRecord.name,
        defaultPort: moduleRecord.defaultPort,
        configured: false,
        copyStatuses: [],
      };
      existing.configured = existing.configured || Boolean(moduleRecord.configured);
      existing.copyStatuses.push({
        projectId: project.id,
        copyName: project.runtime.copyName,
        status: moduleRecord.status,
        statusText: moduleRecord.statusText,
        ports: moduleRecord.ports,
      });
      logicalProject.moduleMap.set(moduleRecord.id, existing);
    }
  }

  return Array.from(logicalMap.values()).map((logicalProject, index) => {
    const copies = logicalProject.copies;
    const moduleList = Array.from(logicalProject.moduleMap.values());
    const runningCopyCount = copies.filter((copy) => copy.runtime.status === 'running').length;
    const startingCopyCount = copies.filter((copy) => copy.runtime.status === 'starting').length;
    const failedCopyCount = copies.filter((copy) => copy.runtime.status === 'failed').length;
    const readyCopyCount = copies.filter((copy) => copy.runtime.canStart).length;
    const canStart = readyCopyCount > 0;
    const status = runningCopyCount > 0 ? 'running' : startingCopyCount > 0 ? 'starting' : failedCopyCount > 0 ? 'failed' : canStart ? 'ready' : 'blocked';
    const detectedPortModuleCount = moduleList.filter((moduleRecord) => moduleRecord.defaultPort).length;

    return {
      id: logicalProject.id,
      name: logicalProject.name,
      accent: logicalProject.accent ?? PROJECT_ACCENTS[index % PROJECT_ACCENTS.length],
      status,
      statusText: runningCopyCount > 0 ? '运行中' : startingCopyCount > 0 ? '启动中' : failedCopyCount > 0 ? '启动失败' : canStart ? '可启动' : '不可启动',
      canStart,
      copyCount: copies.length,
      readyCopyCount,
      commandReadyCopyCount: runningCopyCount + startingCopyCount,
      runningCopyCount,
      startingCopyCount,
      failedCopyCount,
      moduleCount: moduleList.length,
      configuredModuleCount: moduleList.filter((moduleRecord) => moduleRecord.configured).length,
      detectedPortModuleCount,
      missingPortModuleCount: moduleList.length - detectedPortModuleCount,
      copies,
      modules: moduleList,
    };
  });
}

function allocateRuntimeModulePorts(projectId, moduleConfig, serverPort, environmentCode = '') {
  const configuredServerPort = Number(serverPort);
  const normalizedEnvironmentCode = normalizeEnvironmentCode(environmentCode);
  const sameModuleRecords = runRecords.filter(
    (record) => record.moduleId === moduleConfig.id && ACTIVE_RUN_STATUSES.has(record.status),
  );
  const projectAlreadyRunning = sameModuleRecords.find(
    (record) =>
      record.projectId === projectId &&
      (!normalizedEnvironmentCode || normalizeEnvironmentCode(record.environmentCode) === normalizedEnvironmentCode),
  );
  if (projectAlreadyRunning) {
    return {
      status: 'already-running',
      ports: projectAlreadyRunning.ports,
      conflict: false,
    };
  }

  if (!Number.isInteger(configuredServerPort) || configuredServerPort <= 0) {
    return {
      status: 'not-configured',
      ports: {},
      conflict: false,
    };
  }

  const defaultPortTaken = sameModuleRecords.some((record) => record.ports.server === configuredServerPort);
  const offset = defaultPortTaken ? 10000 : 0;
  const ports = {
    server: configuredServerPort + offset,
  };

  for (const extraPort of moduleConfig.extraPorts ?? []) {
    ports[extraPort.key] = extraPort.defaultPort + offset;
  }

  return {
    status: 'allocated',
    ports,
    conflict: defaultPortTaken,
  };
}

function findProjectModule(projectId, moduleId) {
  return modules.find(
    (moduleRecord) => moduleRecord.id === moduleId && moduleRecord.projectIds.includes(projectId),
  );
}

function upsertRunRecord(record) {
  runRecords = [
    record,
    ...runRecords.filter((item) => item.id !== record.id),
  ];
}

function getRunRecord(recordId) {
  return runRecords.find((record) => record.id === recordId) ?? null;
}

function safeLogPathSegment(value) {
  return normalizeRequiredString(value).replace(/[^a-zA-Z0-9._-]+/g, '_') || 'unknown';
}

function buildRunLogFilePath(recordId) {
  const [projectId = 'project', moduleId = 'module', environmentCode = 'env'] = String(recordId).split(':');
  return path.join(
    LOG_DIR,
    safeLogPathSegment(projectId),
    safeLogPathSegment(environmentCode),
    safeLogPathSegment(moduleId),
    `${Date.now()}.log`,
  );
}

async function readLogSnapshot(record) {
  if (!record?.logFilePath || !(await fileExists(record.logFilePath))) {
    return record?.lastOutput ?? '';
  }

  const content = await readFile(record.logFilePath, 'utf8');
  return content.slice(-MAX_SSE_LOG_SNAPSHOT_LENGTH);
}

function decodeProcessLogLine(buffer) {
  if (!buffer?.length) {
    return '';
  }

  try {
    return UTF8_PROCESS_LOG_DECODER.decode(buffer);
  } catch {
    return GB18030_PROCESS_LOG_DECODER.decode(buffer);
  }
}

function publicRunRecord(record) {
  if (!record) {
    return null;
  }

  return {
    ...record,
    hasLogFile: Boolean(record.logFilePath),
    logStreamUrl: `/api/run-records/${encodeURIComponent(record.id)}/logs/stream`,
  };
}

function parseProcessServerPort(commandLine) {
  const text = String(commandLine ?? '');
  const argumentMatch = text.match(/--server\.port=([0-9]+)/i);
  if (argumentMatch) {
    return Number(argumentMatch[1]);
  }

  const propertyMatch = text.match(/(?:^|\s)-Dserver\.port=([0-9]+)/i);
  return propertyMatch ? Number(propertyMatch[1]) : null;
}

function parseProcessProfile(commandLine) {
  const text = String(commandLine ?? '');
  const profileMatch = text.match(/-Dspring-boot\.run\.profiles=([^\s"']+)/i);
  if (profileMatch) {
    return normalizeEnvironmentProfileFromName(profileMatch[1]);
  }

  const activeProfileMatch = text.match(/--spring\.profiles\.active=([^\s"']+)/i);
  return activeProfileMatch ? normalizeEnvironmentProfileFromName(activeProfileMatch[1]) : '';
}

function normalizeProcessPath(value) {
  return normalizeComparablePath(String(value ?? '').replace(/^['"]|['"]$/g, ''));
}

function buildRuntimeConfigDirectory(project, moduleConfig, environment) {
  return path.join(
    RUNTIME_CONFIG_DIR,
    safeLogPathSegment(project.id),
    safeLogPathSegment(environment.code),
    safeLogPathSegment(moduleConfig.id),
  );
}

function processMatchesModule(processInfo, moduleCwd, serverPort, profile = '', runtimeConfigDirectory = '') {
  const commandLine = String(processInfo?.commandLine ?? '');
  if (!commandLine) {
    return false;
  }
  if (serverPort && parseProcessServerPort(commandLine) !== serverPort) {
    return false;
  }

  const processProfile = parseProcessProfile(commandLine);
  const expectedProfile = normalizeEnvironmentProfileFromName(profile);
  if (processProfile && expectedProfile && processProfile !== expectedProfile) {
    return false;
  }

  const normalizedCommand = normalizeProcessPath(commandLine);
  const normalizedRuntimeConfigDirectory = normalizeProcessPath(runtimeConfigDirectory);
  if (
    normalizedRuntimeConfigDirectory &&
    normalizedCommand.includes(normalizedRuntimeConfigDirectory)
  ) {
    return true;
  }

  const normalizedCwd = normalizeProcessPath(moduleCwd);
  if (normalizedCwd && normalizedCommand.includes(normalizedCwd)) {
    return true;
  }

  return false;
}

function findSystemModuleProcess(processes, moduleCwd, serverPort, profile = '', runtimeConfigDirectory = '') {
  const matchingProcesses = processes.filter((processInfo) =>
    processMatchesModule(processInfo, moduleCwd, serverPort, profile, runtimeConfigDirectory),
  );
  if (matchingProcesses.length === 0) {
    return null;
  }

  return (
    matchingProcesses.find((processInfo) => parseProcessServerPort(processInfo.commandLine) === serverPort) ??
    matchingProcesses[0]
  );
}

function findSystemRunRecordProcess(processes, record) {
  const moduleCwd = record?.moduleCwd ?? record?.cwd ?? '';
  const serverPort = record?.ports?.server ? Number(record.ports.server) : null;
  const profile = record?.profile ?? record?.environmentCode ?? record?.branch ?? '';
  const runtimeConfigDirectory = record?.runtimeConfigPath ? path.dirname(record.runtimeConfigPath) : '';
  return findSystemModuleProcess(processes, moduleCwd, serverPort, profile, runtimeConfigDirectory);
}

async function killProcessTree(pid) {
  const normalizedPid = Number(pid);
  if (!Number.isInteger(normalizedPid) || normalizedPid <= 0) {
    return { attempted: false, ok: false, message: 'missing pid' };
  }

  if (process.platform === 'win32') {
    const result = await execFileText('taskkill.exe', ['/PID', String(normalizedPid), '/T', '/F'], {
      timeout: 15000,
    });
    return {
      attempted: true,
      ok: result.ok || /not found|找不到|没有运行/i.test(`${result.stdout}\n${result.stderr}`),
      message: result.stdout || result.stderr,
    };
  }

  try {
    process.kill(-normalizedPid, 'SIGTERM');
  } catch {
    try {
      process.kill(normalizedPid, 'SIGTERM');
    } catch {
      return { attempted: true, ok: true, message: 'process already exited' };
    }
  }

  return { attempted: true, ok: true, message: 'SIGTERM sent' };
}

async function confirmRunRecordStopped(record) {
  const serverPort = record?.ports?.server ? Number(record.ports.server) : null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) {
      await wait(700);
    }

    const processes = await listSystemJavaProcesses();
    const matchingProcess = findSystemRunRecordProcess(processes, record);
    const portListening = serverPort ? await isPortListening(serverPort) : false;
    if (!matchingProcess && !portListening) {
      return { stopped: true, matchingProcess: null, portListening: false };
    }
  }

  const processes = await listSystemJavaProcesses();
  return {
    stopped: false,
    matchingProcess: findSystemRunRecordProcess(processes, record),
    portListening: serverPort ? await isPortListening(serverPort) : false,
  };
}

function buildRecoveredRunLogFilePath(project, moduleConfig, environment, processInfo) {
  const processKey = processInfo?.processId
    ? `pid-${processInfo.processId}`
    : createHash('sha1')
      .update(String(processInfo?.commandLine ?? 'external-process'))
      .digest('hex')
      .slice(0, 12);

  return path.join(
    LOG_DIR,
    safeLogPathSegment(project.id),
    safeLogPathSegment(environment.code),
    safeLogPathSegment(moduleConfig.id),
    `external-process-${processKey}.log`,
  );
}

async function findLatestRunLogFile(project, moduleConfig, environment) {
  const logDirectory = path.join(
    LOG_DIR,
    safeLogPathSegment(project.id),
    safeLogPathSegment(environment.code),
    safeLogPathSegment(moduleConfig.id),
  );

  try {
    const entries = await readdir(logDirectory, { withFileTypes: true });
    const candidates = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.log'))
        .map(async (entry) => {
          const filePath = path.join(logDirectory, entry.name);
          const fileStat = await stat(filePath);
          return { filePath, modifiedAt: fileStat.mtimeMs };
        }),
    );

    candidates.sort((first, second) => second.modifiedAt - first.modifiedAt);
    return (
      candidates.find((candidate) => !path.basename(candidate.filePath).startsWith('external-process'))?.filePath ??
      candidates[0]?.filePath ??
      null
    );
  } catch {
    return null;
  }
}

async function writeRecoveredRunLogOnce(logFilePath, record, project, moduleConfig, environment, ports, processInfo) {
  await mkdir(path.dirname(logFilePath), { recursive: true });
  const content = [
    `恢复时间：${record.startedAt}`,
    `项目：${project.name}`,
    `环境：${environment.name}`,
    `模块：${moduleConfig.name}`,
    `端口：${ports.server}`,
    `PID：${processInfo.processId ?? '-'}`,
    `命令：${processInfo.commandLine}`,
    '',
  ].join('\n');

  try {
    await writeFile(logFilePath, content, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    // 服务重启或并发刷新时，已有恢复日志说明这条外部进程已被展示过，避免重复刷屏。
    if (error?.code === 'EEXIST') {
      return;
    }
    throw error;
  }
}

async function recoverModuleRunRecord(processes, project, moduleConfig, environment, ports) {
  const moduleCwd = getModuleAbsolutePath(project, moduleConfig);
  if (!moduleCwd) {
    return null;
  }

  const runtimeConfigDirectory = buildRuntimeConfigDirectory(project, moduleConfig, environment);
  const processInfo = findSystemModuleProcess(
    processes,
    moduleCwd,
    ports.server,
    normalizeEnvironmentProfile(environment),
    runtimeConfigDirectory,
  );
  if (!processInfo) {
    return null;
  }
  const processServerPort = parseProcessServerPort(processInfo.commandLine);
  const recoveredPorts = {
    ...ports,
    server: processServerPort ?? ports.server,
  };

  const recordId = `${project.id}:${moduleConfig.id}:${environment.code}`;
  const existingRecord = getRunRecord(recordId);
  if (existingRecord) {
    existingRecord.status = 'running';
    existingRecord.statusText = '运行中';
    existingRecord.processId = processInfo.processId;
    existingRecord.ports = recoveredPorts;
    existingRecord.cwd = moduleCwd;
    existingRecord.command = processInfo.commandLine;
    return existingRecord;
  }

  const logFilePath =
    (await findLatestRunLogFile(project, moduleConfig, environment)) ??
    buildRecoveredRunLogFilePath(project, moduleConfig, environment, processInfo);
  const record = {
    id: recordId,
    projectId: project.id,
    projectName: project.name,
    moduleId: moduleConfig.id,
    moduleName: moduleConfig.name,
    environmentCode: environment.code,
    environmentName: environment.name,
    branch: environment.code,
    branchName: environment.name,
    status: 'running',
    statusText: '运行中',
    ports: recoveredPorts,
    conflictHandled: false,
    command: processInfo.commandLine,
    cwd: moduleCwd,
    startedAt: formatTime(new Date()),
    processId: processInfo.processId,
    lastOutput: `已从系统进程恢复运行状态。PID：${processInfo.processId ?? '-'}`,
    logFilePath,
    recovered: true,
  };
  upsertRunRecord(record);
  if (!(await fileExists(logFilePath))) {
    await writeRecoveredRunLogOnce(logFilePath, record, project, moduleConfig, environment, recoveredPorts, processInfo);
  }
  return record;
}

function notifyRunRecordSubscribers(recordId, event, payload) {
  const subscribers = logSubscribers.get(recordId);
  if (!subscribers?.size) {
    return;
  }

  for (const subscriber of subscribers) {
    sendSseEvent(subscriber, event, payload);
  }
}

async function streamRunRecordLogs(recordId, req, res) {
  const record = getRunRecord(recordId);
  if (!record) {
    sendJson(res, 404, { message: '当前模块没有启动进程' });
    return;
  }

  writeSseHeaders(req, res);

  let subscribers = logSubscribers.get(recordId);
  if (!subscribers) {
    subscribers = new Set();
    logSubscribers.set(recordId, subscribers);
  }
  subscribers.add(res);

  let lastSnapshotText = await readLogSnapshot(record);
  sendSseEvent(res, 'snapshot', {
    record: publicRunRecord(record),
    text: lastSnapshotText,
  });

  const keepAliveTimer = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 15000);
  const shouldPollLogFile = !managedProcesses.has(recordId);
  const logPollTimer = shouldPollLogFile ? setInterval(async () => {
    const currentRecord = getRunRecord(recordId);
    if (!currentRecord) {
      clearInterval(logPollTimer);
      return;
    }

    const nextSnapshotText = await readLogSnapshot(currentRecord);
    if (nextSnapshotText === lastSnapshotText) {
      return;
    }

    if (nextSnapshotText.startsWith(lastSnapshotText)) {
      sendSseEvent(res, 'log', {
        record: publicRunRecord(currentRecord),
        text: nextSnapshotText.slice(lastSnapshotText.length),
      });
    } else {
      sendSseEvent(res, 'snapshot', {
        record: publicRunRecord(currentRecord),
        text: nextSnapshotText,
      });
    }
    lastSnapshotText = nextSnapshotText;
  }, 1500) : null;

  req.on('close', () => {
    clearInterval(keepAliveTimer);
    if (logPollTimer) {
      clearInterval(logPollTimer);
    }
    subscribers.delete(res);
    if (subscribers.size === 0) {
      logSubscribers.delete(recordId);
    }
  });
}

async function startProjectModuleRecord(project, moduleConfig, environment) {
  const runtime = buildProjectRuntime(project);
  if (!runtime.pathExists) {
    return {
      ok: false,
      module: moduleConfig,
      message: '项目路径不存在，不能启动模块',
    };
  }

  const portConfig = await resolveModuleStartPorts(project, moduleConfig, environment);
  if (!portConfig.serverPort) {
    return {
      ok: false,
      module: moduleConfig,
      message: '请先在配置管理中设置当前环境和模块的启动端口',
    };
  }

  const allocation = allocateRuntimeModulePorts(project.id, moduleConfig, portConfig.serverPort, environment.code);
  if (allocation.status === 'already-running') {
    const record = runRecords.find(
      (item) =>
        item.projectId === project.id &&
        item.moduleId === moduleConfig.id &&
        normalizeEnvironmentCode(item.environmentCode) === normalizeEnvironmentCode(environment.code) &&
        ACTIVE_RUN_STATUSES.has(item.status),
    );
    return {
      ok: true,
      module: moduleConfig,
      allocation,
      command: record ? { cwd: record.cwd, command: record.command } : null,
      message: '模块已经在启动或运行中',
      record: publicRunRecord(record),
    };
  }

  const mavenRuntime = await resolveMavenRuntime(project, moduleConfig);
  if (!mavenRuntime) {
    const recordId = `${project.id}:${moduleConfig.id}:${environment.code}`;
    const logFilePath = buildRunLogFilePath(recordId);
    const record = {
      id: recordId,
      projectId: project.id,
      projectName: project.name,
      moduleId: moduleConfig.id,
      moduleName: moduleConfig.name,
      environmentCode: environment.code,
      environmentName: environment.name,
      branch: environment.code,
      branchName: environment.name,
      status: 'failed',
      statusText: '启动失败',
      ports: allocation.ports,
      conflictHandled: allocation.conflict,
      command: 'mvn spring-boot:run',
      cwd: path.join(project.path, moduleConfig.path),
      startedAt: formatTime(new Date()),
      processId: null,
      lastOutput: '未找到 Maven。请安装 Maven 并把 mvn 加入 PATH，或在项目根目录放置 mvnw.cmd。',
      logFilePath,
    };
    upsertRunRecord(record);
    await mkdir(path.dirname(logFilePath), { recursive: true });
    const logStream = createWriteStream(logFilePath, { flags: 'a', encoding: 'utf8' });
    logStream.end(`${record.lastOutput}\n`);
    setUpdated();
    return {
      ok: false,
      module: moduleConfig,
      allocation,
      command: { cwd: record.cwd, command: record.command },
      message: record.lastOutput,
      record: publicRunRecord(record),
    };
  }

  const runtimeOverride = await writeRuntimeEnvironmentConfig(
    project,
    moduleConfig,
    environment,
    portConfig.config,
    allocation.ports,
  );
  const startCommand = buildMavenStartCommand(
    project,
    moduleConfig,
    environment,
    allocation.ports,
    mavenRuntime,
    runtimeOverride,
  );
  const recordId = `${project.id}:${moduleConfig.id}:${environment.code}`;
  const existingManagedProcess = managedProcesses.get(recordId);
  if (existingManagedProcess && !existingManagedProcess.killed) {
    return {
      ok: true,
      module: moduleConfig,
      allocation,
      command: startCommand,
      message: '模块已经在启动或运行中',
      record: publicRunRecord(getRunRecord(recordId)),
    };
  }

  const logFilePath = buildRunLogFilePath(recordId);
  const record = {
    id: recordId,
    projectId: project.id,
    projectName: project.name,
    moduleId: moduleConfig.id,
    moduleName: moduleConfig.name,
    environmentCode: environment.code,
    environmentName: environment.name,
    branch: environment.code,
    branchName: environment.name,
    status: 'starting',
    statusText: '启动中',
    ports: allocation.ports,
    conflictHandled: allocation.conflict,
    command: startCommand.command,
    cwd: startCommand.cwd,
    runtimeConfigPath: startCommand.runtimeConfigPath,
    profile: startCommand.profile,
    moduleCwd: startCommand.moduleCwd,
    startedAt: formatTime(new Date()),
    processId: null,
    lastOutput: '',
    logFilePath,
  };
  upsertRunRecord(record);
  await mkdir(path.dirname(logFilePath), { recursive: true });

  const logStream = createWriteStream(logFilePath, { flags: 'a', encoding: 'utf8' });
  const writeLogText = (text) => {
    logStream.write(text);
  };
  writeLogText([
    `启动时间：${record.startedAt}`,
    `项目：${project.name}`,
    `环境：${environment.name}`,
    `模块：${moduleConfig.name}`,
    `目录：${startCommand.cwd}`,
    ...(startCommand.runtimeConfigPath ? [`运行配置：${startCommand.runtimeConfigPath}`] : []),
    `命令：${startCommand.command}`,
    '',
  ].join('\n'));

  let child = null;
  try {
    child = spawn(startCommand.executable, startCommand.args, {
      cwd: startCommand.cwd,
      detached: false,
      env: {
        ...process.env,
        ...startCommand.environmentVariables,
        JAVA_TOOL_OPTIONS: [process.env.JAVA_TOOL_OPTIONS, '-Dfile.encoding=UTF-8']
          .filter(Boolean)
          .join(' '),
      },
      windowsHide: true,
      shell: false,
    });
  } catch (error) {
    record.status = 'failed';
    record.statusText = '启动失败';
    record.lastOutput = error.message;
    writeLogText(`启动失败：${error.message}\n`);
    logStream.end();
    notifyRunRecordSubscribers(record.id, 'record', { record: publicRunRecord(record) });
    return {
      ok: false,
      module: moduleConfig,
      allocation,
      command: startCommand,
      message: error.message,
      record: publicRunRecord(record),
    };
  }
  record.processId = child.pid;
  managedProcesses.set(record.id, child);
  notifyRunRecordSubscribers(record.id, 'record', { record: publicRunRecord(record) });

  let outputBuffer = '';
  let processLogLineBuffer = Buffer.alloc(0);
  const pushLogText = (text) => {
    if (!text) {
      return;
    }

    outputBuffer = `${outputBuffer}${text}`.slice(-MAX_LOG_PREVIEW_LENGTH);
    record.lastOutput = outputBuffer;
    writeLogText(text);

    const currentRecord = getRunRecord(record.id);
    if (currentRecord) {
      currentRecord.lastOutput = outputBuffer;
      currentRecord.status = record.status;
      currentRecord.statusText = record.statusText;
      currentRecord.processId = record.processId;
    }

    notifyRunRecordSubscribers(record.id, 'log', {
      record: publicRunRecord(getRunRecord(record.id) ?? record),
      text,
    });
  };
  const appendOutput = (chunk) => {
    processLogLineBuffer = Buffer.concat([processLogLineBuffer, chunk]);
    let lineStart = 0;

    for (let index = 0; index < processLogLineBuffer.length; index += 1) {
      const byte = processLogLineBuffer[index];
      if (byte !== 0x0a && byte !== 0x0d) {
        continue;
      }

      if (index > lineStart) {
        pushLogText(decodeProcessLogLine(processLogLineBuffer.subarray(lineStart, index)));
      }

      if (byte === 0x0d && processLogLineBuffer[index + 1] === 0x0a) {
        pushLogText('\r\n');
        index += 1;
      } else {
        pushLogText(byte === 0x0d ? '\r' : '\n');
      }
      lineStart = index + 1;
    }

    processLogLineBuffer = processLogLineBuffer.subarray(lineStart);
  };
  const updateRecordStatus = (status, statusText, extra = {}) => {
    record.status = status;
    record.statusText = statusText;
    const currentRecord = getRunRecord(record.id);
    if (currentRecord) {
      currentRecord.status = status;
      currentRecord.statusText = statusText;
      currentRecord.lastOutput = outputBuffer;
      Object.assign(currentRecord, extra);
    }
    notifyRunRecordSubscribers(record.id, 'record', {
      record: publicRunRecord(getRunRecord(record.id) ?? { ...record, ...extra }),
    });
  };
  child.stdout?.on('data', appendOutput);
  child.stderr?.on('data', appendOutput);
  let statusWatchTimer = null;
  let processCompleted = false;
  const clearStatusWatchTimer = () => {
    if (statusWatchTimer) {
      clearInterval(statusWatchTimer);
      statusWatchTimer = null;
    }
  };
  child.once('error', async (error) => {
    processCompleted = true;
    clearStatusWatchTimer();
    updateRecordStatus('failed', '启动失败');
    pushLogText(`\n启动失败：${error.message}\n`);
    setUpdated();
  });
  child.once('exit', async (code) => {
    processCompleted = true;
    clearStatusWatchTimer();
    if (processLogLineBuffer.length > 0) {
      pushLogText(decodeProcessLogLine(processLogLineBuffer));
      processLogLineBuffer = Buffer.alloc(0);
    }

    managedProcesses.delete(record.id);
    const currentRecord = getRunRecord(record.id);
    if (!currentRecord || currentRecord.status === 'stopped') {
      logStream.end();
      return;
    }

    updateRecordStatus(code === 0 ? 'stopped' : 'failed', code === 0 ? '已停止' : '启动失败', {
      endedAt: formatTime(new Date()),
      exitCode: code,
    });
    writeLogText(`\n进程退出，退出码：${code ?? '未知'}\n`);
    logStream.end();
    setUpdated();
  });

  const listening = await isPortListening(allocation.ports.server);
  if (listening) {
    updateRecordStatus('running', '运行中');
  } else if (!processCompleted && child.exitCode === null && !child.killed) {
    statusWatchTimer = setInterval(async () => {
      const currentRecord = getRunRecord(record.id);
      if (!currentRecord || currentRecord.status !== 'starting') {
        clearStatusWatchTimer();
        return;
      }

      if (await isPortListening(allocation.ports.server)) {
        clearStatusWatchTimer();
        updateRecordStatus('running', '运行中');
        setUpdated();
      }
    }, 1500);
  }

  return {
    ok: true,
    module: moduleConfig,
    allocation,
    command: startCommand,
    record: publicRunRecord(record),
  };
}

async function stopProjectModuleRecords(project, moduleIds, environment) {
  const targetIds = new Set(moduleIds);
  const stoppedRecords = runRecords.filter(
    (record) =>
      record.projectId === project.id &&
      targetIds.has(record.moduleId) &&
      (!environment || record.environmentCode === environment.code),
  );
  const stoppedPayload = stoppedRecords.map((record) =>
    publicRunRecord({
      ...record,
      status: 'stopped',
      statusText: '已停止',
      endedAt: formatTime(new Date()),
    }),
  );

  if (stoppedRecords.length > 0) {
    for (const record of stoppedRecords) {
      const child = managedProcesses.get(record.id);
      const pids = new Set([child?.pid, record.processId].filter(Boolean));
      if (pids.size === 0) {
        const processes = await listSystemJavaProcesses();
        const matchingProcess = findSystemRunRecordProcess(processes, record);
        if (matchingProcess?.processId) {
          pids.add(matchingProcess.processId);
        }
      }

      for (const pid of pids) {
        await killProcessTree(pid);
      }

      const confirmed = await confirmRunRecordStopped(record);
      const stoppedRecord = stoppedPayload.find((item) => item.id === record.id);
      if (!confirmed.stopped) {
        stoppedRecord.status = 'running';
        stoppedRecord.statusText = confirmed.portListening ? '仍在运行' : '关停未确认';
        stoppedRecord.processId = confirmed.matchingProcess?.processId ?? record.processId ?? null;
        Object.assign(record, {
          status: stoppedRecord.status,
          statusText: stoppedRecord.statusText,
          processId: stoppedRecord.processId,
        });
      }

      notifyRunRecordSubscribers(record.id, 'record', { record: stoppedRecord });
      managedProcesses.delete(record.id);
    }

    runRecords = runRecords.filter(
      (record) => {
        const matched =
          record.projectId === project.id &&
          targetIds.has(record.moduleId) &&
          (!environment || record.environmentCode === environment.code);
        if (!matched) {
          return true;
        }

        return stoppedPayload.some(
          (payloadRecord) => payloadRecord.id === record.id && ACTIVE_RUN_STATUSES.has(payloadRecord.status),
        );
      },
    );
  }

  return stoppedPayload;
}

function modulePayload() {
  return {
    modules,
    meta: {
      lastUpdated: formatTime(lastUpdated),
      autoRefresh,
    },
  };
}

function setUpdated() {
  lastUpdated = new Date();
}

async function syncRunRecordsFromSystemProcesses() {
  const activeRecordIds = new Set();
  const processes = await listSystemJavaProcesses();

  for (const project of projects) {
    for (const environment of environments) {
      const projectModules = modules.filter(
        (moduleRecord) => moduleRecord.projectIds.includes(project.id) && !moduleRecord.hasChildren,
      );

      for (const moduleConfig of projectModules) {
        const portConfig = await resolveModuleStartPorts(project, moduleConfig, environment);
        if (!portConfig.serverPort) {
          continue;
        }

        const ports = { server: portConfig.serverPort };
        const recoveredRecord = await recoverModuleRunRecord(processes, project, moduleConfig, environment, ports);
        if (recoveredRecord) {
          activeRecordIds.add(recoveredRecord.id);
        }
      }
    }
  }

  const beforeCount = runRecords.length;
  runRecords = runRecords.filter(
    (record) =>
      !ACTIVE_RUN_STATUSES.has(record.status) ||
      activeRecordIds.has(record.id) ||
      managedProcesses.has(record.id),
  );
  if (runRecords.length !== beforeCount || activeRecordIds.size > 0) {
    setUpdated();
  }
}

function formatTime(date) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  }).format(date);
}

async function resolveProjectLastMessage(projectPath) {
  const latestChat = await getLatestProjectChatMessage(projectPath);
  return latestChat?.message ?? '未找到该项目的 Codex 会话记录';
}

async function refreshProjectChatMessages() {
  const refreshedProjects = [];
  let changed = false;

  for (const project of projects) {
    const lastMessage = await resolveProjectLastMessage(project.path);
    if (project.lastMessage !== lastMessage) {
      changed = true;
    }

    refreshedProjects.push({
      ...project,
      lastMessage,
    });
  }

  projects = refreshedProjects;
  if (changed) {
    await saveProjects(projects);
  }
  await refreshModulesFromProjects();
}

async function listPayload() {
  await syncRunRecordsFromSystemProcesses();
  const savedConfigs = await listSavedEnvironmentConfigs();
  const savedConfigMap = new Map(savedConfigs.map((config) => [config.id, config]));
  const projectPayloads = projects.map((project) => projectPayload(project, savedConfigMap));
  return {
    projects: projectPayloads,
    logicalProjects: buildLogicalProjectsPayload(projectPayloads),
    modules,
    environments,
    branches: environments,
    runRecords: runRecords.map(publicRunRecord),
    meta: {
      lastUpdated: formatTime(lastUpdated),
      autoRefresh,
    },
  };
}

function environmentPayload() {
  return {
    environments,
    meta: {
      lastUpdated: formatTime(lastUpdated),
      autoRefresh,
    },
  };
}

function collectNamespaceValues(content) {
  return String(content ?? '')
    .split(/\r?\n/)
    .filter((line) => /^\s*namespace\s*:/i.test(line))
    .map((line) =>
      line
        .replace(/^\s*namespace\s*:\s*/i, '')
        .replace(/\s*#.*/, '')
        .trim(),
    )
    .filter(Boolean);
}

async function dashboardSummaryPayload() {
  await syncRunRecordsFromSystemProcesses();
  const savedConfigs = await listSavedEnvironmentConfigs();
  const savedConfigMap = new Map(savedConfigs.map((config) => [config.id, config]));
  const projectPayloads = projects.map((project) => projectPayload(project, savedConfigMap));
  const leafModules = modules.filter((moduleRecord) => !moduleRecord.hasChildren);
  const startableModules = leafModules.filter((moduleRecord) => moduleRecord.defaultPort);
  const expectedConfigCount = environments.length * startableModules.length;
  const namespaceCounts = new Map();

  for (const config of savedConfigs) {
    for (const namespaceValue of collectNamespaceValues(config.content)) {
      namespaceCounts.set(namespaceValue, (namespaceCounts.get(namespaceValue) ?? 0) + 1);
    }
  }

  return {
    overview: {
      projectCount: projectPayloads.length,
      readyProjectCount: projectPayloads.filter((project) => project.runtime?.canStart).length,
      runningProjectCount: projectPayloads.filter((project) => project.runtime?.status === 'running').length,
      startingProjectCount: projectPayloads.filter((project) => project.runtime?.status === 'starting').length,
      failedProjectCount: projectPayloads.filter((project) => project.runtime?.status === 'failed').length,
      environmentCount: environments.length,
      moduleCount: leafModules.length,
      startableModuleCount: startableModules.length,
      savedConfigCount: savedConfigs.length,
      expectedConfigCount,
    },
    environmentConfigs: environments.map((environment) => {
      const savedConfigCount = savedConfigs.filter(
        (config) => normalizeEnvironmentCode(config.environmentCode) === environment.code,
      ).length;
      return {
        id: environment.id,
        code: environment.code,
        name: environment.name,
        savedConfigCount,
        expectedConfigCount: startableModules.length,
      };
    }),
    namespaces: Array.from(namespaceCounts.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((first, second) => second.count - first.count || first.value.localeCompare(second.value, 'zh-CN')),
    meta: {
      lastUpdated: formatTime(lastUpdated),
      autoRefresh,
    },
  };
}

async function createEnvironment(payload = {}) {
  const name = normalizeRequiredString(payload.name);
  if (!name) {
    return { error: '环境名称不能为空' };
  }

  const explicitProfile = normalizeEnvironmentProfileFromName(payload.profile ?? '');
  const profile = explicitProfile || normalizeEnvironmentProfileFromName(name);
  const code = createUniqueEnvironmentCode(name);

  const id = code;
  const environment = {
    id,
    name,
    code,
    profile: profile || code,
    accent: 'green',
  };

  environments = [environment, ...environments];
  await saveEnvironments(environments);
  setUpdated();
  return { environment };
}

async function updateModuleSetting(id, payload = {}) {
  const moduleRecord = modules.find((item) => item.id === id);
  if (!moduleRecord) {
    return null;
  }

  const name = normalizeRequiredString(payload.name);
  const defaultPort = Number(payload.defaultPort);
  if (!name || (!moduleRecord.hasChildren && (!Number.isInteger(defaultPort) || defaultPort <= 0))) {
    return { error: '模块名称和默认端口不能为空' };
  }

  const currentSetting = getModuleSetting(id) ?? { id };
  const nextSetting = {
    ...currentSetting,
    id,
    name,
    defaultPort,
    hidden: false,
  };

  moduleSettings = [
    nextSetting,
    ...moduleSettings.filter((setting) => setting.id !== id),
  ];
  await saveModuleSettings(moduleSettings);
  await refreshModulesFromProjects();
  setUpdated();
  return { module: modules.find((item) => item.id === id) };
}

async function deleteModuleSetting(id) {
  const moduleRecord = modules.find((item) => item.id === id);
  if (!moduleRecord) {
    return null;
  }

  const currentSetting = getModuleSetting(id) ?? {
    id,
    name: moduleRecord.name,
    defaultPort: moduleRecord.defaultPort,
    extraPorts: moduleRecord.extraPorts,
  };
  moduleSettings = [
    {
      ...currentSetting,
      id,
      hidden: true,
    },
    ...moduleSettings.filter((setting) => setting.id !== id),
  ];
  runRecords = runRecords.filter((record) => record.moduleId !== id);
  await saveModuleSettings(moduleSettings);
  await refreshModulesFromProjects();
  setUpdated();
  return { modules };
}

async function updateProject(id, updater) {
  const project = getProject(id);
  if (!project) {
    return null;
  }

  await updater(project);
  project.time = formatTime(new Date()).slice(0, 5);
  await saveProjects(projects);
  setUpdated();
  return project;
}

async function createProject(payload = {}) {
  const nextNumber =
    projects.reduce((maxNumber, project) => {
      const numericId = Number(project.id);
      return Number.isFinite(numericId) ? Math.max(maxNumber, numericId) : maxNumber;
    }, 0) + 1;
  const id = String(nextNumber).padStart(2, '0');
  const name = normalizeRequiredString(payload.name);
  const projectPath = normalizeRequiredString(payload.path);
  if (!name || !projectPath) {
    return { error: '项目名称和项目路径不能为空' };
  }

  const defaultEnvironment = environments[0]?.code ?? '';
  const project = {
    id,
    name,
    status: 'stopped',
    time: formatTime(new Date()).slice(0, 5),
    path: projectPath,
    env: defaultEnvironment,
    lastMessage: await resolveProjectLastMessage(projectPath),
    accent: PROJECT_ACCENTS[(nextNumber - 1) % PROJECT_ACCENTS.length],
  };

  projects = [project, ...projects];
  await saveProjects(projects);
  await refreshProjectWorkspaceMeta();
  await refreshModulesFromProjects();
  setUpdated();
  return { project };
}

function normalizeProject(project, index) {
  const runtimeStatus = project.status === 'running' ? 'running' : 'stopped';
  return {
    ...project,
    id: String(project.id ?? index + 1).padStart(2, '0'),
    status: runtimeStatus,
    time: project.time || formatTime(new Date()).slice(0, 5),
    env: project.env ?? environments[0]?.code ?? '',
    lastMessage: project.lastMessage || '未找到该项目的 Codex 会话记录',
    kind: project.kind ?? 'custom',
    accent: project.accent ?? PROJECT_ACCENTS[index % PROJECT_ACCENTS.length],
  };
}

function normalizeEnvironment(environment) {
  const code = environment.code || environment.id;
  return {
    id: environment.id || code,
    code,
    name: environment.name,
    profile: environment.profile ?? normalizeEnvironmentProfile({ ...environment, code }),
    accent: environment.accent ?? 'green',
  };
}

async function reloadConfig() {
  environments = (await loadEnvironments()).map(normalizeEnvironment);
  projects = (await loadProjects()).map(normalizeProject);
  moduleSettings = normalizeModuleSettings(await loadModuleSettings());
  const environmentsChanged = ensureDefaultEnvironments();
  const referencesChanged = normalizeEnvironmentReferences();
  if (environmentsChanged) {
    await saveEnvironments(environments);
  }
  if (referencesChanged) {
    await saveProjects(projects);
  }
  await refreshProjectWorkspaceMeta();
  await refreshModulesFromProjects();
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (!url.pathname.startsWith('/api/')) {
    await serveStaticFile(req, res, url, DIST_DIR);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, ...(await listPayload()).meta, config: getConfigPaths() });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/projects') {
    sendJson(res, 200, await listPayload());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/dashboard-summary') {
    sendJson(res, 200, await dashboardSummaryPayload());
    return;
  }

  const runLogStreamMatch = url.pathname.match(/^\/api\/run-records\/([^/]+)\/logs\/stream$/);
  if (runLogStreamMatch && req.method === 'GET') {
    await streamRunRecordLogs(decodeRouteParam(runLogStreamMatch[1]), req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/system/pick-path') {
    const payload = await readJson(req);
    const type = payload.type === 'file' ? 'file' : 'folder';
    const selectedPath = await pickLocalPath(type);
    sendJson(res, 200, { path: selectedPath || '' });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/projects') {
    const payload = await readJson(req);
    const result = await createProject(payload);
    if (result.error) {
      sendJson(res, 400, { message: result.error });
      return;
    }

    const { project } = result;
    const responsePayload = await listPayload();
    sendJson(res, 201, {
      ...responsePayload,
      project: responsePayload.projects.find((item) => item.id === project.id),
    });
    return;
  }

  const projectDeleteMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectDeleteMatch && req.method === 'PUT') {
    const id = projectDeleteMatch[1];
    const payload = await readJson(req);
    const name = normalizeRequiredString(payload.name);
    const projectPath = normalizeRequiredString(payload.path);

    if (!name || !projectPath) {
      sendJson(res, 400, { message: '项目名称和项目路径不能为空' });
      return;
    }

    const project = await updateProject(id, async (item) => {
      item.name = name;
      item.path = projectPath;
      item.lastMessage = await resolveProjectLastMessage(projectPath);
    });

    if (!project) {
      sendJson(res, 404, { message: '项目不存在' });
      return;
    }

    await refreshProjectWorkspaceMeta();
    await refreshModulesFromProjects();
    const responsePayload = await listPayload();
    sendJson(res, 200, {
      ...responsePayload,
      project: responsePayload.projects.find((item) => item.id === project.id),
    });
    return;
  }

  if (projectDeleteMatch && req.method === 'DELETE') {
    const id = projectDeleteMatch[1];
    const project = getProject(id);

    if (!project) {
      sendJson(res, 404, { message: '项目不存在' });
      return;
    }

    projects = projects.filter((item) => item.id !== id);
    runRecords = runRecords.filter((record) => record.projectId !== id);
    await saveProjects(projects);
    await refreshProjectWorkspaceMeta();
    await refreshModulesFromProjects();
    setUpdated();
    sendJson(res, 200, await listPayload());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/environments') {
    sendJson(res, 200, environmentPayload());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/environment-config') {
    const configArgs = [
      url.searchParams.get('projectId') ?? '',
      url.searchParams.get('moduleId') ?? '',
      url.searchParams.get('environmentCode') ?? '',
    ];
    const result =
      url.searchParams.get('source') === 'default'
        ? await getDefaultEnvironmentConfig(...configArgs)
        : await getEnvironmentConfig(...configArgs);

    if (result.error) {
      sendJson(res, result.statusCode ?? 400, { message: result.error });
      return;
    }

    sendJson(res, 200, result);
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/environment-config') {
    const payload = await readJson(req);
    const result = await saveEnvironmentConfig(payload);

    if (result.error) {
      sendJson(res, result.statusCode ?? 400, { message: result.error });
      return;
    }

    sendJson(res, 200, result);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/modules') {
    sendJson(res, 200, modulePayload());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/modules/refresh') {
    await reloadConfig();
    setUpdated();
    sendJson(res, 200, modulePayload());
    return;
  }

  const moduleManageMatch = url.pathname.match(/^\/api\/modules\/([^/]+)$/);
  if (moduleManageMatch && req.method === 'PUT') {
    const id = decodeRouteParam(moduleManageMatch[1]);
    const payload = await readJson(req);
    const result = await updateModuleSetting(id, payload);

    if (!result) {
      sendJson(res, 404, { message: '模块不存在' });
      return;
    }

    if (result.error) {
      sendJson(res, 400, { message: result.error });
      return;
    }

    sendJson(res, 200, { module: result.module, ...modulePayload() });
    return;
  }

  if (moduleManageMatch && req.method === 'DELETE') {
    const id = decodeRouteParam(moduleManageMatch[1]);
    const result = await deleteModuleSetting(id);

    if (!result) {
      sendJson(res, 404, { message: '模块不存在' });
      return;
    }

    sendJson(res, 200, modulePayload());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/environments') {
    const payload = await readJson(req);
    const result = await createEnvironment(payload);
    if (result.error) {
      sendJson(res, 400, { message: result.error });
      return;
    }

    const { environment } = result;
    sendJson(res, 201, { environment, ...environmentPayload() });
    return;
  }

  const environmentDeleteMatch = url.pathname.match(/^\/api\/environments\/([^/]+)$/);
  if (environmentDeleteMatch && req.method === 'PUT') {
    const id = decodeRouteParam(environmentDeleteMatch[1]);
    const payload = await readJson(req);
    const environment = getEnvironment(id);

    if (!environment) {
      sendJson(res, 404, { message: '环境不存在' });
      return;
    }

    const name = normalizeRequiredString(payload.name);
    if (!name) {
      sendJson(res, 400, { message: '环境名称不能为空' });
      return;
    }

    environment.name = name;
    environment.accent = environment.accent ?? 'green';

    await saveEnvironments(environments);
    setUpdated();
    sendJson(res, 200, { environment, ...environmentPayload() });
    return;
  }

  if (environmentDeleteMatch && req.method === 'DELETE') {
    const id = decodeRouteParam(environmentDeleteMatch[1]);
    const environment = environments.find((item) => item.id === id);

    if (!environment) {
      sendJson(res, 404, { message: '环境不存在' });
      return;
    }

    environments = environments.filter((item) => item.id !== id);
    const fallbackEnv = environments[0]?.code ?? '';
    projects = projects.map((project) =>
      project.env === environment.code ? { ...project, env: fallbackEnv } : project,
    );
    await saveEnvironments(environments);
    await saveProjects(projects);
    setUpdated();
    sendJson(res, 200, environmentPayload());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/projects/refresh') {
    await reloadConfig();
    await refreshProjectChatMessages();
    setUpdated();
    sendJson(res, 200, await listPayload());
    return;
  }

  const batchModuleStartMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/modules\/start$/);
  if (batchModuleStartMatch && req.method === 'POST') {
    const id = decodeRouteParam(batchModuleStartMatch[1]);
    const project = getProject(id);
    const payload = await readJson(req);
    const { targets, missingCodes } = resolvePayloadModuleTargets(payload, {
      fallbackToFirst: true,
    });
    const targetEnvironments = Array.from(
      new Map(targets.map((target) => [target.environment.code, target.environment])).values(),
    );

    if (!project) {
      sendJson(res, 404, { message: '项目不存在' });
      return;
    }

    if (targets.length === 0) {
      sendJson(res, 400, { message: '请至少选择一个模块' });
      return;
    }

    if (targetEnvironments.length === 0) {
      sendJson(res, 400, { message: '环境不存在' });
      return;
    }

    if (missingCodes.length > 0) {
      sendJson(res, 400, { message: `环境不存在：${missingCodes.join('、')}` });
      return;
    }

    if (targetEnvironments.length > 1) {
      sendJson(res, 400, { message: '同一个项目一次只能选择一个环境启动' });
      return;
    }

    const environmentConflict = buildProjectEnvironmentConflict(project.id, targetEnvironments[0].code);
    if (environmentConflict) {
      sendJson(res, 409, {
        message: environmentConflict.message,
        activeEnvironment: environmentConflict.activeEnvironment,
        requestedEnvironment: environmentConflict.requestedEnvironment,
      });
      return;
    }

    const results = [];
    for (const { moduleId, environment } of targets) {
      const moduleConfig = findProjectModule(project.id, moduleId);
      if (!moduleConfig) {
        results.push({ ok: false, moduleId, environment, message: '模块不存在' });
        continue;
      }

      const result = await startProjectModuleRecord(project, moduleConfig, environment);
      results.push({
        ...result,
        environment,
      });
    }

    if (results.some((result) => result.ok)) {
      setUpdated();
    }

    const responsePayload = await listPayload();
    sendJson(res, 200, {
      projects: responsePayload.projects,
      logicalProjects: responsePayload.logicalProjects,
      project: responsePayload.projects.find((item) => item.id === project.id),
      environment: targetEnvironments[0],
      environments: targetEnvironments,
      results,
      runRecords: getProjectRunRecords(project.id),
      meta: responsePayload.meta,
    });
    return;
  }

  const batchModuleStopMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/modules\/stop$/);
  if (batchModuleStopMatch && req.method === 'POST') {
    const id = decodeRouteParam(batchModuleStopMatch[1]);
    const project = getProject(id);
    const payload = await readJson(req);
    const { targets, moduleIds = [], environments: targetEnvironments = [], missingCodes, usesExplicitTargets } =
      resolvePayloadModuleTargets(payload);

    if (!project) {
      sendJson(res, 404, { message: '项目不存在' });
      return;
    }

    if (targets.length === 0 && moduleIds.length === 0) {
      sendJson(res, 400, { message: '请至少选择一个模块' });
      return;
    }

    if (missingCodes.length > 0) {
      sendJson(res, 400, { message: `环境不存在：${missingCodes.join('、')}` });
      return;
    }

    const stoppedRecords = (
      await Promise.all(
        usesExplicitTargets
          ? targets.map(({ moduleId, environment }) =>
              stopProjectModuleRecords(project, [moduleId], environment),
            )
          : (targetEnvironments.length > 0 ? targetEnvironments : [null]).map((environment) =>
              stopProjectModuleRecords(project, moduleIds, environment),
            ),
      )
    ).flat();
    if (stoppedRecords.length > 0) {
      setUpdated();
    }

    const responsePayload = await listPayload();
    sendJson(res, 200, {
      projects: responsePayload.projects,
      logicalProjects: responsePayload.logicalProjects,
      project: responsePayload.projects.find((item) => item.id === project.id),
      environment: targetEnvironments[0] ?? null,
      environments: targetEnvironments,
      stoppedRecords,
      runRecords: getProjectRunRecords(project.id),
      meta: responsePayload.meta,
    });
    return;
  }

  const moduleStartMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/modules\/([^/]+)\/start$/);
  if (moduleStartMatch && req.method === 'POST') {
    const id = decodeRouteParam(moduleStartMatch[1]);
    const moduleId = decodeRouteParam(moduleStartMatch[2]);
    const project = getProject(id);
    const moduleConfig = findProjectModule(id, moduleId);
    const payload = await readJson(req);
    const environment = getEnvironmentByCode(payload.branch) ?? environments[0];

    if (!project) {
      sendJson(res, 404, { message: '项目不存在' });
      return;
    }

    if (!moduleConfig) {
      sendJson(res, 404, { message: '模块不存在' });
      return;
    }

    if (!environment) {
      sendJson(res, 400, { message: '未配置任何环境' });
      return;
    }

    const environmentConflict = buildProjectEnvironmentConflict(project.id, environment.code);
    if (environmentConflict) {
      sendJson(res, 409, {
        message: environmentConflict.message,
        activeEnvironment: environmentConflict.activeEnvironment,
        requestedEnvironment: environmentConflict.requestedEnvironment,
      });
      return;
    }

    const result = await startProjectModuleRecord(project, moduleConfig, environment);
    setUpdated();

    const responsePayload = await listPayload();
    sendJson(res, 200, {
      projects: responsePayload.projects,
      logicalProjects: responsePayload.logicalProjects,
      project: responsePayload.projects.find((item) => item.id === project.id),
      module: moduleConfig,
      environment,
      allocation: result.allocation,
      command: result.command,
      runRecords: getProjectRunRecords(project.id),
      meta: responsePayload.meta,
    });
    return;
  }

  const actionMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/(start|stop|env)$/);
  if (!actionMatch || req.method !== 'POST') {
    sendJson(res, 404, { message: '接口不存在' });
    return;
  }

  const [, id, action] = actionMatch;

  try {
    if (action === 'start') {
      const project = await updateProject(id, (item) => {
        item.status = 'running';
        item.alert = false;
      });

      if (!project) {
        sendJson(res, 404, { message: '项目不存在' });
        return;
      }

      sendJson(res, 200, { project: projectPayload(project), meta: (await listPayload()).meta });
      return;
    }

    if (action === 'stop') {
      const project = await updateProject(id, (item) => {
        item.status = 'stopped';
      });

      if (!project) {
        sendJson(res, 404, { message: '项目不存在' });
        return;
      }

      sendJson(res, 200, { project: projectPayload(project), meta: (await listPayload()).meta });
      return;
    }

    const payload = await readJson(req);
    if (!environments.some((environment) => environment.code === payload.env)) {
      sendJson(res, 400, { message: '环境不存在' });
      return;
    }

    const project = await updateProject(id, (item) => {
      item.env = payload.env;
    });

    if (!project) {
      sendJson(res, 404, { message: '项目不存在' });
      return;
    }

    sendJson(res, 200, { project: projectPayload(project), meta: (await listPayload()).meta });
  } catch (error) {
    sendJson(res, 400, { message: '请求体不是合法 JSON' });
  }
}

async function bootstrap() {
  await initStore();
  await reloadConfig();
  await refreshProjectChatMessages();
  await saveEnvironments(environments);
  await saveProjects(projects);

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      sendJson(res, error.statusCode ?? 500, { message: error.message || '服务异常' });
    });
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Project Env Launcher listening on http://127.0.0.1:${PORT}`);
    console.log(`Data directory: ${getConfigPaths().dataDir}`);
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
