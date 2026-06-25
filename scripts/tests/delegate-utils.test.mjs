import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DELEGATE_INTERVAL_MS,
  DEFAULT_DELEGATE_WAIT_MS,
  classifyWatchResult,
  delegateWaitOptions,
  stripDelegateArgs
} from '../src/delegate-utils.mjs';

test('delegateWaitOptions defaults to bounded in-turn wait', () => {
  assert.deepEqual(delegateWaitOptions({}), {
    waitMs: DEFAULT_DELEGATE_WAIT_MS,
    intervalMs: DEFAULT_DELEGATE_INTERVAL_MS,
    shouldWait: true
  });
});

test('delegateWaitOptions supports no-wait and custom interval', () => {
  assert.deepEqual(delegateWaitOptions({ 'no-wait': true, 'interval-ms': '3000' }), {
    waitMs: 0,
    intervalMs: 3000,
    shouldWait: false
  });
});

test('delegateWaitOptions accepts wait aliases and rejects invalid values', () => {
  assert.equal(delegateWaitOptions({ 'wait-ms': '1200' }).waitMs, 1200);
  assert.equal(delegateWaitOptions({ 'watch-timeout': '2400' }).waitMs, 2400);
  assert.equal(delegateWaitOptions({ 'wait-timeout': 'bad' }).waitMs, DEFAULT_DELEGATE_WAIT_MS);
});

test('stripDelegateArgs removes only delegate/watch control options', () => {
  const argv = [
    '--content-file', 'handoff.md',
    '--model', 'minimax-m3',
    '--wait-ms', '900000',
    '--interval-ms', '15000',
    '--no-wait',
    '--owned-files', 'src/a.js',
    '--reuse-current-task'
  ];
  assert.deepEqual(stripDelegateArgs(argv), [
    '--content-file', 'handoff.md',
    '--model', 'minimax-m3',
    '--owned-files', 'src/a.js',
    '--reuse-current-task'
  ]);
});

test('classifyWatchResult maps collect, blocked, timeout, and unknown states', () => {
  assert.equal(classifyWatchResult({ ok: true, state: 'collected' }), 'completed-in-turn');
  assert.equal(classifyWatchResult({ ok: true, state: 'blocked' }), 'blocked-in-turn');
  assert.equal(
    classifyWatchResult({ ok: false, state: 'running', error: 'Timed out watching job after 100ms.' }),
    'handoff-to-heartbeat'
  );
  assert.equal(classifyWatchResult({ ok: false, state: 'error', error: 'boom' }), 'watch-error');
});
