import fs from 'node:fs';
import path from 'node:path';
import { relayHome } from './job-store.mjs';
import { normalizeList, parseBoolean } from './pool-policy.mjs';

export function trustedEditRootsPath() {
  return path.join(relayHome(), 'trusted-editable-roots.json');
}

function normalizePath(value) {
  return path.resolve(String(value || '').trim());
}

function comparable(value) {
  return normalizePath(value).toLowerCase();
}

export function loadTrustedEditRoots() {
  const filePath = trustedEditRootsPath();
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const data = raw.trim() ? JSON.parse(raw) : [];
  const entries = Array.isArray(data) ? data : data.roots;
  return (Array.isArray(entries) ? entries : [])
    .map(entry => typeof entry === 'string' ? { path: entry } : entry)
    .filter(entry => entry?.path)
    .map(entry => ({
      ...entry,
      path: normalizePath(entry.path)
    }));
}

export function saveTrustedEditRoots(entries) {
  fs.mkdirSync(relayHome(), { recursive: true });
  const normalized = entries.map(entry => ({
    ...entry,
    path: normalizePath(entry.path)
  }));
  fs.writeFileSync(trustedEditRootsPath(), `${JSON.stringify({ roots: normalized }, null, 2)}\n`, 'utf8');
  return normalized;
}

export function addTrustedEditRoot(rootPath, { label = '', note = '' } = {}) {
  const fullPath = normalizePath(rootPath);
  const current = loadTrustedEditRoots();
  const key = comparable(fullPath);
  const existing = current.find(entry => comparable(entry.path) === key);
  if (existing) {
    if (label) existing.label = label;
    if (note) existing.note = note;
    existing.updatedAt = new Date().toISOString();
    return { entries: saveTrustedEditRoots(current), added: false, root: existing };
  }
  const root = {
    path: fullPath,
    label,
    note,
    createdAt: new Date().toISOString()
  };
  current.push(root);
  return { entries: saveTrustedEditRoots(current), added: true, root };
}

export function removeTrustedEditRoot(rootPath) {
  const key = comparable(rootPath);
  const current = loadTrustedEditRoots();
  const next = current.filter(entry => comparable(entry.path) !== key);
  saveTrustedEditRoots(next);
  return { removed: current.length !== next.length, entries: next };
}

function isInside(candidate, root) {
  const candidateFull = normalizePath(candidate);
  const rootFull = normalizePath(root);
  const relative = path.relative(rootFull, candidateFull);
  return relative === '' || Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function inferCommonRoot(files = []) {
  const normalizedFiles = normalizeList(files).map(file => normalizePath(file));
  if (!normalizedFiles.length) return null;
  const dirs = normalizedFiles.map(file => path.dirname(file));
  let common = dirs[0];
  for (const dir of dirs.slice(1)) {
    while (common && !isInside(dir, common)) {
      const parent = path.dirname(common);
      if (parent === common) return null;
      common = parent;
    }
  }
  return common || null;
}

export function trustedRootForFiles(files = [], roots = loadTrustedEditRoots()) {
  const normalizedFiles = normalizeList(files);
  if (!normalizedFiles.length) return null;
  for (const root of roots) {
    if (normalizedFiles.every(file => isInside(file, root.path))) return root;
  }
  return null;
}


const DENIED_TRUST_ROOT_NAMES = new Set([
  'users',
  'windows',
  'program files',
  'program files (x86)',
  'appdata',
  'desktop',
  'downloads',
  '.codex',
  '.ssh'
]);

function hasDenySegment(candidate) {
  return normalizePath(candidate)
    .split(/[\\/]+/)
    .some(segment => DENIED_TRUST_ROOT_NAMES.has(segment.toLowerCase()));
}

export function isSafeAutoTrustRoot(candidate) {
  if (!candidate) return false;
  const full = normalizePath(candidate);
  const parsed = path.parse(full);
  if (full === parsed.root) return false;
  if (hasDenySegment(full)) return false;
  return true;
}

export function ensureTrustedRootForFiles(files = [], {
  label = 'Auto-trusted ZCode project root',
  note = 'Added automatically before ZCode direct-edit dispatch.',
  autoTrust = false,
  preferredRoot,
  dryRun = false
} = {}) {
  // A Windows absolute path on POSIX must not resolve to the current directory.
  if (process.platform !== 'win32' && normalizeList(files).some(file => path.win32.isAbsolute(file) && !path.isAbsolute(file))) {
    return { trustedRoot: null, added: false, wouldAdd: false, autoTrustUsed: false, error: 'Refusing foreign-platform absolute paths' };
  }
  const trusted = trustedRootForFiles(files);
  if (trusted) return { trustedRoot: trusted, added: false, wouldAdd: false, autoTrustUsed: false };
  if (!parseBoolean(autoTrust)) return { trustedRoot: null, added: false, wouldAdd: false, autoTrustUsed: false };
  const normalizedFiles = normalizeList(files);
  const candidateRoot = preferredRoot ? normalizePath(preferredRoot) : null;
  const root = candidateRoot && normalizedFiles.every(file => isInside(file, candidateRoot))
    ? candidateRoot
    : inferCommonRoot(files);
  if (!isSafeAutoTrustRoot(root)) {
    return { trustedRoot: null, added: false, wouldAdd: false, autoTrustUsed: true, error: `Refusing to auto-trust unsafe root: ${root || '(none)'}` };
  }
  if (parseBoolean(dryRun)) {
    return {
      trustedRoot: { path: root, label, note },
      added: false,
      wouldAdd: true,
      autoTrustUsed: true
    };
  }
  const result = addTrustedEditRoot(root, { label, note });
  return { trustedRoot: result.root, added: result.added, wouldAdd: false, autoTrustUsed: true };
}
export function resolveEditMode({
  poolType,
  requestedEditMode = 'auto',
  ownedFiles = [],
  allowUntrustedDirectEdit = false,
  trustedRootOverride = null
} = {}) {
  const requested = String(requestedEditMode || 'auto').trim().toLowerCase();
  if (!['auto', 'direct-edit', 'patch-only'].includes(requested)) {
    throw new Error(`Unknown editMode: ${requestedEditMode}`);
  }

  if (poolType !== 'editable') {
    return {
      editMode: 'read-only',
      trustedDirectEdit: false,
      trustedRoot: null,
      editModeReason: 'Pool is not editable; workers must not write files.'
    };
  }

  const trustedRoot = trustedRootOverride?.path
    ? trustedRootOverride
    : trustedRootForFiles(ownedFiles);
  if (requested === 'patch-only') {
    return {
      editMode: 'patch-only',
      trustedDirectEdit: false,
      trustedRoot: trustedRoot?.path || null,
      editModeReason: 'Patch-only was explicitly requested.'
    };
  }

  if (trustedRoot) {
    return {
      editMode: 'direct-edit',
      trustedDirectEdit: true,
      trustedRoot: trustedRoot.path,
      editModeReason: `All owned files are under trusted root: ${trustedRoot.path}`
    };
  }

  if (requested === 'direct-edit') {
    if (parseBoolean(allowUntrustedDirectEdit)) {
      return {
        editMode: 'direct-edit',
        trustedDirectEdit: false,
        trustedRoot: null,
        editModeReason: 'Untrusted direct-edit override was explicitly allowed for this dispatch.'
      };
    }
    throw new Error('direct-edit requested, but ownedFiles are not fully under a trusted editable root. Add a trusted root or use patch-only.');
  }

  return {
    editMode: 'patch-only',
    trustedDirectEdit: false,
    trustedRoot: null,
    editModeReason: 'Owned files are not under a trusted editable root; defaulting to patch-only to avoid ZCode permission stalls.'
  };
}

export function editPolicyPromptBlock(worker) {
  if (worker.editMode === 'direct-edit') {
    return `\nRelay edit policy:\n- editMode: direct-edit\n- trustedRoot: ${worker.trustedRoot || 'none'}\n- You may edit only the owned files listed in this handoff.\n- If ZCode asks for permission, request only this trusted root/owned-file scope and do not broaden it.\n`;
  }
  if (worker.editMode === 'patch-only') {
    return `\nRelay edit policy:\n- editMode: patch-only\n- Do not modify files directly.\n- Produce a unified diff or clearly separated replacement snippets for Codex to review and apply.\n- You may inspect/read the requested files, but do not request write permission.\n`;
  }
  return `\nRelay edit policy:\n- editMode: read-only\n- Do not modify files directly.\n`;
}

