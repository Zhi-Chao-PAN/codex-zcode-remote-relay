import { createHmac, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  base64ToBytes,
  bytesToBase64,
  decodeResponse,
  encodeRequest
} from './rpc-codec.mjs';

const DEFAULT_RELAY_WS_URL = 'wss://zcode.z.ai/ws';

function timeout(ms, message) {
  let timer;
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return { promise, clear: () => clearTimeout(timer) };
}

function requestId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function redactUrl(url) {
  const parsed = new URL(url);
  for (const key of [...parsed.searchParams.keys()]) parsed.searchParams.set(key, '<redacted>');
  return parsed.toString();
}

export class ZCodeRemoteClient extends EventEmitter {
  constructor({ remoteUrl, timeoutMs = 30000 } = {}) {
    super();
    if (!remoteUrl) throw new Error('remoteUrl is required.');
    this.remoteUrl = remoteUrl;
    this.timeoutMs = timeoutMs;
    this.config = this.parseRemoteUrl(remoteUrl);
    this.ws = null;
    this.state = 'idle';
    this.pendingPayloads = new Set();
    this.pendingRpc = new Map();
    this.rpcSeq = 0;
    this.rpcId = 0;
    this.bridge = null;
  }

  parseRemoteUrl(remoteUrl) {
    const parsed = new URL(remoteUrl);
    const deviceSid = parsed.searchParams.get('sid');
    const passHash = parsed.searchParams.get('hash');
    const deviceMid = parsed.searchParams.get('mid');
    const appVersion = parsed.searchParams.get('app_version') || 'web-remote';
    const name = parsed.searchParams.get('name') || 'mobile-browser';
    if (!deviceSid || !passHash || !deviceMid) {
      throw new Error('ZCode remote URL must contain sid, hash, and mid.');
    }
    return { deviceSid, passHash, deviceMid, appVersion, name };
  }

  get safeRemoteUrl() {
    return redactUrl(this.remoteUrl);
  }

  async connect() {
    if (this.state === 'paired') return;

    const wsUrl = new URL(DEFAULT_RELAY_WS_URL);
    wsUrl.searchParams.set('mid', this.config.deviceMid);

    this.ws = new WebSocket(wsUrl.toString());
    this.state = 'connecting';
    this.ws.addEventListener('message', event => {
      this.handleMessage(event.data).catch(error => this.emit('error', error));
    });

    await this.waitForSocketOpen();
    this.sendRaw({
      type: 'auth_init',
      role: 'terminal',
      device_sid: this.config.deviceSid,
      meta: {
        platform: 'web',
        version: this.config.appVersion,
        name: 'mobile-browser'
      },
      client_ts: Date.now()
    });

    await this.waitForState('paired', this.timeoutMs);
  }

  async waitForSocketOpen() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    const waiter = timeout(this.timeoutMs, 'Timed out opening ZCode WebSocket.');
    await Promise.race([
      waiter.promise,
      new Promise((resolve, reject) => {
        this.ws.addEventListener('open', resolve, { once: true });
        this.ws.addEventListener('error', () => reject(new Error('ZCode WebSocket error.')), { once: true });
      })
    ]).finally(waiter.clear);
  }

  async handleMessage(raw) {
    const text = typeof raw === 'string' ? raw : await raw.text?.() ?? String(raw);
    const message = JSON.parse(text);

    if (message.type === 'auth_challenge') {
      const proof = createHmac('sha256', this.config.passHash)
        .update(`${message.nonce}|terminal|${this.config.deviceSid}`)
        .digest('base64url');
      this.sendRaw({
        type: 'auth_response',
        device_sid: this.config.deviceSid,
        proof,
        client_ts: Date.now()
      });
      return;
    }

    if (message.type === 'auth_ack' || message.type === 'pair_status_ack') {
      this.state = message.pair_status === 'matched' ? 'paired' : message.pair_status || this.state;
      this.emit(`state:${this.state}`, this.state);
      return;
    }

    if (message.type === 'data') {
      this.handlePayload(message.payload);
      return;
    }

    if (message.type === 'error') {
      this.emit('error', new Error(message.message || message.code || 'ZCode relay error.'));
    }
  }

  sendRaw(message) {
    this.ws.send(JSON.stringify(message));
  }

  sendPayload(payload) {
    if (this.state !== 'paired') throw new Error(`ZCode relay is not paired; current state=${this.state}`);
    this.sendRaw({ type: 'data', payload, client_ts: Date.now() });
  }

  waitForState(state, ms) {
    if (this.state === state) return Promise.resolve();
    const waiter = timeout(ms, `Timed out waiting for ZCode state: ${state}`);
    return Promise.race([
      waiter.promise,
      new Promise(resolve => this.once(`state:${state}`, resolve))
    ]).finally(waiter.clear);
  }

  requestPayload(payload, predicate, { timeoutMs = this.timeoutMs } = {}) {
    const waiter = {
      predicate,
      resolve: null,
      reject: null
    };
    const timer = timeout(timeoutMs, `Timed out waiting for payload response: ${payload.zcode_type}`);
    const promise = Promise.race([
      timer.promise,
      new Promise((resolve, reject) => {
        waiter.resolve = resolve;
        waiter.reject = reject;
        this.pendingPayloads.add(waiter);
      })
    ]).finally(() => {
      timer.clear();
      this.pendingPayloads.delete(waiter);
    });
    this.sendPayload(payload);
    return promise;
  }

  handlePayload(payload) {
    if (payload?.zcode_type === 'rpc-frame') {
      this.handleRpcFrame(payload);
      return;
    }
    for (const waiter of [...this.pendingPayloads]) {
      if (waiter.predicate(payload)) {
        waiter.resolve(payload);
        this.pendingPayloads.delete(waiter);
      }
    }
  }

  async listWorkspaces() {
    const id = requestId('workspace-list');
    const response = await this.requestPayload(
      { zcode_type: 'workspace-list-request', requestId: id },
      payload => payload?.zcode_type === 'workspace-list-response' && payload.requestId === id
    );
    return response.result;
  }

  async openBridge({ workspaceKey, taskId } = {}) {
    const bridgeSessionId = requestId('bridge');
    const request = {
      zcode_type: 'workspace-bridge-open',
      requestId: requestId('workspace-bridge'),
      bridgeSessionId,
      bridgeGeneration: 1,
      workspaceKey,
      ...(taskId ? { taskId } : {})
    };

    const response = await this.requestPayload(
      request,
      payload => payload?.zcode_type === 'workspace-bridge-ready' && payload.bridgeSessionId === bridgeSessionId
    );
    this.bridge = response.bridge;
    this.rpcSeq = 0;
    this.rpcId = 0;
    return this.bridge;
  }

  rpc(channelName, methodName, args = [], { timeoutMs = this.timeoutMs } = {}) {
    if (!this.bridge) throw new Error('Bridge is not open.');
    // Monotonic id guarantees no collision in pendingRpc even under rapid
    // successive calls. The previous Math.random()*1e9 could collide and
    // cause one call to resolve another's response.
    this.rpcId += 1;
    const id = this.rpcId;
    const frame = encodeRequest(id, channelName, methodName, args);
    const timer = timeout(timeoutMs, `Timed out waiting for RPC ${channelName}.${methodName}`);
    const promise = Promise.race([
      timer.promise,
      new Promise((resolve, reject) => {
        this.pendingRpc.set(id, { resolve, reject });
      })
    ]).finally(() => {
      timer.clear();
      this.pendingRpc.delete(id);
    });

    this.rpcSeq += 1;
    this.sendPayload({
      zcode_type: 'rpc-frame',
      bridgeSessionId: this.bridge.bridgeSessionId,
      bridgeGeneration: this.bridge.bridgeGeneration,
      seq: this.rpcSeq,
      dataBase64: bytesToBase64(frame)
    });

    return promise;
  }

  handleRpcFrame(payload) {
    if (!this.bridge || payload.bridgeSessionId !== this.bridge.bridgeSessionId) return;
    const decoded = decodeResponse(base64ToBytes(payload.dataBase64));
    if (!Array.isArray(decoded.header)) return;
    const [kind, id] = decoded.header;
    const value = decoded.body;
    if (kind === 200) return;
    const pending = this.pendingRpc.get(id);
    if (!pending) return;
    if (kind === 201) pending.resolve(value);
    else {
      const detail = typeof value === 'string' ? value : JSON.stringify(value);
      pending.reject(new Error(detail || `RPC error kind=${kind}`));
    }
  }

  async connectAndOpen({ workspaceKey, taskId } = {}) {
    await this.connect();
    const list = await this.listWorkspaces();
    const selectedWorkspaceKey = workspaceKey || list.activeWorkspaceKey || list.workspaces?.[0]?.key;
    const selectedTaskId = taskId || list.activeTaskId || list.workspaces?.[0]?.tasks?.[0]?.id;
    if (!selectedWorkspaceKey) throw new Error('No active ZCode workspace found.');
    const bridge = await this.openBridge({ workspaceKey: selectedWorkspaceKey, taskId: selectedTaskId });
    return { list, bridge };
  }

  async reopenTask(taskId, { workspaceKey } = {}) {
    const list = await this.listWorkspaces();
    const selectedWorkspaceKey = workspaceKey || list.activeWorkspaceKey || this.bridge?.workspaceKey || list.workspaces?.[0]?.key;
    if (!selectedWorkspaceKey) throw new Error('No active ZCode workspace found.');
    const bridge = await this.openBridge({ workspaceKey: selectedWorkspaceKey, taskId });
    return { list, bridge };
  }

  async getTaskSnapshot({ taskId, workspacePath, workspaceIdentity, ...extra } = {}) {
    const bridge = this.bridge || {};
    const args = [{
      taskId: taskId || bridge.initialTaskId,
      workspacePath: workspacePath || bridge.workspacePath,
      ...(workspaceIdentity || bridge.workspaceIdentity ? { workspaceIdentity: workspaceIdentity || bridge.workspaceIdentity } : {}),
      clientMode: 'web-remote-replayable',
      ...extra
    }];
    return this.rpc('zcode-task', 'getTaskSnapshot', args);
  }

  async sendPrompt({ content, taskId, traceId, queryId, messageId, attachments = [] }) {
    const activeTaskId = taskId || this.bridge?.initialTaskId;
    if (!activeTaskId) throw new Error('No active task id available for sendPrompt.');
    return this.rpc('zcode-task', 'sendPrompt', [{
      taskId: activeTaskId,
      traceId: traceId || randomUUID(),
      queryId: queryId || randomUUID(),
      messageId: messageId || randomUUID(),
      content,
      attachments,
      clientMode: 'web-remote-replayable',
      clientId: 'codex-zcode-remote-relay',
      clientLabel: 'Codex Relay'
    }]);
  }

  async resumeTask({ taskId, workspacePath, workspaceIdentity, model, thoughtLevel, mcpServers } = {}) {
    const activeTaskId = taskId || this.bridge?.initialTaskId;
    if (!activeTaskId) throw new Error('No active task id available for resumeTask.');
    return this.rpc('zcode-task', 'resumeTask', [{
      taskId: activeTaskId,
      workspacePath: workspacePath || this.bridge?.workspacePath,
      ...(workspaceIdentity || this.bridge?.workspaceIdentity ? { workspaceIdentity: workspaceIdentity || this.bridge.workspaceIdentity } : {}),
      ...(model ? { model } : {}),
      ...(thoughtLevel ? { thoughtLevel } : {}),
      ...(Array.isArray(mcpServers) ? { mcpServers } : {})
    }]);
  }

  async createTask({ workspacePath, workspaceIdentity, provider, mode = 'build', model, thoughtLevel, mcpServers, draftSessionId } = {}) {
    return this.rpc('zcode-task', 'createTask', [{
      workspacePath: workspacePath || this.bridge?.workspacePath,
      ...(workspaceIdentity || this.bridge?.workspaceIdentity ? { workspaceIdentity: workspaceIdentity || this.bridge.workspaceIdentity } : {}),
      ...(provider ? { provider } : {}),
      mode,
      ...(model ? { model } : {}),
      ...(thoughtLevel ? { thoughtLevel } : {}),
      ...(Array.isArray(mcpServers) ? { mcpServers } : {}),
      ...(draftSessionId ? { draftSessionId } : {})
    }]);
  }

  close() {
    this.ws?.close();
    this.ws = null;
    this.state = 'closed';
  }
}
