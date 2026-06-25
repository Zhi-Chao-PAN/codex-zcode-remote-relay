export const POOL_POLICY = {
  editable: {
    maxDefaultWorkers: 2,
    allowFivePlus: false,
    readOnly: false
  },
  'read-only': {
    maxDefaultWorkers: 3,
    allowFivePlus: true,
    readOnly: true
  },
  'short-read-only': {
    maxDefaultWorkers: 4,
    allowFivePlus: true,
    readOnly: true
  }
};

export function parseBoolean(value) {
  if (value === true) return true;
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export function normalizePoolType(input = 'editable') {
  const raw = String(input || 'editable').trim().toLowerCase();
  if (['readonly', 'read_only', 'report', 'audit'].includes(raw)) return 'read-only';
  if (['short-readonly', 'short_read_only', 'short', 'probe'].includes(raw)) return 'short-read-only';
  if (raw in POOL_POLICY) return raw;
  throw new Error(`Unknown pool type: ${input}`);
}

export function normalizeList(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error(`Expected a JSON array, got: ${trimmed}`);
    return normalizeList(parsed);
  }
  return trimmed.split(/[\n,;]/).map(item => item.trim()).filter(Boolean);
}

export function validatePoolPolicy({ poolType = 'editable', workerCount, allowFivePlus = false } = {}) {
  const type = normalizePoolType(poolType);
  const policy = POOL_POLICY[type];
  const count = Number(workerCount);
  if (!Number.isInteger(count) || count < 1) throw new Error(`Invalid worker count: ${workerCount}`);

  if (count <= policy.maxDefaultWorkers) {
    return { type, allowed: true, maxDefaultWorkers: policy.maxDefaultWorkers, explicitApprovalRequired: false };
  }

  if (type === 'editable') {
    throw new Error('Editable pools are limited to 2 workers by default and cannot use the 5+ read-only override. Split into later rounds instead.');
  }

  if (type === 'read-only' && count === 4) {
    throw new Error('Use poolType short-read-only for 4-worker short read-only probes. Regular read-only pools are limited to 3 workers.');
  }

  if (count >= 5 && (!policy.readOnly || !parseBoolean(allowFivePlus))) {
    throw new Error(`Pool type ${type} allows ${policy.maxDefaultWorkers} workers by default. 5+ workers require an explicit read-only approval flag.`);
  }

  if (count >= 5 && policy.readOnly && parseBoolean(allowFivePlus)) {
    return { type, allowed: true, maxDefaultWorkers: policy.maxDefaultWorkers, explicitApprovalRequired: true };
  }

  throw new Error(`Pool type ${type} allows ${policy.maxDefaultWorkers} workers by default.`);
}

export function validateWorkerOwnership(workers = []) {
  const owners = new Map();
  for (const worker of workers) {
    const workerId = worker.workerId || worker.id || '(unnamed-worker)';
    for (const pattern of normalizeList(worker.ownedFiles)) {
      const key = pattern.toLowerCase();
      const existing = owners.get(key);
      if (existing && existing !== workerId) {
        throw new Error(`Owned file/scope overlaps between workers: ${pattern} (${existing} and ${workerId})`);
      }
      owners.set(key, workerId);
    }
  }
}

