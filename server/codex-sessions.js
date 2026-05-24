import { open, readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SESSION_FILE_PREFIX = 'rollout-';
const SESSION_FILE_SUFFIX = '.jsonl';
const HEADER_READ_CHUNK = 64 * 1024;
const HEADER_READ_LIMIT = 1024 * 1024;
const MESSAGE_PREVIEW_LIMIT = 180;
const headerCache = new Map();
const messageCache = new Map();

function getCodexHome() {
  return process.env.CODEX_HOME
    ? path.resolve(process.env.CODEX_HOME)
    : path.join(os.homedir(), '.codex');
}

function normalizeComparablePath(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }

  const resolvedPath = path.resolve(value.trim());
  const normalizedPath = resolvedPath.replace(/[\\/]+/g, path.sep).replace(/[\\/]$/, '');
  return process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
}

function isSameOrChildPath(candidate, parent) {
  return candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
}

function getPathScore(sessionCwd, projectPath) {
  const normalizedCwd = normalizeComparablePath(sessionCwd);
  const normalizedProjectPath = normalizeComparablePath(projectPath);

  if (!normalizedCwd || !normalizedProjectPath) {
    return 0;
  }

  if (normalizedCwd === normalizedProjectPath) {
    return 3;
  }

  if (isSameOrChildPath(normalizedCwd, normalizedProjectPath)) {
    return 2;
  }

  if (isSameOrChildPath(normalizedProjectPath, normalizedCwd)) {
    return 1;
  }

  return 0;
}

async function listSessionFiles(rootDir) {
  const entries = [];

  async function walk(currentDir) {
    let dirEntries = [];
    try {
      dirEntries = await readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        return;
      }
      throw error;
    }

    await Promise.all(
      dirEntries.map(async (entry) => {
        const entryPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await walk(entryPath);
          return;
        }

        if (!entry.isFile() || !entry.name.startsWith(SESSION_FILE_PREFIX) || !entry.name.endsWith(SESSION_FILE_SUFFIX)) {
          return;
        }

        const fileStat = await stat(entryPath);
        entries.push({
          filePath: entryPath,
          mtimeMs: fileStat.mtimeMs,
          size: fileStat.size,
        });
      }),
    );
  }

  await walk(rootDir);
  return entries;
}

async function readFirstLine(filePath) {
  const handle = await open(filePath, 'r');
  const chunks = [];
  let totalBytes = 0;

  try {
    while (totalBytes < HEADER_READ_LIMIT) {
      const buffer = Buffer.alloc(HEADER_READ_CHUNK);
      const { bytesRead } = await handle.read(buffer, 0, HEADER_READ_CHUNK, totalBytes);
      if (bytesRead === 0) {
        break;
      }

      totalBytes += bytesRead;
      chunks.push(buffer.subarray(0, bytesRead));
      const content = Buffer.concat(chunks).toString('utf8');
      const newlineIndex = content.indexOf('\n');
      if (newlineIndex >= 0) {
        return content.slice(0, newlineIndex).trim();
      }
    }

    return Buffer.concat(chunks).toString('utf8').trim();
  } finally {
    await handle.close();
  }
}

async function readSessionHeader(file) {
  const cacheKey = `${file.filePath}:${file.mtimeMs}:${file.size}`;
  const cachedHeader = headerCache.get(cacheKey);
  if (cachedHeader) {
    return cachedHeader;
  }

  let header = null;
  try {
    const firstLine = await readFirstLine(file.filePath);
    const row = firstLine ? JSON.parse(firstLine) : null;
    if (row?.type === 'session_meta') {
      header = {
        filePath: file.filePath,
        mtimeMs: file.mtimeMs,
        size: file.size,
        id: row.payload?.id ?? '',
        cwd: row.payload?.cwd ?? '',
        timestamp: row.payload?.timestamp ?? row.timestamp ?? '',
        threadSource: row.payload?.thread_source ?? 'user',
      };
    }
  } catch {
    header = null;
  }

  headerCache.set(cacheKey, header);
  return header;
}

function extractText(value) {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(extractText).filter(Boolean).join('\n');
  }

  if (typeof value !== 'object') {
    return '';
  }

  if (typeof value.text === 'string') {
    return value.text;
  }

  if (typeof value.input_text === 'string') {
    return value.input_text;
  }

  if (typeof value.output_text === 'string') {
    return value.output_text;
  }

  if (typeof value.content === 'string') {
    return value.content;
  }

  if (Array.isArray(value.content)) {
    return extractText(value.content);
  }

  return '';
}

function stripHiddenContext(text) {
  return text
    .replace(/^# Files mentioned by the user:[\s\S]*?## My request for Codex:\s*/i, '')
    .replace(/^# AGENTS\.md instructions for [\s\S]*?<\/INSTRUCTIONS>\s*/i, '')
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, '')
    .replace(/<subagent_notification>[\s\S]*?<\/subagent_notification>/gi, '')
    .replace(/^Another language model started to solve this problem[\s\S]*$/i, '')
    .replace(/^## My request for Codex:\s*/i, '');
}

function compactMessage(text) {
  const compact = stripHiddenContext(text).replace(/\s+/g, ' ').trim();
  if (!compact) {
    return '';
  }

  return compact.length > MESSAGE_PREVIEW_LIMIT
    ? `${compact.slice(0, MESSAGE_PREVIEW_LIMIT - 3)}...`
    : compact;
}

async function readLastVisibleMessage(file) {
  const cacheKey = `${file.filePath}:${file.mtimeMs}:${file.size}`;
  const cachedMessage = messageCache.get(cacheKey);
  if (cachedMessage) {
    return cachedMessage;
  }

  let latestMessage = null;
  try {
    const content = await readFile(file.filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }

      let row = null;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }

      if (row?.type !== 'response_item' || row.payload?.type !== 'message') {
        continue;
      }

      const role = row.payload.role;
      if (role !== 'user' && role !== 'assistant') {
        continue;
      }

      const message = compactMessage(extractText(row.payload.content));
      if (!message) {
        continue;
      }

      latestMessage = {
        message,
        timestamp: row.timestamp ?? '',
        role,
      };
    }
  } catch {
    latestMessage = null;
  }

  messageCache.set(cacheKey, latestMessage);
  return latestMessage;
}

export async function getLatestProjectChatMessage(projectPath) {
  const codexHome = getCodexHome();
  const sessionRoots = [
    path.join(codexHome, 'sessions'),
    path.join(codexHome, 'archived_sessions'),
  ];
  const sessionFiles = (
    await Promise.all(sessionRoots.map((sessionRoot) => listSessionFiles(sessionRoot)))
  )
    .flat()
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  const candidates = [];
  for (const file of sessionFiles) {
    const header = await readSessionHeader(file);
    if (!header) {
      continue;
    }

    const pathScore = getPathScore(header.cwd, projectPath);
    if (!pathScore) {
      continue;
    }

    candidates.push({
      ...header,
      pathScore,
      sourceScore: header.threadSource === 'user' ? 1 : 0,
    });
  }

  candidates.sort((left, right) => {
    if (right.sourceScore !== left.sourceScore) {
      return right.sourceScore - left.sourceScore;
    }

    if (right.pathScore !== left.pathScore) {
      return right.pathScore - left.pathScore;
    }

    return right.mtimeMs - left.mtimeMs;
  });

  for (const candidate of candidates) {
    const latestMessage = await readLastVisibleMessage(candidate);
    if (latestMessage) {
      return {
        ...latestMessage,
        sessionId: candidate.id,
        sessionPath: candidate.filePath,
      };
    }
  }

  return null;
}
