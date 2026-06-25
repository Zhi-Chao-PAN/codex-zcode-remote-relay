import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, optionalIntEnv, requireEnv } from './env.mjs';
import { parseArgs } from './args.mjs';
import { withRelayLock } from './relay-lock.mjs';
import { ZCodeRemoteClient } from './zcode-remote-client.mjs';
import { summarizeWorkspaceList } from './session-utils.mjs';

function runPowerShell(scriptPath, args = []) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      ...args
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `PowerShell exited with code ${code}`));
        return;
      }
      resolvePromise(stdout.trim());
    });
  });
}

async function quickDoctor(timeoutMs) {
  return withRelayLock('prepare.quickDoctor', async () => {
    loadEnv();
    const client = new ZCodeRemoteClient({
      remoteUrl: requireEnv('ZCODE_REMOTE_URL'),
      timeoutMs
    });

    try {
      const workspaceKey = process.env.ZCODE_WORKSPACE_KEY?.trim() || undefined;
      const taskId = process.env.ZCODE_TASK_ID?.trim() || undefined;
      await client.connectAndOpen({ workspaceKey, taskId });
      const list = await client.listWorkspaces();
      return {
        ok: true,
        state: client.state,
        workspaceList: summarizeWorkspaceList(list)
      };
    } finally {
      client.close();
    }
  });
}

const args = parseArgs();
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const openScript = resolve(root, 'open-zcode.ps1');
const waitSeconds = String(args['wait-seconds'] ?? 20);
const timeoutMs = Number(args.timeout ?? optionalIntEnv('ZCODE_PREPARE_TIMEOUT_MS', 8000));

let openResult = null;
let relayResult = null;

try {
  const raw = await runPowerShell(openScript, ['-WaitSeconds', waitSeconds]);
  openResult = JSON.parse(raw);
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    phase: 'open-zcode',
    error: error.message
  }, null, 2));
  process.exitCode = 1;
  process.exit();
}

try {
  relayResult = await quickDoctor(timeoutMs);
  console.log(JSON.stringify({
    ok: true,
    phase: 'ready',
    zcode: openResult,
    relay: relayResult
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    phase: 'await-user-remote-control',
    zcode: openResult,
    relay: {
      ok: false,
      error: error.message
    },
    actionRequired: 'ZCode is open. Ask the user to click the phone icon beside the username in the lower-left corner to enable Mobile Remote Control, then rerun prepare.mjs or doctor.mjs.'
  }, null, 2));
  process.exitCode = 2;
}
