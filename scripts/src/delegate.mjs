import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArgs } from './args.mjs';
import {
  classifyWatchResult,
  delegateWaitOptions,
  stripDelegateArgs
} from './delegate-utils.mjs';

const args = parseArgs();
const argv = process.argv.slice(2);
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const dispatchScript = path.join(currentDir, 'dispatch.mjs');
const watchScript = path.join(currentDir, 'watch.mjs');
const dispatchArgs = stripDelegateArgs(argv);
const { waitMs, intervalMs, shouldWait } = delegateWaitOptions(args);

function runJson(script, scriptArgs) {
  const child = spawnSync(process.execPath, [script, ...scriptArgs], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024
  });
  const stdout = child.stdout?.trim() || '';
  const stderr = child.stderr?.trim() || '';
  let parsed = null;
  if (stdout) {
    try {
      parsed = JSON.parse(stdout);
    } catch {}
  }
  return {
    ok: child.status === 0 && parsed?.ok !== false && Boolean(parsed),
    status: child.status,
    parsed,
    stdout,
    stderr,
    error: parsed?.error || stderr || (parsed ? '' : stdout) || `Script failed with code ${child.status}`
  };
}

const dispatch = runJson(dispatchScript, dispatchArgs);
if (!dispatch.ok) {
  console.log(JSON.stringify({
    ok: false,
    mode: 'dispatch-failed',
    error: dispatch.error,
    dispatch: dispatch.parsed || null
  }, null, 2));
  process.exitCode = 1;
  process.exit();
}

const jobId = dispatch.parsed.jobId;
if (!shouldWait) {
  console.log(JSON.stringify({
    ok: true,
    mode: 'dispatched-only',
    jobId,
    state: dispatch.parsed.state,
    waitMs,
    dispatch: dispatch.parsed,
    next: dispatch.parsed.next
  }, null, 2));
  process.exit(0);
}

const watch = runJson(watchScript, [
  '--job', jobId,
  '--timeout', String(waitMs),
  '--interval', String(intervalMs)
]);
const mode = classifyWatchResult(watch.parsed);
const handoffToHeartbeat = mode === 'handoff-to-heartbeat';
const ok = watch.ok || handoffToHeartbeat;

console.log(JSON.stringify({
  ok,
  mode,
  jobId,
  waitMs,
  intervalMs,
  dispatch: dispatch.parsed,
  watch: watch.parsed || null,
  state: watch.parsed?.state || dispatch.parsed.state,
  resultPath: watch.parsed?.resultPath,
  handoffToHeartbeat,
  next: handoffToHeartbeat ? dispatch.parsed.next : undefined,
  error: ok ? undefined : watch.error
}, null, 2));

if (!ok) process.exitCode = 1;
