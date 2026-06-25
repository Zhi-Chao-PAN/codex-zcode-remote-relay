import { openClient } from './bootstrap.mjs';
import { summarizeWorkspaceList } from './session-utils.mjs';

const startedAt = Date.now();
let client;

try {
  ({ client } = await openClient());
  const list = await client.listWorkspaces();
  console.log(JSON.stringify({
    ok: true,
    state: client.state,
    elapsedMs: Date.now() - startedAt,
    workspaceList: summarizeWorkspaceList(list)
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
