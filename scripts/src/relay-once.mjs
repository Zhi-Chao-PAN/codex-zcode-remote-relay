import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { parseArgs } from './args.mjs';
import { openClient } from './bootstrap.mjs';
import { optionalIntEnv } from './env.mjs';
import { summarizeSnapshot } from './session-utils.mjs';

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

let client;

try {
  const opened = await openClient();
  client = opened.client;
  const before = await client.getTaskSnapshot({});
  await client.sendPrompt({
    content,
    traceId: randomUUID(),
    queryId: randomUUID(),
    messageId: randomUUID()
  });

  const pollMs = optionalIntEnv('ZCODE_POLL_INTERVAL_MS', 3000);
  const deadline = Date.now() + optionalIntEnv('ZCODE_RELAY_TIMEOUT_MS', 180000);
  let snapshot = before;
  let summary = summarizeSnapshot(snapshot);
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, pollMs));
    snapshot = await client.getTaskSnapshot({});
    summary = summarizeSnapshot(snapshot);
    if (summary.messageCount > summarizeSnapshot(before).messageCount && summary.lastMessageRole === 'assistant') {
      break;
    }
  }

  console.log(JSON.stringify({
    ok: true,
    before: summarizeSnapshot(before),
    after: summary
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
