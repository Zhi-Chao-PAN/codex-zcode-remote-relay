import { parseArgs } from './args.mjs';
import { loadJob, loadPool, updateJob, updatePool } from './job-store.mjs';

const args = parseArgs();
const jobId = args.job || args['job-id'];
const state = args.state || args.decision;
const note = typeof args.note === 'string' ? args.note : '';
const allowed = new Set(['accepted', 'amended', 'rejected', 'codex-takeover']);

if (!jobId || typeof jobId !== 'string') {
  console.error('Missing --job <jobId>.');
  process.exit(2);
}
if (!state || typeof state !== 'string' || !allowed.has(state)) {
  console.error('Missing or invalid --state. Use accepted, amended, rejected, or codex-takeover.');
  process.exit(2);
}

try {
  const job = loadJob(jobId);
  const decidedAt = new Date().toISOString();
  const updated = updateJob(jobId, {
    state,
    routeState: state,
    codexDecision: {
      state,
      note,
      decidedAt
    }
  });

  let poolUpdated = false;
  if (job.poolId) {
    try {
      const pool = loadPool(job.poolId);
      const workers = Array.isArray(pool.workers) ? pool.workers : [];
      for (const worker of workers) {
        if (worker.jobId === jobId) {
          worker.state = state;
          worker.routeState = state;
          worker.codexDecision = { state, note, decidedAt };
          poolUpdated = true;
        }
      }
      if (poolUpdated) updatePool(job.poolId, { workers });
    } catch {}
  }

  console.log(JSON.stringify({
    ok: true,
    jobId,
    poolId: updated.poolId || null,
    state,
    note,
    poolUpdated
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    jobId,
    state,
    error: error.message
  }, null, 2));
  process.exitCode = 1;
}
