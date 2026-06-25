import { parseArgs } from './args.mjs';
import { openClient } from './bootstrap.mjs';
import { loadJob, updateJob } from './job-store.mjs';
import { extractMessageText, summarizeSnapshot } from './session-utils.mjs';
import { findRelayResultInTexts, isTerminalRelayResult } from './result-schema.mjs';

const args = parseArgs();
const jobId = args.job || args['job-id'];
if (!jobId || typeof jobId !== 'string') {
  console.error('Missing --job <jobId>.');
  process.exit(2);
}

function analyze(job, snapshot) {
  const summary = summarizeSnapshot(snapshot);
  const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : [];
  const afterMessages = messages.slice(job.before?.messageCount ?? 0);
  const assistantAfter = afterMessages.filter(message => (message.role || message.info?.role) === 'assistant');
  const lastAssistant = assistantAfter.at(-1);
  const lastAssistantText = extractMessageText(lastAssistant);
  const assistantTexts = assistantAfter.map(message => extractMessageText(message));
  const structured = findRelayResultInTexts(assistantTexts, { jobId: job.jobId });
  const markerFound = assistantTexts.some(text => text.includes(job.doneMarker));
  const completed = isTerminalRelayResult(structured?.result) || markerFound || summary.runtimeStatus === 'completed' && assistantAfter.length > 0;
  const blocked = structured?.result?.status === 'blocked' || !completed && Number(summary.pendingElicitationCount || 0) > 0;
  return {
    summary,
    completed,
    blocked,
    markerFound,
    structuredResultFound: Boolean(structured?.result),
    structuredResult: structured?.result || null,
    assistantAfterCount: assistantAfter.length,
    lastAssistantText
  };
}

function stateFromError(error) {
  return /timed out|timeout/i.test(error.message) ? 'timeout' : 'error';
}

let client;

try {
  const job = loadJob(jobId);
  const opened = await openClient({ lockOwner: `status:${jobId}` });
  client = opened.client;
  await client.reopenTask(job.taskId, { workspaceKey: job.workspaceKey });
  const snapshot = await client.getTaskSnapshot({ messageLimit: 300, byteBudget: 2 * 1024 * 1024, toolLimit: 80 });
  const analysis = analyze(job, snapshot);
  const state = analysis.completed ? 'completed' : analysis.blocked ? 'blocked' : 'running';
  updateJob(jobId, {
    state,
    routeState: state,
    lastCheckedAt: new Date().toISOString(),
    lastSnapshot: {
      title: analysis.summary.title,
      runtimeStatus: analysis.summary.runtimeStatus,
      currentModel: analysis.summary.currentModel,
      messageCount: analysis.summary.messageCount,
      assistantMessageCount: analysis.summary.assistantMessageCount,
      pendingElicitationCount: analysis.summary.pendingElicitationCount,
      markerFound: analysis.markerFound,
      structuredResultFound: analysis.structuredResultFound,
      workerStatus: analysis.structuredResult?.status
    }
  });

  console.log(JSON.stringify({
    ok: true,
    jobId,
    state,
    routeState: state,
    markerFound: analysis.markerFound,
    structuredResultFound: analysis.structuredResultFound,
    workerStatus: analysis.structuredResult?.status,
    structuredResult: analysis.structuredResult,
    assistantAfterCount: analysis.assistantAfterCount,
    snapshot: analysis.summary,
    lastAssistantPreview: analysis.lastAssistantText.length > 500
      ? `${analysis.lastAssistantText.slice(0, 500)}...`
      : analysis.lastAssistantText
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

