import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RELAY_RESULT_SCHEMA,
  extractRelayResult,
  findRelayResultInTexts,
  isTerminalRelayResult,
  normalizeRelayResult,
  resultSchemaInstructions
} from '../src/result-schema.mjs';

const base = {
  schema: RELAY_RESULT_SCHEMA,
  jobId: 'zjob_20260625000000_abcdef12',
  status: 'completed',
  summary: 'Done.',
  changedFiles: ['src/a.js'],
  inspectedFiles: ['src/b.js'],
  commands: ['npm test', { command: 'npm run build', result: 'pass' }],
  risks: ['none'],
  nextStep: 'accept',
  suggestedNextRound: 'none'
};

test('resultSchemaInstructions includes marker and schema', () => {
  const text = resultSchemaInstructions({
    jobId: base.jobId,
    doneMarker: `ZCODE_RELAY_DONE ${base.jobId}`
  });
  assert.match(text, /ZCODE_RELAY_DONE zjob_20260625000000_abcdef12/);
  assert.match(text, new RegExp(RELAY_RESULT_SCHEMA));
});

test('normalizeRelayResult accepts a valid relay result', () => {
  const result = normalizeRelayResult(base, { jobId: base.jobId });
  assert.equal(result.schema, RELAY_RESULT_SCHEMA);
  assert.equal(result.jobId, base.jobId);
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.changedFiles, ['src/a.js']);
  assert.deepEqual(result.inspectedFiles, ['src/b.js']);
  assert.deepEqual(result.commands, [
    { command: 'npm test', result: '' },
    { command: 'npm run build', result: 'pass' }
  ]);
});

test('normalizeRelayResult rejects wrong schema/job/status', () => {
  assert.equal(normalizeRelayResult({ ...base, schema: 'x' }, { jobId: base.jobId }), null);
  assert.equal(normalizeRelayResult({ ...base, jobId: 'other' }, { jobId: base.jobId }), null);
  assert.equal(normalizeRelayResult({ ...base, status: 'waiting' }, { jobId: base.jobId }), null);
});

test('extractRelayResult parses fenced json from assistant text', () => {
  const text = `Summary first.

\`\`\`json
${JSON.stringify(base, null, 2)}
\`\`\`
`;
  const result = extractRelayResult(text, { jobId: base.jobId });
  assert.equal(result.jobId, base.jobId);
  assert.equal(result.summary, 'Done.');
});

test('extractRelayResult ignores malformed or mismatched json blocks', () => {
  const text = `\`\`\`json
{bad json}
\`\`\`
\`\`\`json
${JSON.stringify({ ...base, jobId: 'other' })}
\`\`\``;
  assert.equal(extractRelayResult(text, { jobId: base.jobId }), null);
});

test('findRelayResultInTexts returns latest matching result', () => {
  const older = JSON.stringify({ ...base, summary: 'older' });
  const newer = JSON.stringify({ ...base, summary: 'newer', status: 'partial' });
  const found = findRelayResultInTexts([older, 'noise', newer], { jobId: base.jobId });
  assert.equal(found.result.summary, 'newer');
  assert.equal(found.result.status, 'partial');
  assert.equal(found.index, 2);
});

test('isTerminalRelayResult treats blocked as non-terminal', () => {
  assert.equal(isTerminalRelayResult({ status: 'completed' }), true);
  assert.equal(isTerminalRelayResult({ status: 'partial' }), true);
  assert.equal(isTerminalRelayResult({ status: 'failed' }), true);
  assert.equal(isTerminalRelayResult({ status: 'blocked' }), false);
});
