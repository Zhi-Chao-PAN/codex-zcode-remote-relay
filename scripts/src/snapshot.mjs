import { openClient } from './bootstrap.mjs';
import { parseArgs } from './args.mjs';
import { summarizeSnapshot, summarizeWorkspaceList } from './session-utils.mjs';

const args = parseArgs();
const taskId = typeof args['task-id'] === 'string'
  ? args['task-id']
  : typeof args.task === 'string'
    ? args.task
    : undefined;
const workspaceKey = typeof args['workspace-key'] === 'string' ? args['workspace-key'] : undefined;

let client;

try {
  const opened = await openClient({ workspaceKey, taskId });
  client = opened.client;
  if (taskId) await client.reopenTask(taskId, { workspaceKey: workspaceKey || opened.bridge.workspaceKey });
  const snapshot = await client.getTaskSnapshot({ taskId });
  console.log(JSON.stringify({
    ok: true,
    bridge: {
      workspaceKey: opened.bridge.workspaceKey,
      workspacePath: opened.bridge.workspacePath,
      initialTaskId: client.bridge?.initialTaskId || opened.bridge.initialTaskId,
      explicitTaskId: taskId
    },
    workspaceList: summarizeWorkspaceList(opened.list),
    snapshot: summarizeSnapshot(snapshot)
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    error: error.message
  }, null, 2));
  process.exitCode = 1;
} finally {
  client?.close();
}
