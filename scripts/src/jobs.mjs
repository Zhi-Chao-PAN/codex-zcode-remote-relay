import { parseArgs } from './args.mjs';
import { listJobs, listPools, removeJob } from './job-store.mjs';

const args = parseArgs();

if (typeof args.clear === 'string') {
  removeJob(args.clear);
  console.log(JSON.stringify({ ok: true, cleared: args.clear }, null, 2));
  process.exit(0);
}

if (args.pools === true || args.type === 'pools') {
  const limit = typeof args.limit === 'string' ? Number.parseInt(args.limit, 10) : 20;
  const pools = listPools().slice(0, Number.isFinite(limit) ? limit : 20).map(pool => ({
    poolId: pool.poolId,
    state: pool.state,
    poolType: pool.poolType,
    roundId: pool.roundId,
    createdAt: pool.createdAt,
    updatedAt: pool.updatedAt,
    workerCount: Array.isArray(pool.workers) ? pool.workers.length : 0,
    jobIds: Array.isArray(pool.workers) ? pool.workers.map(worker => worker.jobId).filter(Boolean) : []
  }));

  console.log(JSON.stringify({
    ok: true,
    count: pools.length,
    pools
  }, null, 2));
  process.exit(0);
}

const limit = typeof args.limit === 'string' ? Number.parseInt(args.limit, 10) : 20;
const jobs = listJobs().slice(0, Number.isFinite(limit) ? limit : 20).map(job => ({
  jobId: job.jobId,
  state: job.state,
  routeState: job.routeState,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  taskId: job.taskId,
  poolId: job.poolId,
  workerId: job.workerId,
  roundId: job.roundId,
  scope: job.scope,
  requestedModel: job.resolvedModel,
  actualModel: job.actualModel || job.resolvedModel,
  modelMatchesRequest: job.modelMatchesRequest,
  editMode: job.editMode,
  preview: job.contentPreview,
  resultPath: job.resultPath
}));

console.log(JSON.stringify({
  ok: true,
  count: jobs.length,
  jobs
}, null, 2));

