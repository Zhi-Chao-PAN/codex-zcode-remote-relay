import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  POOL_POLICY,
  parseBoolean,
  normalizePoolType,
  normalizeList,
  validatePoolPolicy,
  validateWorkerOwnership
} from '../src/pool-policy.mjs';

// ---- parseBoolean ----

test('parseBoolean accepts 1/true/yes (case-insensitive) and rejects everything else', () => {
  for (const truthy of [true, '1', 'true', 'TRUE', 'yes', 'Yes']) {
    assert.equal(parseBoolean(truthy), true);
  }
  for (const falsy of [false, '0', 'false', '', null, undefined, 'no', 'random']) {
    assert.equal(parseBoolean(falsy), false);
  }
});

// ---- normalizePoolType ----

test('normalizePoolType maps aliases to canonical types', () => {
  assert.equal(normalizePoolType('readonly'), 'read-only');
  assert.equal(normalizePoolType('read_only'), 'read-only');
  assert.equal(normalizePoolType('report'), 'read-only');
  assert.equal(normalizePoolType('audit'), 'read-only');
  assert.equal(normalizePoolType('short'), 'short-read-only');
  assert.equal(normalizePoolType('probe'), 'short-read-only');
  assert.equal(normalizePoolType('editable'), 'editable');
});

test('normalizePoolType is case-insensitive and trims', () => {
  assert.equal(normalizePoolType('  EDITABLE  '), 'editable');
  assert.equal(normalizePoolType('ReadOnly'), 'read-only');
});

test('normalizePoolType throws on unknown type', () => {
  assert.throws(() => normalizePoolType('bogus'), /Unknown pool type/);
});

test('normalizePoolType treats empty/null as editable default', () => {
  assert.equal(normalizePoolType(), 'editable');
  assert.equal(normalizePoolType(''), 'editable');
  assert.equal(normalizePoolType(null), 'editable');
});

// ---- normalizeList ----

test('normalizeList: string split on newline/comma/semicolon', () => {
  assert.deepEqual(normalizeList('a\nb,c;d'), ['a', 'b', 'c', 'd']);
});

test('normalizeList: JSON array string parsed', () => {
  assert.deepEqual(normalizeList('["a","b"]'), ['a', 'b']);
});

test('normalizeList: array passthrough (trimmed, filtered)', () => {
  assert.deepEqual(normalizeList(['a', ' b ', '', 'c']), ['a', 'b', 'c']);
});

test('normalizeList: empty returns []', () => {
  assert.deepEqual(normalizeList(''), []);
  assert.deepEqual(normalizeList([]), []);
  assert.deepEqual(normalizeList(null), []);
  assert.deepEqual(normalizeList(undefined), []);
});

test('normalizeList: non-array JSON object is treated as a plain string token (only "[...]" triggers JSON parse)', () => {
  // normalizeList only enters the JSON branch when the string starts with "[".
  // A bare object literal is therefore split as text, not parsed — documented behavior.
  const result = normalizeList('{"a":1}');
  assert.deepEqual(result, ['{"a":1}']);
});

test('normalizeList: throws when a "["-prefixed string is not a JSON array', () => {
  assert.throws(() => normalizeList('[1,2'), /Expected a JSON array|JSON/);
});

// ---- validatePoolPolicy (worker limits) ----

test('validatePoolPolicy: editable allows up to 2 by default', () => {
  for (const count of [1, 2]) {
    const result = validatePoolPolicy({ poolType: 'editable', workerCount: count });
    assert.equal(result.allowed, true);
    assert.equal(result.explicitApprovalRequired, false);
  }
});

test('validatePoolPolicy: editable 3+ throws (cannot use 5+ override)', () => {
  assert.throws(
    () => validatePoolPolicy({ poolType: 'editable', workerCount: 3 }),
    /Editable pools are limited to 2/
  );
});

test('validatePoolPolicy: read-only allows up to 3 by default', () => {
  for (const count of [1, 2, 3]) {
    const result = validatePoolPolicy({ poolType: 'read-only', workerCount: count });
    assert.equal(result.allowed, true);
  }
});

test('validatePoolPolicy: read-only 4 throws (must use short-read-only)', () => {
  assert.throws(
    () => validatePoolPolicy({ poolType: 'read-only', workerCount: 4 }),
    /Use poolType short-read-only/
  );
});

test('validatePoolPolicy: short-read-only allows up to 4 by default', () => {
  for (const count of [1, 2, 3, 4]) {
    const result = validatePoolPolicy({ poolType: 'short-read-only', workerCount: count });
    assert.equal(result.allowed, true);
  }
});

test('validatePoolPolicy: 5+ read-only requires explicit approval flag', () => {
  assert.throws(
    () => validatePoolPolicy({ poolType: 'read-only', workerCount: 5, allowFivePlus: false }),
    /5\+ workers require an explicit read-only approval flag/
  );
  assert.throws(
    () => validatePoolPolicy({ poolType: 'short-read-only', workerCount: 5, allowFivePlus: false }),
    /explicit read-only approval flag/
  );
});

test('validatePoolPolicy: 5+ read-only allowed with explicit approval', () => {
  const result = validatePoolPolicy({ poolType: 'read-only', workerCount: 5, allowFivePlus: true });
  assert.equal(result.allowed, true);
  assert.equal(result.explicitApprovalRequired, true);
});

test('validatePoolPolicy: 5+ editable never allowed even with flag', () => {
  assert.throws(
    () => validatePoolPolicy({ poolType: 'editable', workerCount: 5, allowFivePlus: true }),
    /Editable pools are limited to 2/
  );
});

test('validatePoolPolicy: invalid worker count throws', () => {
  for (const bad of [0, -1, 1.5, 'x', NaN]) {
    assert.throws(() => validatePoolPolicy({ poolType: 'editable', workerCount: bad }), /Invalid worker count/);
  }
});

// ---- validateWorkerOwnership (overlap detection) ----

test('validateWorkerOwnership: passes when workers own disjoint files', () => {
  assert.doesNotThrow(() => validateWorkerOwnership([
    { workerId: 'A', ownedFiles: ['src/a.js'] },
    { workerId: 'B', ownedFiles: ['src/b.js'] }
  ]));
});

test('validateWorkerOwnership: throws on overlapping owned file', () => {
  assert.throws(
    () => validateWorkerOwnership([
      { workerId: 'A', ownedFiles: ['src/shared.js'] },
      { workerId: 'B', ownedFiles: ['src/shared.js'] }
    ]),
    /overlaps between workers/
  );
});

test('validateWorkerOwnership: overlap check is case-insensitive', () => {
  assert.throws(
    () => validateWorkerOwnership([
      { workerId: 'A', ownedFiles: ['src/File.js'] },
      { workerId: 'B', ownedFiles: ['src/file.js'] }
    ]),
    /overlaps between workers/
  );
});

test('validateWorkerOwnership: same worker owning same file twice is OK', () => {
  assert.doesNotThrow(() => validateWorkerOwnership([
    { workerId: 'A', ownedFiles: ['src/a.js', 'src/a.js'] }
  ]));
});

test('validateWorkerOwnership: accepts ownedFiles as comma string', () => {
  assert.doesNotThrow(() => validateWorkerOwnership([
    { workerId: 'A', ownedFiles: 'src/a.js,src/b.js' },
    { workerId: 'B', ownedFiles: 'src/c.js' }
  ]));
});

test('validateWorkerOwnership: empty workers list passes', () => {
  assert.doesNotThrow(() => validateWorkerOwnership([]));
  assert.doesNotThrow(() => validateWorkerOwnership());
});

// ---- POOL_POLICY structural sanity ----

test('POOL_POLICY: editable has lowest default worker cap', () => {
  assert.equal(POOL_POLICY.editable.maxDefaultWorkers, 2);
  assert.equal(POOL_POLICY['read-only'].maxDefaultWorkers, 3);
  assert.equal(POOL_POLICY['short-read-only'].maxDefaultWorkers, 4);
  assert.equal(POOL_POLICY.editable.readOnly, false);
  assert.equal(POOL_POLICY['read-only'].readOnly, true);
});
