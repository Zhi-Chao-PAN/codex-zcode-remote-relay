import fs from 'node:fs';
import path from 'node:path';
import { relayHome } from './job-store.mjs';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function intEnv(name, fallback) {
  const parsed = Number.parseInt(String(process.env[name] || ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readLock(lockPath) {
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    return null;
  }
}

export async function acquireRelayLock({
  owner = 'zcode-relay',
  waitMs = intEnv('ZCODE_RELAY_LOCK_WAIT_MS', 120000),
  staleMs = intEnv('ZCODE_RELAY_LOCK_STALE_MS', 600000),
  pollMs = intEnv('ZCODE_RELAY_LOCK_POLL_MS', 500)
} = {}) {
  fs.mkdirSync(relayHome(), { recursive: true });
  const lockPath = path.join(relayHome(), 'relay-control.lock');
  const startedAtMs = Date.now();

  while (true) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      const lock = {
        owner,
        pid: process.pid,
        startedAt: new Date().toISOString()
      };
      fs.writeFileSync(fd, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
      fs.closeSync(fd);

      let released = false;
      return {
        lockPath,
        release() {
          if (released) return;
          released = true;
          try {
            const current = readLock(lockPath);
            if (!current || current.pid === process.pid) fs.rmSync(lockPath, { force: true });
          } catch {}
        }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;

      let stale = false;
      try {
        const stat = fs.statSync(lockPath);
        stale = Date.now() - stat.mtimeMs > staleMs;
      } catch {
        stale = true;
      }

      if (stale) {
        try {
          fs.rmSync(lockPath, { force: true });
        } catch {}
        continue;
      }

      if (Date.now() - startedAtMs > waitMs) {
        const current = readLock(lockPath);
        const holder = current?.owner ? ` holder=${current.owner}` : '';
        throw new Error(`Timed out waiting for ZCode relay control lock.${holder}`);
      }

      await sleep(pollMs);
    }
  }
}

export async function withRelayLock(owner, fn, options = {}) {
  const lock = await acquireRelayLock({ owner, ...options });
  try {
    return await fn();
  } finally {
    lock.release();
  }
}
