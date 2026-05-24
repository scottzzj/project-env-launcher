import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = process.env.CODEX_MONITOR_DATA_DIR
  ? path.resolve(process.env.CODEX_MONITOR_DATA_DIR)
  : path.resolve('server/data');

const DATABASE_FILE = path.join(DATA_DIR, 'project-env-launcher.db');

let db = null;
let writeQueue = Promise.resolve();

function getDb() {
  if (!db) {
    db = new DatabaseSync(DATABASE_FILE);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
  }

  return db;
}

function normalizeJsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function runSerialized(task) {
  const runTask = () => task();
  const next = writeQueue.then(runTask, runTask);
  // Keep the serialized queue usable after a write failure, but return this task's real result.
  writeQueue = next.catch(() => {});
  return next;
}

function replaceRows(tableName, rows) {
  const database = getDb();
  const insert = database.prepare(`INSERT INTO ${tableName} (id, data) VALUES (?, ?)`);

  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare(`DELETE FROM ${tableName}`).run();
    for (const row of normalizeJsonArray(rows)) {
      insert.run(String(row.id ?? row.code), JSON.stringify(row));
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function readRows(tableName) {
  return getDb()
    .prepare(`SELECT data FROM ${tableName} ORDER BY rowid`)
    .all()
    .map((row) => JSON.parse(row.data));
}

async function ensureDatabase() {
  await mkdir(DATA_DIR, { recursive: true });
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS environments (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS module_settings (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS environment_configs (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  database.exec('DROP TABLE IF EXISTS run_records');
}

export async function initStore() {
  await ensureDatabase();
}

export async function loadProjects() {
  await ensureDatabase();
  return readRows('projects');
}

export async function saveProjects(projects) {
  await runSerialized(() => replaceRows('projects', projects));
}

export async function loadEnvironments() {
  await ensureDatabase();
  return readRows('environments');
}

export async function saveEnvironments(environments) {
  await runSerialized(() => replaceRows('environments', environments));
}

export async function loadModuleSettings() {
  await ensureDatabase();
  return readRows('module_settings');
}

export async function saveModuleSettings(moduleSettings) {
  await runSerialized(() => replaceRows('module_settings', moduleSettings));
}

export async function getSavedEnvironmentConfig(id) {
  await ensureDatabase();
  const row = getDb().prepare('SELECT data FROM environment_configs WHERE id = ?').get(id);
  return row ? JSON.parse(row.data) : null;
}

export async function saveSavedEnvironmentConfig(config) {
  await ensureDatabase();
  await runSerialized(() => {
    getDb()
      .prepare('INSERT OR REPLACE INTO environment_configs (id, data) VALUES (?, ?)')
      .run(config.id, JSON.stringify(config));
  });
}

export async function listSavedEnvironmentConfigs() {
  await ensureDatabase();
  return readRows('environment_configs');
}

export function getConfigPaths() {
  return {
    dataDir: DATA_DIR,
    databaseFile: DATABASE_FILE,
  };
}
