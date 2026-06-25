import { randomUUID } from 'node:crypto';
import { openClient } from './bootstrap.mjs';
import { summarizeSnapshot } from './session-utils.mjs';

let client;

try {
  const opened = await openClient();
  client = opened.client;
  const before = await client.getTaskSnapshot({});
  const testId = `BRIDGE_RELAY_TEST_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
  await client.sendPrompt({
    content: `Codex relay connectivity test. Please reply exactly: ACK ${testId}`,
    traceId: randomUUID(),
    queryId: randomUUID(),
    messageId: randomUUID()
  });

  const deadline = Date.now() + 60000;
  let after = null;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    after = await client.getTaskSnapshot({});
    if (JSON.stringify(after).includes(testId)) break;
  }

  console.log(JSON.stringify({
    ok: true,
    testId,
    modelBefore: summarizeSnapshot(before).currentModel,
    bridge: {
      workspaceKey: opened.bridge.workspaceKey,
      initialTaskId: opened.bridge.initialTaskId
    },
    foundTestIdInSnapshot: after ? JSON.stringify(after).includes(testId) : false,
    snapshot: after ? summarizeSnapshot(after) : null
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
