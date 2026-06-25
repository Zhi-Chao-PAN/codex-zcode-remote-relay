import { loadEnv, optionalIntEnv, requireEnv } from './env.mjs';
import { acquireRelayLock } from './relay-lock.mjs';
import { ZCodeRemoteClient } from './zcode-remote-client.mjs';

export async function openClient({ workspaceKey, taskId, lockOwner = 'openClient' } = {}) {
  loadEnv();
  const lock = await acquireRelayLock({ owner: lockOwner });
  const client = new ZCodeRemoteClient({
    remoteUrl: requireEnv('ZCODE_REMOTE_URL'),
    timeoutMs: optionalIntEnv('ZCODE_TIMEOUT_MS', 30000)
  });

  let released = false;
  const releaseLock = () => {
    if (released) return;
    released = true;
    lock.release();
  };
  const close = client.close.bind(client);
  client.close = () => {
    try {
      return close();
    } finally {
      releaseLock();
    }
  };

  try {
    const selectedWorkspaceKey = workspaceKey || process.env.ZCODE_WORKSPACE_KEY?.trim() || undefined;
    const selectedTaskId = taskId || process.env.ZCODE_TASK_ID?.trim() || undefined;
    const opened = await client.connectAndOpen({ workspaceKey: selectedWorkspaceKey, taskId: selectedTaskId });
    return { client, ...opened };
  } catch (error) {
    client.close();
    throw error;
  }
}
