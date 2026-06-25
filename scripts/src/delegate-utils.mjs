export const DEFAULT_DELEGATE_WAIT_MS = 15 * 60 * 1000;
export const DEFAULT_DELEGATE_INTERVAL_MS = 15 * 1000;

const VALUE_OPTIONS = new Set([
  'wait-ms',
  'wait-timeout',
  'watch-timeout',
  'interval-ms',
  'watch-interval'
]);

const BOOLEAN_OPTIONS = new Set([
  'no-wait',
  'async-only'
]);

function intOrDefault(value, fallback) {
  if (value === undefined || value === null || value === true) return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function delegateWaitOptions(args = {}) {
  const noWait = args['no-wait'] === true || args['async-only'] === true;
  const waitMs = noWait
    ? 0
    : intOrDefault(args['wait-ms'] ?? args['wait-timeout'] ?? args['watch-timeout'], DEFAULT_DELEGATE_WAIT_MS);
  const intervalMs = intOrDefault(args['interval-ms'] ?? args['watch-interval'], DEFAULT_DELEGATE_INTERVAL_MS);
  return { waitMs, intervalMs, shouldWait: waitMs > 0 };
}

export function stripDelegateArgs(argv = []) {
  const kept = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      kept.push(token);
      continue;
    }
    const key = token.slice(2);
    if (BOOLEAN_OPTIONS.has(key)) continue;
    if (VALUE_OPTIONS.has(key)) {
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) index += 1;
      continue;
    }
    kept.push(token);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      kept.push(next);
      index += 1;
    }
  }
  return kept;
}

export function classifyWatchResult(result) {
  if (!result || typeof result !== 'object') return 'watch-error';
  if (result.ok === true && result.state === 'collected') return 'completed-in-turn';
  if (result.ok === true && result.state === 'completed') return 'completed-in-turn';
  if (result.ok === true && result.state === 'blocked') return 'blocked-in-turn';
  if (result.ok === false && /timed out watching job/i.test(String(result.error || ''))) return 'handoff-to-heartbeat';
  return 'watch-error';
}
