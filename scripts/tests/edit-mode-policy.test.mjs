import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {
  inferCommonRoot,
  isSafeAutoTrustRoot,
  resolveEditMode,
  editPolicyPromptBlock,
  addTrustedEditRoot,
  removeTrustedEditRoot,
  loadTrustedEditRoots,
  trustedRootForFiles,
  ensureTrustedRootForFiles
} from '../src/edit-mode-policy.mjs';

const isWindows = process.platform === 'win32';

// ---- inferCommonRoot ----

test('inferCommonRoot finds common directory for sibling files', () => {
  const sep = isWindows ? '\\' : '/';
  const files = [`C:${sep}proj${sep}src${sep}a.js`, `C:${sep}proj${sep}src${sep}b.js`];
  const root = inferCommonRoot(files);
  assert.equal(root, path.resolve(`C:${sep}proj${sep}src`));
});

test('inferCommonRoot returns the dir when single file given', () => {
  const sep = isWindows ? '\\' : '/';
  const root = inferCommonRoot([`C:${sep}proj${sep}src${sep}a.js`]);
  assert.equal(root, path.resolve(`C:${sep}proj${sep}src`));
});

test('inferCommonRoot returns null for empty input', () => {
  assert.equal(inferCommonRoot([]), null);
  assert.equal(inferCommonRoot(), null);
});

test('inferCommonRoot climbs up to find shared ancestor', () => {
  const sep = isWindows ? '\\' : '/';
  const files = [`C:${sep}proj${sep}src${sep}a.js`, `C:${sep}proj${sep}tests${sep}b.js`];
  const root = inferCommonRoot(files);
  assert.equal(root, path.resolve(`C:${sep}proj`));
});

// ---- isSafeAutoTrustRoot (the security gate) ----

test('isSafeAutoTrustRoot rejects the filesystem root', () => {
  const root = isWindows ? 'C:\\' : '/';
  assert.equal(isSafeAutoTrustRoot(root), false);
});

test('isSafeAutoTrustRoot rejects denied segments', () => {
  for (const bad of [
    'C:\\Users\\Example',
    'C:\\Windows\\System32',
    'C:\\Users\\Example\\AppData\\Local',
    'C:\\Users\\Example\\Desktop',
    'C:\\Users\\Example\\Downloads',
    'D:\\.codex\\stuff',
    'C:\\Users\\Example\\.ssh'
  ]) {
    assert.equal(isSafeAutoTrustRoot(bad), false, `should reject ${bad}`);
  }
});

test('isSafeAutoTrustRoot accepts a path with no denied segment', () => {
  // Note: any path under Users/ is auto-trust-denied by design; auto-trust is
  // intentionally stricter than manual addTrustedEditRoot. Use a non-Users path.
  assert.equal(isSafeAutoTrustRoot('E:\\dev\\myapp'), true);
  assert.equal(isSafeAutoTrustRoot('D:\\projects\\app'), true);
});

test('isSafeAutoTrustRoot denies paths under Users (stricter than manual trust)', () => {
  // This documents the intended asymmetry: a human can manually trust
  // C:\Users\Example\Documents\Codex, but auto-trust refuses anything under Users.
  assert.equal(isSafeAutoTrustRoot('C:\\Users\\Example\\Documents\\Codex\\proj'), false);
});

test('isSafeAutoTrustRoot rejects empty/null', () => {
  assert.equal(isSafeAutoTrustRoot(''), false);
  assert.equal(isSafeAutoTrustRoot(null), false);
  assert.equal(isSafeAutoTrustRoot(undefined), false);
});

// Deny-list is case-insensitive
test('isSafeAutoTrustRoot deny check is case-insensitive', () => {
  assert.equal(isSafeAutoTrustRoot('c:\\users\\example'), false);
  assert.equal(isSafeAutoTrustRoot('C:\\APPDATA\\x'), false);
});

// ---- resolveEditMode matrix ----

test('resolveEditMode: non-editable pool forces read-only', () => {
  const result = resolveEditMode({ poolType: 'read-only', requestedEditMode: 'direct-edit', ownedFiles: [] });
  assert.equal(result.editMode, 'read-only');
  assert.equal(result.trustedDirectEdit, false);
  assert.match(result.editModeReason, /not editable/);
});

test('resolveEditMode: explicit patch-only stays patch-only even with trusted root', () => {
  const result = resolveEditMode({
    poolType: 'editable',
    requestedEditMode: 'patch-only',
    ownedFiles: ['C:\\proj\\src\\a.js'],
    trustedRootOverride: { path: 'C:\\proj' }
  });
  assert.equal(result.editMode, 'patch-only');
  assert.equal(result.trustedDirectEdit, false);
});

test('resolveEditMode: direct-edit when owned files under trusted root override', () => {
  const result = resolveEditMode({
    poolType: 'editable',
    requestedEditMode: 'auto',
    ownedFiles: ['C:\\proj\\src\\a.js'],
    trustedRootOverride: { path: 'C:\\proj' }
  });
  assert.equal(result.editMode, 'direct-edit');
  assert.equal(result.trustedDirectEdit, true);
  assert.equal(result.trustedRoot, path.resolve('C:\\proj'));
});

test('resolveEditMode: auto without trusted root defaults to patch-only', () => {
  const result = resolveEditMode({
    poolType: 'editable',
    requestedEditMode: 'auto',
    ownedFiles: ['C:\\untrusted\\a.js']
  });
  assert.equal(result.editMode, 'patch-only');
  assert.equal(result.trustedDirectEdit, false);
  assert.match(result.editModeReason, /defaulting to patch-only/);
});

test('resolveEditMode: explicit direct-edit without trusted root throws', () => {
  assert.throws(
    () => resolveEditMode({ poolType: 'editable', requestedEditMode: 'direct-edit', ownedFiles: ['C:\\untrusted\\a.js'] }),
    /not fully under a trusted editable root/
  );
});

test('resolveEditMode: direct-edit untrusted override allowed when flag set', () => {
  const result = resolveEditMode({
    poolType: 'editable',
    requestedEditMode: 'direct-edit',
    ownedFiles: ['C:\\untrusted\\a.js'],
    allowUntrustedDirectEdit: true
  });
  assert.equal(result.editMode, 'direct-edit');
  assert.equal(result.trustedDirectEdit, false);
  assert.match(result.editModeReason, /Untrusted direct-edit override/);
});

test('resolveEditMode: throws on unknown editMode', () => {
  assert.throws(
    () => resolveEditMode({ poolType: 'editable', requestedEditMode: 'bogus' }),
    /Unknown editMode/
  );
});

// ---- editPolicyPromptBlock ----

test('editPolicyPromptBlock: direct-edit mentions trusted root and owned files', () => {
  const block = editPolicyPromptBlock({ editMode: 'direct-edit', trustedRoot: 'C:\\proj' });
  assert.match(block, /editMode: direct-edit/);
  assert.match(block, /trustedRoot: C:\\proj/);
  assert.match(block, /owned files/);
});

test('editPolicyPromptBlock: patch-only tells worker to produce diff', () => {
  const block = editPolicyPromptBlock({ editMode: 'patch-only' });
  assert.match(block, /editMode: patch-only/);
  assert.match(block, /diff|snippet/);
});

test('editPolicyPromptBlock: read-only is terse', () => {
  const block = editPolicyPromptBlock({ editMode: 'read-only' });
  assert.match(block, /editMode: read-only/);
});

// ---- trusted-edit-roots persistence (uses real ~/.codex/zcode-remote-relay) ----
// These mutate the live trusted-roots file, so we add then remove to restore state.

test('addTrustedEditRoot / removeTrustedEditRoot round-trips a temp entry', () => {
  const tempDir = path.join(os.tmpdir(), `zcode-relay-test-${Date.now()}`);
  const before = loadTrustedEditRoots();
  const added = addTrustedEditRoot(tempDir, { label: 'test', note: 'unit test' });
  assert.equal(added.added, true);
  assert.equal(added.root.path, path.resolve(tempDir));

  // idempotent: adding again does not duplicate
  const again = addTrustedEditRoot(tempDir);
  assert.equal(again.added, false);

  // trustedRootForFiles now resolves for a file under it
  const resolved = trustedRootForFiles([path.join(tempDir, 'src', 'a.js')]);
  assert.equal(resolved?.path, path.resolve(tempDir));

  const removed = removeTrustedEditRoot(tempDir);
  assert.equal(removed.removed, true);

  // restored: no longer resolves
  const afterResolved = trustedRootForFiles([path.join(tempDir, 'src', 'a.js')]);
  assert.equal(afterResolved, null);
  // sanity: root count restored
  const after = loadTrustedEditRoots();
  assert.equal(after.length, before.length);
});

// ---- ensureTrustedRootForFiles: dry-run does not write ----

test('ensureTrustedRootForFiles: dryRun reports wouldAdd without writing', () => {
  const tempDir = path.join(os.tmpdir(), `zcode-relay-dry-${Date.now()}`);
  const before = loadTrustedEditRoots();
  const result = ensureTrustedRootForFiles([path.join(tempDir, 'a.js')], { autoTrust: true, dryRun: true });
  assert.equal(result.wouldAdd, true);
  assert.equal(result.added, false);
  const after = loadTrustedEditRoots();
  assert.equal(after.length, before.length, 'dry-run must not persist a new root');
});

test('ensureTrustedRootForFiles: refuses unsafe root even with autoTrust', () => {
  const result = ensureTrustedRootForFiles(['C:\\Users\\Example\\evil.js'], { autoTrust: true });
  assert.equal(result.trustedRoot, null);
  assert.equal(result.wouldAdd, false);
  assert.match(result.error || '', /unsafe root|Refusing/i);
});

test('ensureTrustedRootForFiles: autoTrust=false returns null without error', () => {
  const tempDir = path.join(os.tmpdir(), `zcode-relay-noauto-${Date.now()}`);
  const result = ensureTrustedRootForFiles([path.join(tempDir, 'a.js')], { autoTrust: false });
  assert.equal(result.trustedRoot, null);
  assert.equal(result.autoTrustUsed, false);
});
