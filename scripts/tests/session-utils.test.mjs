import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeSnapshot,
  summarizeWorkspaceList,
  previewMessage,
  extractMessageText
} from '../src/session-utils.mjs';

// ---- extractMessageText (the worker-result extractor collect.mjs relies on) ----

test('extractMessageText: returns "" for falsy input', () => {
  assert.equal(extractMessageText(null), '');
  assert.equal(extractMessageText(undefined), '');
  assert.equal(extractMessageText({}), '');
});

test('extractMessageText: prefers message.text', () => {
  assert.equal(extractMessageText({ text: 'from-text', content: 'from-content' }), 'from-text');
});

test('extractMessageText: falls back to message.content string', () => {
  assert.equal(extractMessageText({ content: 'from-content' }), 'from-content');
});

test('extractMessageText: falls back to message.info.text', () => {
  assert.equal(extractMessageText({ info: { text: 'from-info' } }), 'from-info');
});

test('extractMessageText: joins parts array', () => {
  const result = extractMessageText({ parts: [{ text: 'a' }, { text: 'b' }, 'c'] });
  assert.equal(result, 'a\nb\nc');
});

test('extractMessageText: joins content array of mixed part shapes', () => {
  const result = extractMessageText({ content: [{ text: 'a' }, { value: 'b' }, 'c'] });
  assert.equal(result, 'a\nb\nc');
});

test('extractMessageText: recurses into message.messages', () => {
  const result = extractMessageText({ messages: [{ text: 'a' }, { text: 'b' }] });
  assert.equal(result, 'a\nb');
});

// ---- previewMessage ----

test('previewMessage: empty for no text', () => {
  assert.equal(previewMessage(null), '');
});

test('previewMessage: truncates with ellipsis over maxLength', () => {
  const long = 'x'.repeat(400);
  const result = previewMessage({ text: long });
  assert.ok(result.endsWith('...'));
  assert.equal(result.length, 300 + 3);
});

test('previewMessage: respects custom maxLength', () => {
  assert.equal(previewMessage({ text: 'abcdefgh' }, 3), 'abc...');
});

// ---- summarizeSnapshot (the completion detector collect.mjs uses) ----

test('summarizeSnapshot: handles empty/missing snapshot gracefully', () => {
  const summary = summarizeSnapshot({});
  assert.equal(summary.messageCount, 0);
  assert.equal(summary.assistantMessageCount, 0);
  assert.equal(summary.userMessageCount, 0);
  assert.equal(summary.pendingElicitationCount, 0);
  assert.equal(summary.lastMessageRole, undefined);
  assert.equal(summary.lastMessagePreview, '');
});

test('summarizeSnapshot: counts messages by role (top-level role)', () => {
  const snapshot = {
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'assistant', content: 'world' }
    ]
  };
  const summary = summarizeSnapshot(snapshot);
  assert.equal(summary.messageCount, 3);
  assert.equal(summary.userMessageCount, 1);
  assert.equal(summary.assistantMessageCount, 2);
  assert.equal(summary.lastMessageRole, 'assistant');
});

test('summarizeSnapshot: counts messages by info.role (nested shape)', () => {
  const snapshot = {
    messages: [
      { info: { role: 'user', text: 'hi' } },
      { info: { role: 'assistant', text: 'hello' } }
    ]
  };
  const summary = summarizeSnapshot(snapshot);
  assert.equal(summary.userMessageCount, 1);
  assert.equal(summary.assistantMessageCount, 1);
  assert.equal(summary.lastMessageRole, 'assistant');
});

test('summarizeSnapshot: reads currentModel from settings.model.current', () => {
  assert.equal(summarizeSnapshot({ settings: { model: { current: 'glm-5.2' } } }).currentModel, 'glm-5.2');
});

test('summarizeSnapshot: currentModel falls back to meta.model then currentModel', () => {
  assert.equal(summarizeSnapshot({ meta: { model: 'minimax-m3' } }).currentModel, 'minimax-m3');
  assert.equal(summarizeSnapshot({ currentModel: 'fallback-model' }).currentModel, 'fallback-model');
});

test('summarizeSnapshot: runtimeStatus falls back through runtime.activeTurnKind and meta.status', () => {
  assert.equal(summarizeSnapshot({ runtimeStatus: 'completed' }).runtimeStatus, 'completed');
  assert.equal(summarizeSnapshot({ runtime: { activeTurnKind: 'running' } }).runtimeStatus, 'running');
  assert.equal(summarizeSnapshot({ meta: { status: 'idle' } }).runtimeStatus, 'idle');
});

test('summarizeSnapshot: pendingElicitationCount from runtime.pendingElicitations', () => {
  const snapshot = { runtime: { pendingElicitations: [{ id: 1 }, { id: 2 }] } };
  assert.equal(summarizeSnapshot(snapshot).pendingElicitationCount, 2);
});

// ---- summarizeWorkspaceList ----

test('summarizeWorkspaceList: handles missing workspaces array', () => {
  const summary = summarizeWorkspaceList({ activeWorkspaceKey: 'k1' });
  assert.equal(summary.workspaceCount, 0);
  assert.equal(summary.activeWorkspaceKey, 'k1');
  assert.deepEqual(summary.workspaces, []);
});

test('summarizeWorkspaceList: maps workspaces with label fallbacks', () => {
  const list = {
    activeWorkspaceKey: 'k1',
    activeTaskId: 't1',
    workspaces: [
      { key: 'k1', name: 'Project A', tasks: [{ id: 't1', title: 'task one' }] },
      { key: 'k2', workspaceName: 'Project B', tasks: [] }
    ]
  };
  const summary = summarizeWorkspaceList(list);
  assert.equal(summary.workspaceCount, 2);
  assert.equal(summary.workspaces[0].label, 'Project A');
  assert.equal(summary.workspaces[0].taskCount, 1);
  assert.equal(summary.workspaces[1].label, 'Project B');
  assert.equal(summary.workspaces[1].taskCount, 0);
});
