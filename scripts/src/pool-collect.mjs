import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './args.mjs';
import { loadPool, updatePool } from './job-store.mjs';

const args = parseArgs();
const poolId = args.pool || args['pool-id'];
if (!poolId || typeof poolId !== 'string') {
  console.error('Missing --pool <poolId>.');
  process.exit(2);
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const collectScript = path.join(currentDir, 'collect.mjs');

function runCollect(jobId) {
  const child = spawnSync(process.execPath, [collectScript, '--job', jobId], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024
  });
  const stdout = child.stdout?.trim() || '';
  const stderr = child.stderr?.trim() || '';
  let parsed = null;
  if (stdout) {
    try {
      parsed = JSON.parse(stdout);
    } catch {}
  }
  if (child.status !== 0 || parsed?.ok === false || !parsed) {
    return { ok: false, state: parsed?.state || 'error', error: parsed?.error || stderr || stdout || `collect failed for ${jobId}` };
  }
  return { ok: true, ...parsed };
}

function poolState(workers) {
  const states = workers.map(worker => worker.state || 'queued');
  if (states.some(state => state === 'timeout')) return 'timeout';
  if (states.some(state => state === 'error')) return 'error';
  if (states.some(state => state === 'blocked')) return 'blocked';
  if (states.every(state => ['collected', 'accepted', 'amended', 'rejected'].includes(state))) return 'collected';
  if (states.some(state => ['running', 'completed', 'dispatched', 'dispatching'].includes(state))) return 'running';
  return 'queued';
}

try {
  const pool = loadPool(poolId);
  const workers = Array.isArray(pool.workers) ? pool.workers : [];
  for (const worker of workers) {
    if (!worker.jobId) continue;
    const result = runCollect(worker.jobId);
    worker.state = result.state || (result.ok ? 'collected' : 'error');
    worker.routeState = worker.state;
    worker.markerFound = result.markerFound;
    worker.structuredResultFound = result.structuredResultFound;
    worker.workerStatus = result.workerStatus;
    worker.resultPath = result.resultPath;
    worker.collectedAt = new Date().toISOString();
    if (result.snapshot) worker.snapshot = result.snapshot;
    if (result.error) worker.error = result.error;
  }
  const state = poolState(workers);
  updatePool(poolId, {
    state,
    routeState: state,
    workers,
    collectedAt: state === 'collected' ? new Date().toISOString() : undefined
  });

  console.log(JSON.stringify({
    ok: true,
    poolId,
    state,
    workerCount: workers.length,
    workers: workers.map(worker => ({
      workerId: worker.workerId,
      jobId: worker.jobId,
      taskId: worker.taskId,
      state: worker.state,
      markerFound: worker.markerFound,
      structuredResultFound: worker.structuredResultFound,
      workerStatus: worker.workerStatus,
      resultPath: worker.resultPath,
      requestedModel: worker.resolvedModel,
      actualModel: worker.actualModel || worker.resolvedModel,
      modelMatchesRequest: worker.modelMatchesRequest,
      editMode: worker.editMode,
      scope: worker.scope
    }))
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    poolId,
    error: error.message
  }, null, 2));
  process.exitCode = 1;
}

