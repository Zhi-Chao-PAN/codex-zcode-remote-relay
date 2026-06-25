import { parseArgs } from './args.mjs';
import { openClient } from './bootstrap.mjs';
import { upsertEnvValue } from './env.mjs';
import { candidateModelsForSelection, modelSelectionFromArgs } from './model-policy.mjs';
import { summarizeSnapshot } from './session-utils.mjs';

const args = parseArgs();
const selectedModel = modelSelectionFromArgs(args);
const preferred = selectedModel.requested || selectedModel.key;
const candidates = candidateModelsForSelection(selectedModel);
const mode = args.mode || 'build';
const thoughtLevel = args['thought-level'] || undefined;
const persist = args['no-persist'] !== true && args.persist !== 'false';

let client;

try {
  const opened = await openClient();
  client = opened.client;
  const attempts = [];
  let created = null;
  let usedModel = null;
  for (const candidate of candidates) {
    const model = candidate.model;
    const provider = args.provider || candidate.provider || (model.includes('/') ? model.split('/')[0] : undefined);
    try {
      created = await client.createTask({
        workspacePath: opened.bridge.workspacePath,
        workspaceIdentity: opened.bridge.workspaceIdentity,
        provider,
        mode,
        model,
        thoughtLevel
      });
      usedModel = { ...candidate, provider, model };
      attempts.push({ key: candidate.key, ok: true, billing: candidate.billing });
      break;
    } catch (error) {
      attempts.push({ key: candidate.key, ok: false, billing: candidate.billing, error: error.message });
    }
  }
  if (!created || !usedModel) throw new Error(`All model candidates failed: ${attempts.map(attempt => `${attempt.key}:${attempt.ok ? 'ok' : attempt.error}`).join('; ')}`);
  const taskId = created?.taskId || created?.sessionId || created?.id;
  let persistedEnvPath = null;
  if (persist && taskId) persistedEnvPath = upsertEnvValue('ZCODE_TASK_ID', taskId);
  if (taskId) await client.openBridge({ workspaceKey: opened.bridge.workspaceKey, taskId });
  const snapshot = taskId
    ? await client.getTaskSnapshot({ taskId, messageLimit: 20, byteBudget: 512000, toolLimit: 20 })
    : null;
  console.log(JSON.stringify({
    ok: true,
    requestedModel: preferred,
    resolvedModel: usedModel.model,
    provider: usedModel.provider,
    billing: usedModel.billing,
    policyReason: selectedModel.policyReason,
    fallbackAttempts: attempts,
    mode,
    persistedTaskId: Boolean(persist && taskId),
    persistedEnvPath,
    verifiedSnapshot: snapshot ? summarizeSnapshot(snapshot) : null,
    created
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    requestedModel: preferred,
    billing: selectedModel.billing,
    policyReason: selectedModel.policyReason,
    mode,
    error: error.message
  }, null, 2));
  process.exitCode = 1;
} finally {
  client?.close();
}
