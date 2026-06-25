import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArgs } from './args.mjs';
import { loadJob } from './job-store.mjs';
import { optionalIntEnv } from './env.mjs';

const args = parseArgs();
const jobId = args.job || args['job-id'];
if (!jobId || typeof jobId !== 'string') {
  console.error('Missing --job <jobId>.');
  process.exit(2);
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const statusScript = path.join(currentDir, 'status.mjs');
const collectScript = path.join(currentDir, 'collect.mjs');
const intervalMs = typeof args.interval === 'string'
  ? Number.parseInt(args.interval, 10)
  : optionalIntEnv('ZCODE_WATCH_INTERVAL_MS', 15000);
const timeoutMs = typeof args.timeout === 'string'
  ? Number.parseInt(args.timeout, 10)
  : optionalIntEnv('ZCODE_WATCH_TIMEOUT_MS', 10 * 60 * 1000);
const deadline = Date.now() + timeoutMs;

let last = null;
while (Date.now() <= deadline) {
  const status = spawnSync(process.execPath, [statusScript, '--job', jobId], {
    encoding: 'utf8',
    windowsHide: true
  });
  const stdout = status.stdout?.trim();
  if (stdout) {
    try {
      last = JSON.parse(stdout);
    } catch {
      last = { ok: false, raw: stdout };
    }
  }
  if (last?.state === 'completed') {
    const collected = spawnSync(process.execPath, [collectScript, '--job', jobId], {
      encoding: 'utf8',
      windowsHide: true
    });
    process.stdout.write(collected.stdout || '');
    process.exit(collected.status ?? 0);
  }
  await new Promise(resolve => setTimeout(resolve, intervalMs));
}

const job = loadJob(jobId);
console.log(JSON.stringify({
  ok: false,
  jobId,
  state: job.state,
  error: `Timed out watching job after ${timeoutMs}ms.`,
  last
}, null, 2));
process.exitCode = 1;
