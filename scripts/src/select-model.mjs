import fs from 'node:fs';
import { parseArgs } from './args.mjs';
import { candidateModelsForSelection, MODEL_REGISTRY, modelSelectionFromArgs } from './model-policy.mjs';

const args = parseArgs();
const content = typeof args['content-file'] === 'string'
  ? fs.readFileSync(args['content-file'], 'utf8')
  : typeof args.content === 'string'
    ? args.content
    : '';

if (args.list) {
  console.log(JSON.stringify({
    ok: true,
    models: Object.entries(MODEL_REGISTRY).map(([key, value]) => ({
      key,
      displayName: value.displayName,
      billing: value.billing,
      priority: value.priority,
      strengths: value.strengths
    }))
  }, null, 2));
  process.exit(0);
}

const selected = modelSelectionFromArgs(args, { content });
console.log(JSON.stringify({
  ok: true,
  selection: selected,
  fallbackOrder: candidateModelsForSelection(selected).map(candidate => ({
    key: candidate.key,
    displayName: candidate.displayName,
    billing: candidate.billing,
    isPrimary: candidate.isPrimary
  }))
}, null, 2));
