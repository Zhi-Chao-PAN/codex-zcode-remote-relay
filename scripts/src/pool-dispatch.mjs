import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './args.mjs';
import {
  ensureStore,
  handoffsDir,
  newJobId,
  newPoolId,
  savePool,
  updatePool
} from './job-store.mjs';
import {
  normalizeList,
  normalizePoolType,
  parseBoolean,
  validatePoolPolicy,
  validateWorkerOwnership
} from './pool-policy.mjs';
import { editPolicyPromptBlock, ensureTrustedRootForFiles, resolveEditMode } from './edit-mode-policy.mjs';

const args = parseArgs();
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const dispatchScript = path.join(currentDir, 'dispatch.mjs');

function readPlan() {
  const planFile = args.plan || args['plan-file'];
  if (!planFile || typeof planFile !== 'string') throw new Error('Missing --plan <pool-plan.json>.');
  const fullPath = path.resolve(planFile);
  const planText = fs.readFileSync(fullPath, 'utf8').replace(/^\uFEFF/, '');
  const plan = JSON.parse(planText);
  return { plan, planPath: fullPath, planDir: path.dirname(fullPath) };
}

function workerContent(worker, planDir) {
  if (typeof worker.content === 'string' && worker.content.trim()) return worker.content;
  const contentFile = worker.contentFile || worker['content-file'];
  if (typeof contentFile === 'string' && contentFile.trim()) {
    const fullPath = path.isAbsolute(contentFile) ? contentFile : path.resolve(planDir, contentFile);
    return fs.readFileSync(fullPath, 'utf8');
  }
  throw new Error(`Worker ${worker.workerId || worker.id || '(unnamed)'} is missing content or contentFile.`);
}

function normalizeWorker(worker, index, plan, planDir) {
  const workerId = String(worker.workerId || worker.id || `worker-${index + 1}`);
  return {
    workerId,
    jobId: worker.jobId || newJobId(),
    model: worker.model || plan.model || '',
    profile: worker.profile || plan.profile || '',
    scope: worker.scope || '',
    roundId: worker.roundId || plan.roundId || 'round-1',
    requestedEditMode: worker.editMode || plan.editMode || 'auto',
    ownedFiles: normalizeList(worker.ownedFiles || worker.owned || worker['owned-files']),
    readOnlyFiles: normalizeList(worker.readOnlyFiles || worker.readOnly || worker['read-only-files']),
    forbiddenFiles: normalizeList(worker.forbiddenFiles || worker.forbidden || worker['forbidden-files']),
    validationGate: worker.validationGate || plan.validationGate || '',
    content: workerContent(worker, planDir),
    state: 'queued',
    routeState: 'queued'
  };
}

function runNode(script, scriptArgs) {
  const child = spawnSync(process.execPath, [script, ...scriptArgs], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024
  });
  const stdout = child.stdout?.trim() || '';
  const stderr = child.stderr?.trim() || '';
  let parsed = null;
  if (stdout) {
    try {
      parsed = JSON.parse(stdout);
    } catch {}
  }
  if (child.status !== 0 || parsed?.ok === false || !parsed) {
    return {
      ok: false,
      status: child.status,
      parsed,
      error: parsed?.error || stderr || stdout || `Node script failed with code ${child.status}`
    };
  }
  return { ok: true, parsed };
}

function dispatchArgsFor(worker, poolId, poolType) {
  const scriptArgs = [
    '--content-file', worker.inputFile,
    '--job-id', worker.jobId,
    '--pool-id', poolId,
    '--pool-type', poolType,
    '--worker-id', worker.workerId,
    '--round-id', worker.roundId,
    '--edit-mode', worker.editMode
  ];
  if (worker.trustedRoot) scriptArgs.push('--trusted-root', worker.trustedRoot);
  if (worker.editModeReason) scriptArgs.push('--edit-mode-reason', worker.editModeReason);
  if (worker.model) scriptArgs.push('--model', worker.model);
  if (worker.profile) scriptArgs.push('--profile', worker.profile);
  if (worker.scope) scriptArgs.push('--scope', worker.scope);
  if (worker.ownedFiles.length) scriptArgs.push('--owned-files', JSON.stringify(worker.ownedFiles));
  if (worker.readOnlyFiles.length) scriptArgs.push('--read-only-files', JSON.stringify(worker.readOnlyFiles));
  if (worker.forbiddenFiles.length) scriptArgs.push('--forbidden-files', JSON.stringify(worker.forbiddenFiles));
  if (worker.validationGate) scriptArgs.push('--validation-gate', worker.validationGate);
  return scriptArgs;
}

try {
  const { plan, planPath, planDir } = readPlan();
  const isDryRun = args['dry-run'] === true || parseBoolean(args.dryRun);
  const poolId = String(args['pool-id'] || plan.poolId || newPoolId());
  const poolType = normalizePoolType(args['pool-type'] || plan.poolType || plan.type || 'editable');
  const allowFivePlus = parseBoolean(args['allow-5-plus'] || plan.allowFivePlus);
  const allowUntrustedDirectEdit = parseBoolean(args['allow-untrusted-direct-edit'] || plan.allowUntrustedDirectEdit);
  const autoTrustProjectRoot = args['no-auto-trust'] === true ? false : !parseBoolean(plan.disableAutoTrust);
  const preferredTrustRoot = typeof args['trust-root'] === 'string'
    ? args['trust-root']
    : typeof plan.trustRoot === 'string'
      ? plan.trustRoot
      : process.cwd();
  const rawWorkers = Array.isArray(plan.workers) ? plan.workers : [];
  if (!rawWorkers.length) throw new Error('Pool plan must include at least one worker.');
  const workers = rawWorkers.map((worker, index) => normalizeWorker(worker, index, plan, planDir));
  const policy = validatePoolPolicy({ poolType, workerCount: workers.length, allowFivePlus });
  validateWorkerOwnership(workers);

  for (const worker of workers) {
    let autoTrust = { trustedRoot: null, added: false, autoTrustUsed: false };
    if (poolType === 'editable' && worker.ownedFiles.length) {
      autoTrust = ensureTrustedRootForFiles(worker.ownedFiles, {
        autoTrust: autoTrustProjectRoot,
        preferredRoot: preferredTrustRoot,
        label: plan.trustLabel || 'Auto-trusted ZCode project root',
        note: plan.trustNote || 'Added automatically by pool-dispatch before direct-edit worker dispatch.',
        dryRun: isDryRun
      });
      if (autoTrust.error) throw new Error(autoTrust.error);
    }

    const editPolicy = resolveEditMode({
      poolType,
      requestedEditMode: worker.requestedEditMode,
      ownedFiles: worker.ownedFiles,
      allowUntrustedDirectEdit,
      trustedRootOverride: autoTrust.trustedRoot
    });
    Object.assign(worker, editPolicy, {
      autoTrustedRootAdded: autoTrust.added || false,
      wouldAutoTrustRoot: autoTrust.wouldAdd || false,
      autoTrustUsed: autoTrust.autoTrustUsed || false
    });
    worker.content = `${worker.content.trim()}\n${editPolicyPromptBlock(worker)}`;
  }

  if (isDryRun) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      poolId,
      poolType,
      policy,
      planPath,
      autoTrustProjectRoot,
      preferredTrustRoot,
      workers: workers.map(worker => ({
        workerId: worker.workerId,
        jobId: worker.jobId,
        model: worker.model,
        profile: worker.profile,
        scope: worker.scope,
        roundId: worker.roundId,
        requestedEditMode: worker.requestedEditMode,
        editMode: worker.editMode,
        trustedDirectEdit: worker.trustedDirectEdit,
        trustedRoot: worker.trustedRoot,
        autoTrustUsed: worker.autoTrustUsed,
        autoTrustedRootAdded: worker.autoTrustedRootAdded,
        wouldAutoTrustRoot: worker.wouldAutoTrustRoot,
        editModeReason: worker.editModeReason,
        ownedFiles: worker.ownedFiles,
        readOnlyFiles: worker.readOnlyFiles,
        forbiddenFiles: worker.forbiddenFiles,
        validationGate: worker.validationGate,
        contentPreview: worker.content.replace(/\s+/g, ' ').trim().slice(0, 240)
      }))
    }, null, 2));
    process.exit(0);
  }

  ensureStore();
  fs.mkdirSync(handoffsDir(), { recursive: true });
  const startedAt = new Date().toISOString();
  savePool({
    schemaVersion: 2,
    poolId,
    state: 'queued',
    routeState: 'queued',
    poolType,
    roundId: plan.roundId || null,
    createdAt: startedAt,
    updatedAt: startedAt,
    planPath,
    policy,
    validationGate: plan.validationGate || '',
    autoTrustProjectRoot,
    preferredTrustRoot,
    workers: workers.map(({ content, ...worker }) => worker)
  });

  const dispatched = [];
  for (const worker of workers) {
    worker.inputFile = path.join(handoffsDir(), `${worker.jobId}.pool-input.md`);
    fs.writeFileSync(worker.inputFile, worker.content, 'utf8');
    worker.state = 'dispatching';
    worker.routeState = 'dispatching';
    updatePool(poolId, {
      state: 'dispatching',
      routeState: 'dispatching',
      workers: workers.map(({ content, ...item }) => item)
    });

    const result = runNode(dispatchScript, dispatchArgsFor(worker, poolId, poolType));
    if (!result.ok) {
      worker.state = 'error';
      worker.routeState = 'error';
      worker.error = result.error;
      updatePool(poolId, {
        state: 'error',
        routeState: 'error',
        workers: workers.map(({ content, ...item }) => item)
      });
      console.log(JSON.stringify({
        ok: false,
        poolId,
        failedWorkerId: worker.workerId,
        failedJobId: worker.jobId,
        error: result.error,
        dispatched
      }, null, 2));
      process.exitCode = 1;
      process.exit();
    }

    worker.state = 'dispatched';
    worker.routeState = 'dispatched';
    worker.taskId = result.parsed.taskId;
    worker.resolvedModel = result.parsed.resolvedModel;
    worker.actualModel = result.parsed.actualModel;
    worker.modelMatchesRequest = result.parsed.modelMatchesRequest;
    worker.provider = result.parsed.provider;
    worker.billing = result.parsed.billing;
    worker.doneMarker = result.parsed.doneMarker;
    dispatched.push({ workerId: worker.workerId, jobId: worker.jobId, taskId: worker.taskId, editMode: worker.editMode });
    updatePool(poolId, {
      state: 'dispatching',
      routeState: 'dispatching',
      workers: workers.map(({ content, ...item }) => item)
    });
  }

  const pool = updatePool(poolId, {
    state: 'dispatched',
    routeState: 'dispatched',
    workers: workers.map(({ content, ...item }) => item)
  });

  console.log(JSON.stringify({
    ok: true,
    poolId,
    state: pool.state,
    poolType,
    workerCount: workers.length,
    dispatched,
    next: {
      status: `node C:\\Users\\22304\\.codex\\skills\\zcode-remote-relay\\scripts\\src\\pool-status.mjs --pool ${poolId}`,
      collect: `node C:\\Users\\22304\\.codex\\skills\\zcode-remote-relay\\scripts\\src\\pool-collect.mjs --pool ${poolId}`,
      report: `node C:\\Users\\22304\\.codex\\skills\\zcode-remote-relay\\scripts\\src\\pool-report.mjs --pool ${poolId}`
    }
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    error: error.message
  }, null, 2));
  process.exitCode = 1;
}
