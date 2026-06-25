import { parseArgs } from './args.mjs';
import { openClient } from './bootstrap.mjs';
import { summarizeSnapshot } from './session-utils.mjs';
import { modelSelectionFromArgs } from './model-policy.mjs';

const args = parseArgs();
const selectedModel = modelSelectionFromArgs(args);
const preferred = selectedModel.requested || selectedModel.key;
const model = selectedModel.model;

if (!model) {
  console.error('Missing --model or ZCODE_PREFERRED_MODEL.');
  process.exit(2);
}

let client;

try {
  const opened = await openClient();
  client = opened.client;
  const before = await client.getTaskSnapshot({ messageLimit: 20, byteBudget: 512000, toolLimit: 20 });
  await client.resumeTask({ model });
  await new Promise(resolve => setTimeout(resolve, 1500));
  const after = await client.getTaskSnapshot({ messageLimit: 20, byteBudget: 512000, toolLimit: 20 });
  console.log(JSON.stringify({
    ok: true,
    requestedModel: preferred,
    resolvedModel: model,
    provider: selectedModel.provider,
    billing: selectedModel.billing,
    policyReason: selectedModel.policyReason,
    before: summarizeSnapshot(before),
    after: summarizeSnapshot(after)
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    requestedModel: preferred,
    resolvedModel: model,
    provider: selectedModel.provider,
    billing: selectedModel.billing,
    policyReason: selectedModel.policyReason,
    error: error.message
  }, null, 2));
  process.exitCode = 1;
} finally {
  client?.close();
}
