export const RELAY_RESULT_SCHEMA = 'zcode-relay-result/v1';

export const RELAY_RESULT_STATUSES = new Set([
  'completed',
  'partial',
  'blocked',
  'failed'
]);

export function resultSchemaInstructions({ jobId, doneMarker }) {
  if (!jobId) throw new Error('jobId is required for result schema instructions.');
  return `Structured relay result:
- At the end of your final answer, include the exact marker line:
${doneMarker}
- Also include exactly one fenced JSON block using this schema:
\`\`\`json
{
  "schema": "${RELAY_RESULT_SCHEMA}",
  "jobId": "${jobId}",
  "status": "completed",
  "summary": "One concise paragraph.",
  "changedFiles": [],
  "inspectedFiles": [],
  "commands": [],
  "risks": [],
  "nextStep": "none",
  "suggestedNextRound": "none"
}
\`\`\`
- Use status "completed", "partial", "blocked", or "failed".
- If no files changed, keep changedFiles as [].
- Do not include secrets, tokens, API keys, remote URLs, sid/hash values, or credentials.`;
}

function asString(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => asString(item).trim())
    .filter(Boolean);
}

function commandArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => {
      if (typeof item === 'string') {
        const command = item.trim();
        return command ? { command, result: '' } : null;
      }
      if (!item || typeof item !== 'object') return null;
      const command = asString(item.command ?? item.cmd ?? item.shell ?? item.name).trim();
      const result = asString(item.result ?? item.status ?? item.output ?? item.note).trim();
      if (!command && !result) return null;
      return { command, result };
    })
    .filter(Boolean);
}

export function normalizeRelayResult(value, { jobId } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.schema !== RELAY_RESULT_SCHEMA) return null;
  const actualJobId = asString(value.jobId).trim();
  if (!actualJobId) return null;
  if (jobId && actualJobId !== jobId) return null;
  const status = asString(value.status || 'completed').trim().toLowerCase();
  if (!RELAY_RESULT_STATUSES.has(status)) return null;
  return {
    schema: RELAY_RESULT_SCHEMA,
    jobId: actualJobId,
    status,
    summary: asString(value.summary).trim(),
    changedFiles: stringArray(value.changedFiles),
    inspectedFiles: stringArray(value.inspectedFiles),
    commands: commandArray(value.commands),
    risks: stringArray(value.risks),
    nextStep: asString(value.nextStep).trim(),
    suggestedNextRound: asString(value.suggestedNextRound).trim()
  };
}

function jsonCandidates(text) {
  const candidates = [];
  const source = asString(text);
  const fencePattern = /```(?:json|JSON)?\s*([\s\S]*?)```/g;
  for (const match of source.matchAll(fencePattern)) {
    candidates.push(match[1].trim());
  }
  const trimmed = source.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) candidates.push(trimmed);
  return candidates;
}

export function extractRelayResult(text, { jobId } = {}) {
  for (const candidate of jsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate);
      const normalized = normalizeRelayResult(parsed, { jobId });
      if (normalized) return normalized;
    } catch {}
  }
  return null;
}

export function findRelayResultInTexts(texts, { jobId } = {}) {
  const list = Array.isArray(texts) ? texts : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const text = asString(list[index]);
    const result = extractRelayResult(text, { jobId });
    if (result) return { result, text, index };
  }
  return null;
}

export function isTerminalRelayResult(result) {
  return result && ['completed', 'partial', 'failed'].includes(result.status);
}
