import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './args.mjs';
import { openClient } from './bootstrap.mjs';
import {
  contentDigest,
  markerFor,
  newJobId,
  preview,
  saveHandoff,
  saveJob
} from './job-store.mjs';
import { normalizeList, normalizePoolType } from './pool-policy.mjs';
import { summarizeSnapshot } from './session-utils.mjs';
import { candidateModelsForSelection, modelSelectionFromArgs } from './model-policy.mjs';
import { RELAY_RESULT_SCHEMA, resultSchemaInstructions } from './result-schema.mjs';

const args = parseArgs();
const content = typeof args['content-file'] === 'string'
  ? fs.readFileSync(args['content-file'], 'utf8')
  : typeof args.content === 'string'
    ? args.content
    : '';

if (!content.trim()) {
  console.error('Missing --content or --content-file.');
  process.exit(2);
}

const selectedModel = modelSelectionFromArgs(args, { content });
const preferred = selectedModel.requested || selectedModel.key;
const candidates = candidateModelsForSelection(selectedModel);
const mode = args.mode || 'build';
const reuseCurrentTask = args['reuse-current-task'] === true;
const jobId = typeof args['job-id'] === 'string' ? args['job-id'] : newJobId();
const doneMarker = markerFor(jobId);
const poolId = typeof args['pool-id'] === 'string' ? args['pool-id'] : null;
const workerId = typeof args['worker-id'] === 'string' ? args['worker-id'] : null;
const roundId = typeof args['round-id'] === 'string' ? args['round-id'] : null;
const poolType = typeof args['pool-type'] === 'string' ? normalizePoolType(args['pool-type']) : null;
const scope = typeof args.scope === 'string' ? args.scope : '';
const ownedFiles = normalizeList(args['owned-files']);
const readOnlyFiles = normalizeList(args['read-only-files']);
const forbiddenFiles = normalizeList(args['forbidden-files']);
const validationGate = typeof args['validation-gate'] === 'string' ? args['validation-gate'] : '';
const editMode = typeof args['edit-mode'] === 'string' ? args['edit-mode'] : null;
const trustedRoot = typeof args['trusted-root'] === 'string' ? args['trusted-root'] : null;
const editModeReason = typeof args['edit-mode-reason'] === 'string' ? args['edit-mode-reason'] : '';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const statusScript = path.join(scriptDir, 'status.mjs');
const collectScript = path.join(scriptDir, 'collect.mjs');

const finalPrompt = `${content.trim()}

Relay metadata:
- jobId: ${jobId}
${poolId ? `- poolId: ${poolId}\n` : ''}${workerId ? `- workerId: ${workerId}\n` : ''}${roundId ? `- roundId: ${roundId}\n` : ''}${editMode ? `- editMode: ${editMode}\n` : ''}${trustedRoot ? `- trustedRoot: ${trustedRoot}\n` : ''}- When the task is complete, include this exact line in your final answer:
${doneMarker}

${resultSchemaInstructions({ jobId, doneMarker })}
`;

let client;

try {
  const opened = await openClient({ lockOwner: `dispatch:${jobId}` });
  client = opened.client;

  let taskId = opened.bridge.initialTaskId;
  let created = null;
  let usedModel = selectedModel;
  let attempts = [];
  if (!reuseCurrentTask) {
    for (const candidate of candidates) {
      const model = candidate.model;
      const provider = args.provider || candidate.provider || (model.includes('/') ? model.split('/')[0] : undefined);
      try {
        created = await client.createTask({
          workspacePath: opened.bridge.workspacePath,
          workspaceIdentity: opened.bridge.workspaceIdentity,
          provider,
          mode,
          model
        });
        usedModel = { ...candidate, provider, model };
        attempts.push({ key: candidate.key, ok: true, billing: candidate.billing });
        break;
      } catch (error) {
        attempts.push({ key: candidate.key, ok: false, billing: candidate.billing, error: error.message });
      }
    }
    if (!created || !usedModel) throw new Error(`All model candidates failed: ${attempts.map(attempt => `${attempt.key}:${attempt.ok ? 'ok' : attempt.error}`).join('; ')}`);
    taskId = created?.taskId || created?.sessionId || created?.id;
    if (!taskId) throw new Error('createTask did not return a task id.');
    await client.openBridge({ workspaceKey: opened.bridge.workspaceKey, taskId });
  }

  const before = await client.getTaskSnapshot({ messageLimit: 200, byteBudget: 1024 * 1024, toolLimit: 50 });
  const beforeSummary = summarizeSnapshot(before);
  const actualModel = beforeSummary.currentModel || created?.model || usedModel.model;
  const modelMatchesRequest = actualModel === usedModel.model || actualModel === usedModel.requested || actualModel === usedModel.key;
  await client.sendPrompt({
    content: finalPrompt,
    taskId,
    traceId: randomUUID(),
    queryId: randomUUID(),
    messageId: randomUUID()
  });

  const handoffFile = saveHandoff(jobId, finalPrompt);
  const job = saveJob({
    schemaVersion: 3,
    jobId,
    state: 'dispatched',
    routeState: 'dispatched',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    taskId,
    workspaceKey: opened.bridge.workspaceKey,
    workspacePath: opened.bridge.workspacePath,
    poolId,
    poolType,
    workerId,
    roundId,
    scope,
    editMode,
    trustedRoot,
    editModeReason,
    ownedFiles,
    readOnlyFiles,
    forbiddenFiles,
    validationGate,
    requestedModel: preferred,
    resolvedModel: usedModel.model,
    actualModel,
    modelMatchesRequest,
    provider: usedModel.provider,
    billing: usedModel.billing,
    policyReason: selectedModel.policyReason,
    fallbackAttempts: attempts,
    mode,
    doneMarker,
    resultSchema: RELAY_RESULT_SCHEMA,
    handoffFile,
    contentSha256: contentDigest(finalPrompt),
    contentPreview: preview(content),
    before: {
      messageCount: beforeSummary.messageCount,
      assistantMessageCount: beforeSummary.assistantMessageCount,
      currentModel: beforeSummary.currentModel,
      title: beforeSummary.title
    },
    createdTask: created ? {
      taskId,
      title: created.title,
      model: created.model,
      provider: created.provider
    } : null
  });

  console.log(JSON.stringify({
    ok: true,
    jobId,
    state: job.state,
    routeState: job.routeState,
    taskId,
    poolId,
    workerId,
    roundId,
    scope,
    editMode,
    trustedRoot,
    currentModel: beforeSummary.currentModel,
    requestedModel: preferred,
    resolvedModel: usedModel.model,
    actualModel,
    modelMatchesRequest,
    provider: usedModel.provider,
    billing: usedModel.billing,
    policyReason: selectedModel.policyReason,
    fallbackAttempts: attempts,
    createdNewTask: !reuseCurrentTask,
    doneMarker,
    resultSchema: RELAY_RESULT_SCHEMA,
    next: {
      status: `node "${statusScript}" --job ${jobId}`,
      collect: `node "${collectScript}" --job ${jobId}`
    }
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    jobId,
    poolId,
    workerId,
    error: error.message
  }, null, 2));
  process.exitCode = 1;
} finally {
  client?.close();
}
