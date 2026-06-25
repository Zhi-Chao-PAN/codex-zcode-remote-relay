import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function defaultEnvPath() {
  return path.join(os.homedir(), '.codex', 'zcode-remote-relay', '.env.local');
}

export function envCandidates(filePath = process.env.ZCODE_RELAY_ENV || defaultEnvPath()) {
  return [
    filePath,
    path.resolve('.env.local'),
    defaultEnvPath()
  ].filter(Boolean).map(candidate => path.resolve(candidate));
}

export function resolveEnvPath(filePath = process.env.ZCODE_RELAY_ENV || defaultEnvPath(), { forWrite = false } = {}) {
  const existing = envCandidates(filePath).find(candidate => fs.existsSync(candidate));
  if (existing) return existing;
  return forWrite ? path.resolve(filePath || defaultEnvPath()) : null;
}

export function loadEnv(filePath = process.env.ZCODE_RELAY_ENV || defaultEnvPath()) {
  const fullPath = resolveEnvPath(filePath);
  if (!fullPath) return {};

  const env = {};
  for (const rawLine of fs.readFileSync(fullPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    env[key] = value;
    if (!(key in process.env)) process.env[key] = value;
  }
  return env;
}

export function upsertEnvValue(key, value, filePath = process.env.ZCODE_RELAY_ENV || defaultEnvPath()) {
  const fullPath = resolveEnvPath(filePath, { forWrite: true });
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const current = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';
  const lines = current.split(/\r?\n/);
  let replaced = false;
  const next = lines.map(line => {
    if (line.startsWith(`${key}=`)) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!replaced) next.push(`${key}=${value}`);
  fs.writeFileSync(fullPath, `${next.filter((line, idx) => line || idx < next.length - 1).join('\n')}\n`, 'utf8');
  process.env[key] = value;
  return fullPath;
}

export function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

export function optionalIntEnv(name, fallback) {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
