import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_REGISTRY,
  resolveModelAlias,
  chooseModel,
  fallbackModelKeys,
  candidateModelsForSelection,
  modelSelectionFromArgs
} from '../src/model-policy.mjs';

// ---- resolveModelAlias ----

test('resolveModelAlias resolves canonical keys', () => {
  assert.equal(resolveModelAlias('minimax-m3')?.key, 'minimax-m3');
  assert.equal(resolveModelAlias('volcano-glm-5.2')?.key, 'volcano-glm-5.2');
  assert.equal(resolveModelAlias('deepseek-v4-flash')?.key, 'deepseek-v4-flash');
});

test('resolveModelAlias resolves all documented aliases (case-insensitive)', () => {
  for (const alias of ['minimax', 'MiniMax-M3', 'MINIMAX-M3']) {
    assert.equal(resolveModelAlias(alias)?.key, 'minimax-m3');
  }
  for (const alias of ['volcano', '火山', '火山引擎', 'glm-5.2', 'huoshan', 'ark']) {
    assert.equal(resolveModelAlias(alias)?.key, 'volcano-glm-5.2');
  }
  for (const alias of ['deepseek-flash', 'deepseek-v4-flash']) {
    assert.equal(resolveModelAlias(alias)?.key, 'deepseek-v4-flash');
  }
});

test('resolveModelAlias returns null for empty input', () => {
  assert.equal(resolveModelAlias(null), null);
  assert.equal(resolveModelAlias(''), null);
  assert.equal(resolveModelAlias(undefined), null);
});

test('resolveModelAlias: unknown model is passed through as custom (source=custom)', () => {
  const result = resolveModelAlias('some-future-model-x');
  assert.equal(result.source, 'custom');
  assert.equal(result.model, 'some-future-model-x');
  assert.equal(result.billing, 'unknown');
  assert.equal(result.provider, undefined); // no '/' so no provider inferred
});

test('resolveModelAlias: custom model with slash infers provider', () => {
  const result = resolveModelAlias('acme/acme-7b');
  assert.equal(result.provider, 'acme');
  assert.equal(result.model, 'acme/acme-7b');
});

test('resolveModelAlias: registry entries carry correct billing', () => {
  assert.equal(resolveModelAlias('minimax-m3').billing, 'prepaid');
  assert.equal(resolveModelAlias('volcano-glm-5.2').billing, 'prepaid');
  assert.equal(resolveModelAlias('deepseek-v4-flash').billing, 'pay_as_you_go');
  assert.equal(resolveModelAlias('deepseek-v4-pro').billing, 'pay_as_you_go');
});

// ---- chooseModel (the routing heuristic) ----

test('chooseModel: explicit request always wins', () => {
  const result = chooseModel({ requested: 'volcano-glm-5.2', content: 'trivial batch scan' });
  assert.equal(result.key, 'volcano-glm-5.2');
  assert.match(result.policyReason, /Explicit/);
});

test('chooseModel: defaults to MiniMax-M3 for routine content', () => {
  const result = chooseModel({ content: 'read these files and summarize' });
  assert.equal(result.key, 'minimax-m3');
});

test('chooseModel: routes complex/architecture tasks to glm-5.2', () => {
  for (const word of ['architecture', 'complex', 'security', 'concurrency', 'migration', '架构', '复杂', '跨模块']) {
    const result = chooseModel({ content: `task about ${word}` });
    assert.equal(result.key, 'volcano-glm-5.2', `should route '${word}' to glm-5.2`);
  }
});

test('chooseModel: empty content still defaults to MiniMax-M3', () => {
  assert.equal(chooseModel({}).key, 'minimax-m3');
  assert.equal(chooseModel({ content: '' }).key, 'minimax-m3');
});

// ---- fallbackModelKeys ----

test('fallbackModelKeys: minimax falls back to volcano then deepseek', () => {
  const keys = fallbackModelKeys('minimax-m3');
  assert.deepEqual(keys, ['minimax-m3', 'volcano-glm-5.2', 'deepseek-v4-flash', 'deepseek-v4-pro']);
});

test('fallbackModelKeys: volcano falls back to minimax then deepseek', () => {
  const keys = fallbackModelKeys('volcano-glm-5.2');
  assert.deepEqual(keys, ['volcano-glm-5.2', 'minimax-m3', 'deepseek-v4-flash', 'deepseek-v4-pro']);
});

test('fallbackModelKeys: deepseek-pro only falls back to deepseek-flash (no prepaid)', () => {
  const keys = fallbackModelKeys('deepseek-v4-pro');
  assert.deepEqual(keys, ['deepseek-v4-pro', 'deepseek-v4-flash']);
});

test('fallbackModelKeys: unknown key returns [key]', () => {
  assert.deepEqual(fallbackModelKeys('unknown-model'), ['unknown-model']);
  assert.deepEqual(fallbackModelKeys(undefined).filter(Boolean), []);
});

// ---- candidateModelsForSelection (the paid-fallback safety gate) ----

test('candidateModelsForSelection: prepaid primary excludes pay_as_you_go by default', () => {
  const old = process.env.ZCODE_ALLOW_PAID_FALLBACK;
  delete process.env.ZCODE_ALLOW_PAID_FALLBACK;
  const candidates = candidateModelsForSelection(resolveModelAlias('minimax-m3'));
  const billings = candidates.map(c => c.billing);
  assert.ok(!billings.includes('pay_as_you_go'), 'paid models must be filtered out by default');
  // primary still first
  assert.equal(candidates[0].key, 'minimax-m3');
  assert.equal(candidates[0].isPrimary, true);
  if (old !== undefined) process.env.ZCODE_ALLOW_PAID_FALLBACK = old;
});

test('candidateModelsForSelection: allows paid fallback when env flag set', () => {
  const old = process.env.ZCODE_ALLOW_PAID_FALLBACK;
  process.env.ZCODE_ALLOW_PAID_FALLBACK = '1';
  const candidates = candidateModelsForSelection(resolveModelAlias('minimax-m3'));
  const billings = candidates.map(c => c.billing);
  assert.ok(billings.includes('pay_as_you_go'), 'paid models allowed when flag set');
  if (old === undefined) delete process.env.ZCODE_ALLOW_PAID_FALLBACK;
  else process.env.ZCODE_ALLOW_PAID_FALLBACK = old;
});

test('candidateModelsForSelection: paid primary keeps paid fallback even without flag', () => {
  const old = process.env.ZCODE_ALLOW_PAID_FALLBACK;
  delete process.env.ZCODE_ALLOW_PAID_FALLBACK;
  // explicit paid request should still allow paid fallback (selection itself is paid)
  const candidates = candidateModelsForSelection(resolveModelAlias('deepseek-v4-flash'));
  assert.equal(candidates[0].key, 'deepseek-v4-flash');
  if (old !== undefined) process.env.ZCODE_ALLOW_PAID_FALLBACK = old;
});

test('candidateModelsForSelection: assigns fallbackRank and isPrimary', () => {
  const candidates = candidateModelsForSelection(resolveModelAlias('minimax-m3'), { allowPaidFallback: true });
  candidates.forEach((c, i) => {
    assert.equal(c.fallbackRank, i);
    assert.equal(c.isPrimary, i === 0);
  });
});

// ---- modelSelectionFromArgs (CLI/env entry) ----

test('modelSelectionFromArgs: --model wins over env', () => {
  const old = process.env.ZCODE_PREFERRED_MODEL;
  process.env.ZCODE_PREFERRED_MODEL = 'minimax-m3';
  const result = modelSelectionFromArgs({ model: 'volcano-glm-5.2' }, { content: '' });
  assert.equal(result.key, 'volcano-glm-5.2');
  if (old === undefined) delete process.env.ZCODE_PREFERRED_MODEL;
  else process.env.ZCODE_PREFERRED_MODEL = old;
});

test('modelSelectionFromArgs: falls back to env when no --model', () => {
  const old = process.env.ZCODE_PREFERRED_MODEL;
  process.env.ZCODE_PREFERRED_MODEL = 'deepseek-v4-pro';
  const result = modelSelectionFromArgs({}, { content: '' });
  assert.equal(result.key, 'deepseek-v4-pro');
  if (old === undefined) delete process.env.ZCODE_PREFERRED_MODEL;
  else process.env.ZCODE_PREFERRED_MODEL = old;
});

test('modelSelectionFromArgs: heuristic routing when nothing specified', () => {
  const old = process.env.ZCODE_PREFERRED_MODEL;
  delete process.env.ZCODE_PREFERRED_MODEL;
  const result = modelSelectionFromArgs({}, { content: 'design the system architecture' });
  assert.equal(result.key, 'volcano-glm-5.2');
  if (old !== undefined) process.env.ZCODE_PREFERRED_MODEL = old;
});

// ---- registry structural integrity ----

test('MODEL_REGISTRY: every entry has required fields', () => {
  for (const [key, entry] of Object.entries(MODEL_REGISTRY)) {
    assert.ok(entry.provider, `${key} missing provider`);
    assert.ok(entry.model, `${key} missing model`);
    assert.ok(entry.displayName, `${key} missing displayName`);
    assert.ok(['prepaid', 'pay_as_you_go'].includes(entry.billing), `${key} bad billing`);
    assert.ok(typeof entry.priority === 'number', `${key} bad priority`);
    assert.ok(Array.isArray(entry.aliases), `${key} missing aliases`);
  }
});

test('MODEL_REGISTRY: MiniMax has highest priority (default worker)', () => {
  assert.equal(MODEL_REGISTRY['minimax-m3'].priority, 100);
  assert.ok(MODEL_REGISTRY['minimax-m3'].priority > MODEL_REGISTRY['volcano-glm-5.2'].priority);
});
