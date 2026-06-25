import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from './args.mjs';
import { listPools, loadJob, loadPool } from './job-store.mjs';

const args = parseArgs();
const poolId = args.pool || args['pool-id'];

function latestPool() {
  const pools = listPools();
  if (!pools.length) throw new Error('No pool records found.');
  return pools[0];
}

function loadPoolRecord() {
  const poolFile = args['pool-file'];
  if (poolFile && typeof poolFile === 'string') {
    const fullPath = path.resolve(poolFile);
    return JSON.parse(fs.readFileSync(fullPath, 'utf8').replace(/^\uFEFF/, ''));
  }
  if (poolId && typeof poolId === 'string') return loadPool(poolId);
  if (args.latest === true) return latestPool();
  throw new Error('Missing --pool <poolId>, --pool-file <path>, or --latest.');
}

function loadJobSafe(jobId) {
  try {
    return loadJob(jobId);
  } catch {
    return null;
  }
}

function resultPreview(resultPath) {
  if (!resultPath || !fs.existsSync(resultPath)) return '';
  const text = fs.readFileSync(resultPath, 'utf8').replace(/\s+/g, ' ').trim();
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

function markdown(pool, workers) {
  const lines = [];
  lines.push(`# ZCode Worker Pool Report`);
  lines.push('');
  lines.push(`- poolId: ${pool.poolId}`);
  lines.push(`- state: ${pool.state || 'unknown'}`);
  lines.push(`- poolType: ${pool.poolType || 'unknown'}`);
  lines.push(`- roundId: ${pool.roundId || 'none'}`);
  lines.push(`- validationGate: ${pool.validationGate || 'none'}`);
  lines.push('');
  lines.push('| workerId | jobId | taskId | state | workerStatus | editMode | actualModel | scope | result |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const entry of workers) {
    lines.push(`| ${entry.workerId || ''} | ${entry.jobId || ''} | ${entry.taskId || ''} | ${entry.state || ''} | ${entry.workerStatus || ''} | ${entry.editMode || ''} | ${entry.model || ''} | ${String(entry.scope || '').replace(/\|/g, '/')} | ${entry.resultPath || ''} |`);
  }
  lines.push('');
  lines.push('## Ownership And Gates');
  for (const entry of workers) {
    lines.push('');
    lines.push(`### ${entry.workerId || entry.jobId}`);
    lines.push(`- ownedFiles: ${(entry.ownedFiles || []).join(', ') || 'none'}`);
    lines.push(`- readOnlyFiles: ${(entry.readOnlyFiles || []).join(', ') || 'none'}`);
    lines.push(`- forbiddenFiles: ${(entry.forbiddenFiles || []).join(', ') || 'none'}`);
    lines.push(`- validationGate: ${entry.validationGate || 'none'}`);
    if (args['include-results'] === true && entry.resultPreview) {
      lines.push(`- resultPreview: ${entry.resultPreview}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

try {
  const pool = loadPoolRecord();
  const workers = (Array.isArray(pool.workers) ? pool.workers : []).map(worker => {
    const job = worker.jobId ? loadJobSafe(worker.jobId) : null;
    const resultPath = job?.resultPath || worker.resultPath || '';
    return {
      ...worker,
      state: job?.state || worker.state,
      routeState: job?.routeState || worker.routeState,
      workerStatus: job?.workerStatus || worker.workerStatus,
      structuredResultFound: job?.structuredResultFound ?? worker.structuredResultFound,
      taskId: job?.taskId || worker.taskId,
      model: job?.actualModel || worker.actualModel || job?.resolvedModel || worker.resolvedModel,
      editMode: job?.editMode || worker.editMode,
      resultPath,
      resultPreview: resultPreview(resultPath)
    };
  });

  if (args.json === true) {
    console.log(JSON.stringify({ ok: true, pool, workers }, null, 2));
  } else {
    process.stdout.write(markdown(pool, workers));
  }
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    poolId,
    error: error.message
  }, null, 2));
  process.exitCode = 1;
}




