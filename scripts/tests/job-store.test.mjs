import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newJobId,
  newPoolId,
  markerFor,
  contentDigest,
  preview
} from '../src/job-store.mjs';

// Pure helpers only — we deliberately avoid saveJob/loadJob here because they
// write into the live ~/.codex/zcode-remote-relay ledger. The persistence layer
// is exercised indirectly by edit-mode-policy.test.mjs (trusted-roots round-trip).

// ---- id format ----

test('newJobId matches zjob_<timestamp>_<8hex> shape', () => {
  const id = newJobId();
  assert.match(id, /^zjob_\d{14}_[0-9a-f]{8}$/);
  // timestamp is YYYYMMDDHHMMSS
  const stamp = id.split('_')[1];
  const year = Number(stamp.slice(0, 4));
  assert.ok(year >= 2026 && year < 2100, `year ${year} implausible`);
});

test('newPoolId matches zpool_<timestamp>_<8hex> shape', () => {
  const id = newPoolId();
  assert.match(id, /^zpool_\d{14}_[0-9a-f]{8}$/);
});

test('newJobId / newPoolId produce unique values across rapid calls', () => {
  const ids = new Set();
  for (let i = 0; i < 500; i += 1) {
    ids.add(newJobId());
    ids.add(newPoolId());
  }
  // 500 of each = 1000 total; all should be unique (uuid suffix + timestamp)
  assert.equal(ids.size, 1000);
});

// ---- markerFor ----

test('markerFor produces ZCODE_RELAY_DONE <jobId>', () => {
  assert.equal(markerFor('zjob_20260625090000_abcdef12'), 'ZCODE_RELAY_DONE zjob_20260625090000_abcdef12');
});

test('markerFor is injective per jobId', () => {
  const a = markerFor('jobA');
  const b = markerFor('jobB');
  assert.notEqual(a, b);
});

// ---- contentDigest ----

test('contentDigest is a 64-char lowercase hex sha256', () => {
  const digest = contentDigest('hello');
  assert.match(digest, /^[0-9a-f]{64}$/);
  // known sha256("hello")
  assert.equal(digest, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
});

test('contentDigest is deterministic and content-sensitive', () => {
  assert.equal(contentDigest('abc'), contentDigest('abc'));
  assert.notEqual(contentDigest('abc'), contentDigest('abd'));
  assert.notEqual(contentDigest('abc'), contentDigest('abc '));
});

test('contentDigest of empty string is valid sha256 empty', () => {
  assert.equal(
    contentDigest(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
});

// ---- preview ----

test('preview returns short content unchanged', () => {
  assert.equal(preview('short'), 'short');
});

test('preview truncates long content with ellipsis at 240 chars', () => {
  const long = 'a'.repeat(500);
  const result = preview(long);
  assert.equal(result.length, 240 + 3); // 240 chars + "..."
  assert.ok(result.endsWith('...'));
});

test('preview collapses whitespace', () => {
  assert.equal(preview('  a   b\n\nc  '), 'a b c');
});

test('preview respects custom maxLength', () => {
  assert.equal(preview('abcdefgh', 4), 'abcd...');
  assert.equal(preview('ab', 4), 'ab');
});
