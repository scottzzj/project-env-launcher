import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  collectRuntimeEnvironmentJson,
  collectSafeRuntimeArguments,
} from './environment-config-utils.js';
import { fileExists } from './filesystem-utils.js';
import { execFileText } from './system-utils.js';

let cachedWindowsEnvironment = null;

const DEFAULT_MAVEN_LOCAL_REPOSITORIES = [
  process.env.CODEX_MONITOR_MAVEN_REPO,
  process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.m2', 'repository') : '',
].filter(Boolean);

function normalizeComparablePath(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }

  const resolvedPath = path.resolve(value.trim());
  const normalizedPath = resolvedPath.replace(/[\\/]+/g, path.sep).replace(/[\\/]$/, '');
  return process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
}

async function collectFilesByName(rootPath, fileName, limit = 8) {
  const matches = [];

  async function visit(currentPath, depth) {
    if (matches.length >= limit || depth < 0 || !(await fileExists(currentPath))) {
      return;
    }

    let entries = [];
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
        matches.push(entryPath);
        if (matches.length >= limit) {
          return;
        }
      }
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      await visit(path.join(currentPath, entry.name), depth - 1);
      if (matches.length >= limit) {
        return;
      }
    }
  }

  await visit(rootPath, 5);
  return matches;
}

function parseWindowsEnvironmentRows(output) {
  const env = {};

  String(output ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .forEach((line) => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (!match) {
        return;
      }

      env[match[1]] = match[2];
    });

  return env;
}

async function getWindowsRegistryEnvironment() {
  if (process.platform !== 'win32') {
    return {};
  }

  if (cachedWindowsEnvironment) {
    return cachedWindowsEnvironment;
  }

  const script = [
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;',
    '$keys = @(',
    '  "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",',
    '  "HKCU:\\Environment"',
    ');',
    '$values = @{};',
    'foreach ($key in $keys) {',
    '  if (Test-Path $key) {',
    '    $item = Get-ItemProperty -Path $key;',
    '    foreach ($name in @("Path", "MAVEN_HOME", "M2_HOME", "JAVA_HOME")) {',
    '      if ($item.PSObject.Properties.Name -contains $name -and $item.$name) {',
    '        if ($name -eq "Path" -and $values.ContainsKey($name)) {',
    '          $values[$name] = "$($values[$name]);$($item.$name)";',
    '        } else {',
    '          $values[$name] = [string]$item.$name;',
    '        }',
    '      }',
    '    }',
    '  }',
    '}',
    'foreach ($entry in $values.GetEnumerator()) {',
    '  $expanded = [Environment]::ExpandEnvironmentVariables($entry.Value);',
    '  Write-Output "$($entry.Key)=$expanded";',
    '}',
  ].join(' ');
  const result = await execFileText('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    timeout: 10000,
  });

  cachedWindowsEnvironment = result.ok ? parseWindowsEnvironmentRows(result.stdout) : {};
  return cachedWindowsEnvironment;
}

function splitPathEntries(pathValue) {
  return String(pathValue ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function findFallbackMavenExecutables() {
  const executableName = process.platform === 'win32' ? 'mvn.cmd' : 'mvn';
  const registryEnv = await getWindowsRegistryEnvironment();
  const candidateRoots = [
    process.env.MAVEN_HOME ? path.join(process.env.MAVEN_HOME, 'bin') : '',
    process.env.M2_HOME ? path.join(process.env.M2_HOME, 'bin') : '',
    registryEnv.MAVEN_HOME ? path.join(registryEnv.MAVEN_HOME, 'bin') : '',
    registryEnv.M2_HOME ? path.join(registryEnv.M2_HOME, 'bin') : '',
    ...splitPathEntries(registryEnv.Path),
  ].filter(Boolean);
  const foundPaths = [];
  const seenPaths = new Set();

  for (const rootPath of candidateRoots) {
    const directPath = path.join(rootPath, executableName);
    if (await fileExists(directPath)) {
      const normalizedPath = normalizeComparablePath(directPath);
      if (!seenPaths.has(normalizedPath)) {
        seenPaths.add(normalizedPath);
        foundPaths.push(directPath);
      }
      continue;
    }

    // Maven installed by IDEs or wrapper downloads is often nested under these roots.
    const discoveredPaths = await collectFilesByName(rootPath, executableName, 4);
    for (const discoveredPath of discoveredPaths) {
      const normalizedPath = normalizeComparablePath(discoveredPath);
      if (!seenPaths.has(normalizedPath)) {
        seenPaths.add(normalizedPath);
        foundPaths.push(discoveredPath);
      }
    }
  }

  return foundPaths.sort((first, second) => {
    const firstIsWrapper = first.includes(`${path.sep}.m2${path.sep}wrapper${path.sep}`);
    const secondIsWrapper = second.includes(`${path.sep}.m2${path.sep}wrapper${path.sep}`);
    if (firstIsWrapper !== secondIsWrapper) {
      return firstIsWrapper ? -1 : 1;
    }
    return first.localeCompare(second, 'zh-CN');
  });
}

function getMavenHomeFromExecutable(commandName) {
  if (!commandName || !path.isAbsolute(commandName)) {
    return '';
  }

  const executableDir = path.dirname(commandName);
  return path.basename(executableDir).toLowerCase() === 'bin'
    ? path.dirname(executableDir)
    : '';
}

async function resolveMavenLocalRepository(commandName) {
  const mavenHome = getMavenHomeFromExecutable(commandName);
  const registryEnv = await getWindowsRegistryEnvironment();
  const candidates = [
    process.env.CODEX_MONITOR_MAVEN_REPO,
    mavenHome ? path.join(mavenHome, 'repo') : '',
    mavenHome ? path.join(mavenHome, 'repository') : '',
    registryEnv.MAVEN_HOME ? path.join(registryEnv.MAVEN_HOME, 'repo') : '',
    registryEnv.MAVEN_HOME ? path.join(registryEnv.MAVEN_HOME, 'repository') : '',
    registryEnv.M2_HOME ? path.join(registryEnv.M2_HOME, 'repo') : '',
    registryEnv.M2_HOME ? path.join(registryEnv.M2_HOME, 'repository') : '',
    ...DEFAULT_MAVEN_LOCAL_REPOSITORIES,
  ].filter(Boolean);
  const seenPaths = new Set();

  for (const candidatePath of candidates) {
    const normalizedPath = normalizeComparablePath(candidatePath);
    if (!normalizedPath || seenPaths.has(normalizedPath)) {
      continue;
    }
    seenPaths.add(normalizedPath);
    if (await fileExists(candidatePath)) {
      return candidatePath;
    }
  }

  return '';
}

async function findMavenProjectRoot(moduleCwd) {
  let currentPath = moduleCwd;
  for (let depth = 0; depth < 6; depth += 1) {
    const pomPath = path.join(currentPath, 'pom.xml');
    if (await fileExists(pomPath)) {
      try {
        const pomContent = await readFile(pomPath, 'utf8');
        if (/<packaging>\s*pom\s*<\/packaging>/i.test(pomContent) && /<modules>/i.test(pomContent)) {
          return currentPath;
        }
      } catch {
        return moduleCwd;
      }
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }
    currentPath = parentPath;
  }

  return moduleCwd;
}

export async function resolveMavenRuntime(project, moduleConfig) {
  const moduleCwd = path.join(project.path, moduleConfig.path);
  const workspaceRoot = path.resolve(project.path);
  const projectRoot = await findMavenProjectRoot(moduleCwd);
  const commandRoot = await fileExists(path.join(workspaceRoot, 'pom.xml')) ? workspaceRoot : projectRoot;
  const relativeModulePath = path.relative(projectRoot, moduleCwd).replace(/[\\/]+/g, '/');
  const commandModuleSelector = path.relative(commandRoot, moduleCwd).replace(/[\\/]+/g, '/');
  const moduleSelector = normalizeComparablePath(projectRoot) === normalizeComparablePath(moduleCwd)
    ? ''
    : relativeModulePath;
  const wrapperName = process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw';
  const wrapperPaths = [
    path.join(moduleCwd, wrapperName),
    path.join(project.path, wrapperName),
  ];

  for (const wrapperPath of wrapperPaths) {
    if (await fileExists(wrapperPath)) {
      return {
        cwd: moduleCwd,
        projectRoot,
        commandRoot,
        moduleSelector,
        commandModuleSelector,
        commandName: wrapperPath,
        displayName: wrapperPath,
        localRepository: await resolveMavenLocalRepository(wrapperPath),
      };
    }
  }

  const lookupResult = process.platform === 'win32'
    ? await execFileText('where.exe', ['mvn.cmd'], {
        env: {
          ...process.env,
          Path: [
            process.env.Path,
            (await getWindowsRegistryEnvironment()).Path,
          ].filter(Boolean).join(path.delimiter),
        },
      })
    : await execFileText('which', ['mvn']);
  if (lookupResult.ok) {
    const commandName = lookupResult.stdout.split(/\r?\n/)[0] || (process.platform === 'win32' ? 'mvn.cmd' : 'mvn');
    return {
      cwd: moduleCwd,
      projectRoot,
      commandRoot,
      moduleSelector,
      commandModuleSelector,
      commandName,
      displayName: commandName,
      localRepository: await resolveMavenLocalRepository(commandName),
    };
  }

  for (const fallbackPath of await findFallbackMavenExecutables()) {
    return {
      cwd: moduleCwd,
      projectRoot,
      commandRoot,
      moduleSelector,
      commandModuleSelector,
      commandName: fallbackPath,
      displayName: fallbackPath,
      localRepository: await resolveMavenLocalRepository(fallbackPath),
    };
  }

  return null;
}

function formatCommandArg(value) {
  const text = String(value);
  return /\s/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
}

export function buildMavenStartCommand(project, moduleConfig, environment, ports, mavenRuntime, runtimeOverride = null) {
  const profile = environment.profile ?? environment.code;
  const commandRoot = mavenRuntime.commandRoot ?? mavenRuntime.projectRoot ?? mavenRuntime.cwd;
  const commandModuleSelector =
    mavenRuntime.commandModuleSelector ||
    path.relative(commandRoot, mavenRuntime.cwd).replace(/[\\/]+/g, '/');
  const springBootArguments = [
    ...collectSafeRuntimeArguments(ports, runtimeOverride),
    ...Object.entries(ports)
      .filter(([key]) => key !== 'server')
      .map(([key, value]) => `--${key}=${value}`),
  ];
  const springApplicationJson = JSON.stringify(collectRuntimeEnvironmentJson(runtimeOverride?.content ?? '', ports));
  const baseMavenArgs = [
    '-ntp',
    '-DskipTests',
    '-Dmaven.test.skip=true',
    mavenRuntime.localRepository ? `-Dmaven.repo.local=${mavenRuntime.localRepository}` : '',
  ].filter(Boolean);
  const dependencyBuildArgs = commandModuleSelector ? ['-pl', commandModuleSelector, '-am', 'install'] : [];
  const launchArgs = [
    commandModuleSelector ? `-f=${path.join(mavenRuntime.cwd, 'pom.xml')}` : '',
    'spring-boot:run',
    `-Dspring-boot.run.profiles=${profile}`,
    `-Dspring-boot.run.arguments=${springBootArguments.join(' ')}`,
  ].filter(Boolean);
  const mavenArgs = [
    ...baseMavenArgs,
    ...dependencyBuildArgs,
    ...(dependencyBuildArgs.length ? ['&&', mavenRuntime.commandName] : []),
    ...baseMavenArgs,
    ...launchArgs,
  ].filter(Boolean);

  return {
    cwd: commandRoot,
    moduleCwd: mavenRuntime.cwd,
    executable: process.platform === 'win32' ? 'cmd.exe' : mavenRuntime.commandName,
    args: process.platform === 'win32'
      ? ['/d', '/c', 'call', mavenRuntime.commandName, ...mavenArgs]
      : mavenArgs,
    command: `${mavenRuntime.displayName} ${mavenArgs.map(formatCommandArg).join(' ')}`,
    localRepository: mavenRuntime.localRepository,
    profile,
    runtimeConfigPath: runtimeOverride?.filePath ?? '',
    environmentVariables: {
      SPRING_APPLICATION_JSON: springApplicationJson,
    },
  };
}
