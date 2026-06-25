import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export function relayHome() {
  return path.join(os.homedir(), '.codex', 'zcode-remote-relay');
}

export function jobsDir() {
  return path.join(relayHome(), 'jobs');
}

export function poolsDir() {
  return path.join(relayHome(), 'pools');
}

export function handoffsDir() {
  return path.join(relayHome(), 'handoffs');
}

export function resultsDir() {
  return path.join(relayHome(), 'results');
}

export function ensureStore() {
  fs.mkdirSync(jobsDir(), { recursive: true });
  fs.mkdirSync(poolsDir(), { recursive: true });
  fs.mkdirSync(handoffsDir(), { recursive: true });
  fs.mkdirSync(resultsDir(), { recursive: true });
}

export function newJobId() {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return `zjob_${stamp}_${randomUUID().slice(0, 8)}`;
}

export function newPoolId() {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return `zpool_${stamp}_${randomUUID().slice(0, 8)}`;
}

export function markerFor(jobId) {
  return `ZCODE_RELAY_DONE ${jobId}`;
}

export function jobPath(jobId) {
  return path.join(jobsDir(), `${jobId}.json`);
}

export function poolPath(poolId) {
  return path.join(poolsDir(), `${poolId}.json`);
}

export function handoffPath(jobId) {
  return path.join(handoffsDir(), `${jobId}.md`);
}

export function saveHandoff(jobId, content) {
  ensureStore();
  const filePath = handoffPath(jobId);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

export function saveJob(job) {
  ensureStore();
  fs.writeFileSync(jobPath(job.jobId), `${JSON.stringify(job, null, 2)}\n`, 'utf8');
  return job;
}

export function savePool(pool) {
  ensureStore();
  fs.writeFileSync(poolPath(pool.poolId), `${JSON.stringify(pool, null, 2)}\n`, 'utf8');
  return pool;
}

export function loadJob(jobId) {
  const filePath = jobPath(jobId);
  if (!fs.existsSync(filePath)) throw new Error(`Job not found: ${jobId}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function loadPool(poolId) {
  const filePath = poolPath(poolId);
  if (!fs.existsSync(filePath)) throw new Error(`Pool not found: ${poolId}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function updateJob(jobId, patch) {
  const current = loadJob(jobId);
  return saveJob({
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  });
}

export function updatePool(poolId, patch) {
  const current = loadPool(poolId);
  return savePool({
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  });
}

export function listJobs() {
  ensureStore();
  return fs.readdirSync(jobsDir())
    .filter(name => name.endsWith('.json'))
    .map(name => JSON.parse(fs.readFileSync(path.join(jobsDir(), name), 'utf8')))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function listPools() {
  ensureStore();
  return fs.readdirSync(poolsDir())
    .filter(name => name.endsWith('.json'))
    .map(name => JSON.parse(fs.readFileSync(path.join(poolsDir(), name), 'utf8')))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function removeJob(jobId) {
  for (const filePath of [jobPath(jobId), handoffPath(jobId)]) {
    if (fs.existsSync(filePath)) fs.rmSync(filePath);
  }
}

export function contentDigest(content) {
  return createHash('sha256').update(content).digest('hex');
}

export function preview(content, maxLength = 240) {
  const compact = content.replace(/\s+/g, ' ').trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}
