import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from './args.mjs';
import { openClient } from './bootstrap.mjs';
import { loadJob, resultsDir, updateJob } from './job-store.mjs';
import { extractMessageText, summarizeSnapshot } from './session-utils.mjs';
import { findRelayResultInTexts, isTerminalRelayResult } from './result-schema.mjs';

const args = parseArgs();
const jobId = args.job || args['job-id'];
if (!jobId || typeof jobId !== 'string') {
  console.error('Missing --job <jobId>.');
  process.exit(2);
}

function ensureResultsDir() {
  const dir = resultsDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function stateFromError(error) {
  return /timed out|timeout/i.test(error.message) ? 'timeout' : 'error';
}

let client;

try {
  const job = loadJob(jobId);
  const opened = await openClient({ lockOwner: `collect:${jobId}` });
  client = opened.client;
  await client.reopenTask(job.taskId, { workspaceKey: job.workspaceKey });
  const snapshot = await client.getTaskSnapshot({ messageLimit: 300, byteBudget: 2 * 1024 * 1024, toolLimit: 80 });
  const summary = summarizeSnapshot(snapshot);
  const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : [];
  const afterMessages = messages.slice(job.before?.messageCount ?? 0);
  const assistantAfter = afterMessages.filter(message => (message.role || message.info?.role) === 'assistant');
  const assistantTexts = assistantAfter.map(message => extractMessageText(message));
  const structured = findRelayResultInTexts(assistantTexts, { jobId });
  const markerAssistant = [...assistantAfter].reverse().find(message => extractMessageText(message).includes(job.doneMarker));
  const lastAssistant = markerAssistant || assistantAfter.at(-1);
  const resultText = structured?.text || extractMessageText(lastAssistant);
  const markerFound = assistantTexts.some(text => text.includes(job.doneMarker));
  const completed = isTerminalRelayResult(structured?.result) || markerFound || assistantAfter.length > 0 && summary.runtimeStatus === 'completed';
  const blocked = structured?.result?.status === 'blocked' || !completed && Number(summary.pendingElicitationCount || 0) > 0;
  const state = completed ? 'collected' : blocked ? 'blocked' : 'running';
  const resultPath = path.join(ensureResultsDir(), `${jobId}.md`);
  const report = `# ZCode Relay Result

Job: ${jobId}
State: ${state}
Task: ${job.taskId}
Pool: ${job.poolId || 'none'}
Worker: ${job.workerId || 'none'}
Round: ${job.roundId || 'none'}
Model: ${summary.currentModel ?? 'unknown'}
Marker Found: ${markerFound}
Structured Result Found: ${Boolean(structured?.result)}
Worker Status: ${structured?.result?.status || 'unknown'}

${structured?.result ? `## Structured Result

\`\`\`json
${JSON.stringify(structured.result, null, 2)}
\`\`\`

` : ''}## Worker Result

${resultText || '(No assistant result yet.)'}
`;
  fs.writeFileSync(resultPath, report, 'utf8');
  updateJob(jobId, {
    state,
    routeState: state,
    error: undefined,
    collectedAt: completed ? new Date().toISOString() : undefined,
    resultPath,
    markerFound,
    structuredResultFound: Boolean(structured?.result),
    structuredResult: structured?.result || null,
    workerStatus: structured?.result?.status,
    lastSnapshot: {
      title: summary.title,
      runtimeStatus: summary.runtimeStatus,
      currentModel: summary.currentModel,
      messageCount: summary.messageCount,
      assistantMessageCount: summary.assistantMessageCount,
      pendingElicitationCount: summary.pendingElicitationCount
    }
  });

  console.log(JSON.stringify({
    ok: true,
    jobId,
    state,
    routeState: state,
    markerFound,
    structuredResultFound: Boolean(structured?.result),
    workerStatus: structured?.result?.status,
    structuredResult: structured?.result || null,
    resultPath,
    snapshot: summary,
    resultPreview: resultText.length > 800 ? `${resultText.slice(0, 800)}...` : resultText
  }, null, 2));
} catch (error) {
  const state = stateFromError(error);
  try {
    updateJob(jobId, {
      state,
      routeState: state,
      error: error.message,
      lastCheckedAt: new Date().toISOString()
    });
  } catch {}
  console.log(JSON.stringify({
    ok: false,
    jobId,
    state,
    error: error.message
  }, null, 2));
  process.exitCode = 1;
} finally {
  client?.close();
}

