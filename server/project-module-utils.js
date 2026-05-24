import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileExists } from './filesystem-utils.js';
import { parsePortValue } from './environment-config-utils.js';

function normalizeRequiredString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stripXmlComments(content) {
  return content.replace(/<!--[\s\S]*?-->/g, '');
}

export function readModuleEntries(pomContent) {
  const moduleBlockMatch = stripXmlComments(pomContent).match(/<modules\b[^>]*>([\s\S]*?)<\/modules>/i);
  if (!moduleBlockMatch) {
    return [];
  }

  return Array.from(moduleBlockMatch[1].matchAll(/<module\b[^>]*>([\s\S]*?)<\/module>/gi))
    .map((match) => match[1].trim())
    .filter(Boolean);
}

export function readPomArtifactId(pomContent) {
  const cleanContent = stripXmlComments(pomContent);
  const projectContent = cleanContent.match(/<project\b[^>]*>([\s\S]*?)<\/project>/i)?.[1] ?? cleanContent;
  const parentStart = projectContent.search(/<parent\b[^>]*>/i);
  const parentEnd = projectContent.search(/<\/parent>/i);
  const contentWithoutParent =
    parentStart >= 0 && parentEnd > parentStart
      ? `${projectContent.slice(0, parentStart)}${projectContent.slice(parentEnd + '</parent>'.length)}`
      : projectContent;

  return normalizeRequiredString(contentWithoutParent.match(/<artifactId\b[^>]*>([\s\S]*?)<\/artifactId>/i)?.[1]);
}

function normalizeProfileList(profiles = []) {
  return Array.from(
    new Set(
      profiles
        .map((profile) => normalizeRequiredString(profile).toLowerCase())
        .filter(Boolean),
    ),
  );
}

function buildConfigFileNames(profiles = []) {
  const names = ['application.yml', 'application.yaml', 'application.properties'];
  for (const profile of normalizeProfileList(profiles)) {
    names.push(
      `application-${profile}.yml`,
      `application-${profile}.yaml`,
      `application-${profile}.properties`,
    );
  }

  return names;
}

function parsePropertiesPort(content, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`^\\s*${escapedKey}\\s*=\\s*([^#\\r\\n]+)`, 'm'));
  return match ? parsePortValue(match[1]) : null;
}

function parseYamlScalarPort(content, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`^\\s*${escapedKey}\\s*:\\s*([^#\\r\\n]+)`, 'm'));
  return match ? parsePortValue(match[1]) : null;
}

function parsePropertiesServerPort(content) {
  return parsePropertiesPort(content, 'server.port');
}

function parseYamlServerPort(content) {
  const directMatch = content.match(/^\s*server\.port\s*:\s*([^#\r\n]+)\s*$/m);
  if (directMatch) {
    return parsePortValue(directMatch[1]);
  }

  const lines = content.split(/\r?\n/);
  let serverIndent = null;
  for (const rawLine of lines) {
    const lineWithoutComment = rawLine.replace(/\s+#.*$/, '');
    if (!lineWithoutComment.trim()) {
      continue;
    }

    const indent = lineWithoutComment.match(/^\s*/)?.[0].length ?? 0;
    if (serverIndent === null) {
      if (/^\s*server\s*:\s*$/.test(lineWithoutComment)) {
        serverIndent = indent;
      }
      continue;
    }

    if (indent <= serverIndent) {
      serverIndent = null;
      if (/^\s*server\s*:\s*$/.test(lineWithoutComment)) {
        serverIndent = indent;
      }
      continue;
    }

    const portMatch = lineWithoutComment.match(/^\s*port\s*:\s*([^#\r\n]+)\s*$/);
    if (portMatch) {
      return parsePortValue(portMatch[1]);
    }
  }

  return null;
}

export async function readModuleConfigPort(modulePath, profiles = []) {
  const resourcePath = path.join(modulePath, 'src', 'main', 'resources');
  const configFiles = buildConfigFileNames(profiles);

  for (const configFile of configFiles) {
    const configPath = path.join(resourcePath, configFile);
    if (!(await fileExists(configPath))) {
      continue;
    }

    const content = await readFile(configPath, 'utf8');
    const detectedPort = configFile.endsWith('.properties')
      ? parsePropertiesServerPort(content)
      : parseYamlServerPort(content);
    if (detectedPort) {
      return detectedPort;
    }
  }

  return null;
}

function parseYamlPathPort(content, keyPath) {
  const lines = content.split(/\r?\n/);
  const stack = [];

  for (const rawLine of lines) {
    const lineWithoutComment = rawLine.replace(/\s+#.*$/, '');
    if (!lineWithoutComment.trim()) {
      continue;
    }

    const match = lineWithoutComment.match(/^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*?)\s*$/);
    if (!match) {
      continue;
    }

    const indent = match[1].length;
    const key = match[2];
    const value = match[3];
    while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const currentPath = [...stack.map((item) => item.key), key];
    if (currentPath.join('.') === keyPath) {
      return parsePortValue(value);
    }

    if (!value) {
      stack.push({ indent, key });
    }
  }

  return null;
}

function parseConfigPort(content, configFile, key) {
  if (configFile.endsWith('.properties')) {
    return parsePropertiesPort(content, key);
  }

  return parseYamlScalarPort(content, key) ?? parseYamlPathPort(content, key);
}

function getConfiguredExtraPortKeys() {
  return String(process.env.CODEX_MONITOR_EXTRA_PORT_KEYS ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

export async function readModuleExtraPorts(modulePath, profiles = []) {
  const resourcePath = path.join(modulePath, 'src', 'main', 'resources');
  const configFiles = buildConfigFileNames(profiles);
  const extraPortKeys = getConfiguredExtraPortKeys();
  const ports = new Map();

  for (const configFile of configFiles) {
    const configPath = path.join(resourcePath, configFile);
    if (!(await fileExists(configPath))) {
      continue;
    }

    const content = await readFile(configPath, 'utf8');
    for (const key of extraPortKeys) {
      if (ports.has(key)) {
        continue;
      }

      const defaultPort = parseConfigPort(content, configFile, key);
      if (defaultPort) {
        ports.set(key, { key, defaultPort });
      }
    }
  }

  return Array.from(ports.values());
}
