import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  base64ToBytes,
  bytesToBase64,
  decodeFrameValues,
  encodeValue
} from '../src/rpc-codec.mjs';
import { ZCodeRemoteClient } from '../src/zcode-remote-client.mjs';

function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function rpcResponse(id, body) {
  return bytesToBase64(concat([
    encodeValue([201, id]),
    encodeValue(body)
  ]));
}

class FakeWebSocket {
  static OPEN = 1;

  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = new Map();
    this.sent = [];
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.emit('open', {});
    });
  }

  addEventListener(type, listener, options = {}) {
    const list = this.listeners.get(type) || [];
    list.push({ listener, once: Boolean(options.once) });
    this.listeners.set(type, list);
  }

  emit(type, event) {
    const list = [...(this.listeners.get(type) || [])];
    for (const entry of list) {
      entry.listener(event);
      if (entry.once) {
        const current = this.listeners.get(type) || [];
        this.listeners.set(type, current.filter(item => item !== entry));
      }
    }
  }

  emitMessage(message) {
    this.emit('message', { data: JSON.stringify(message) });
  }

  send(raw) {
    const message = JSON.parse(raw);
    this.sent.push(message);
    if (message.type === 'auth_init') {
      this.emitMessage({ type: 'auth_challenge', nonce: 'nonce-1' });
      return;
    }
    if (message.type === 'auth_response') {
      this.emitMessage({ type: 'auth_ack', pair_status: 'matched' });
      return;
    }
    if (message.type !== 'data') return;

    const payload = message.payload;
    if (payload.zcode_type === 'workspace-list-request') {
      this.emitMessage({
        type: 'data',
        payload: {
          zcode_type: 'workspace-list-response',
          requestId: payload.requestId,
          result: {
            activeWorkspaceKey: 'workspace-a',
            activeTaskId: 'task-a',
            workspaces: [
              { key: 'workspace-a', label: 'Workspace A', tasks: [{ id: 'task-a', title: 'Task A' }] }
            ]
          }
        }
      });
      return;
    }
    if (payload.zcode_type === 'workspace-bridge-open') {
      this.emitMessage({
        type: 'data',
        payload: {
          zcode_type: 'workspace-bridge-ready',
          bridgeSessionId: payload.bridgeSessionId,
          bridge: {
            bridgeSessionId: payload.bridgeSessionId,
            bridgeGeneration: payload.bridgeGeneration,
            workspaceKey: payload.workspaceKey,
            workspacePath: 'C:\\fake\\workspace',
            initialTaskId: payload.taskId || 'task-a'
          }
        }
      });
      return;
    }
    if (payload.zcode_type === 'rpc-frame') {
      const [header, args] = decodeFrameValues(base64ToBytes(payload.dataBase64));
      const [, id, channel, method] = header;
      this.emitMessage({
        type: 'data',
        payload: {
          zcode_type: 'rpc-frame',
          bridgeSessionId: payload.bridgeSessionId,
          dataBase64: rpcResponse(id, { channel, method, args })
        }
      });
    }
  }

  close() {
    this.readyState = 3;
  }
}

test('ZCodeRemoteClient completes fake auth, bridge, and RPC round-trip', async (t) => {
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket;
  t.after(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  const client = new ZCodeRemoteClient({
    remoteUrl: 'https://zcode.z.ai/remote/v3?sid=sid&hash=hash&mid=mid&app_version=test',
    timeoutMs: 1000
  });

  const opened = await client.connectAndOpen();
  assert.equal(client.state, 'paired');
  assert.equal(opened.bridge.initialTaskId, 'task-a');
  assert.equal(opened.list.activeWorkspaceKey, 'workspace-a');

  const result = await client.rpc('zcode-task', 'getTaskSnapshot', [{ taskId: 'task-a' }]);
  assert.deepEqual(result, {
    channel: 'zcode-task',
    method: 'getTaskSnapshot',
    args: [{ taskId: 'task-a' }]
  });
  assert.equal(client.rpcId, 1);
  assert.equal(client.rpcSeq, 1);

  client.close();
});

test('ZCodeRemoteClient redacts remote URL search params', () => {
  const client = new ZCodeRemoteClient({
    remoteUrl: 'https://zcode.z.ai/remote/v3?sid=sid&hash=hash&mid=mid&name=test'
  });
  assert.equal(
    client.safeRemoteUrl,
    'https://zcode.z.ai/remote/v3?sid=%3Credacted%3E&hash=%3Credacted%3E&mid=%3Credacted%3E&name=%3Credacted%3E'
  );
});
