import { parseArgs } from './args.mjs';
import {
  addTrustedEditRoot,
  loadTrustedEditRoots,
  removeTrustedEditRoot,
  trustedEditRootsPath
} from './edit-mode-policy.mjs';

const args = parseArgs();

try {
  if (typeof args.add === 'string') {
    const result = addTrustedEditRoot(args.add, {
      label: typeof args.label === 'string' ? args.label : '',
      note: typeof args.note === 'string' ? args.note : ''
    });
    console.log(JSON.stringify({
      ok: true,
      action: result.added ? 'added' : 'updated',
      root: result.root,
      path: trustedEditRootsPath(),
      count: result.entries.length
    }, null, 2));
    process.exit(0);
  }

  if (typeof args.remove === 'string') {
    const result = removeTrustedEditRoot(args.remove);
    console.log(JSON.stringify({
      ok: true,
      action: 'remove',
      removed: result.removed,
      path: trustedEditRootsPath(),
      count: result.entries.length
    }, null, 2));
    process.exit(0);
  }

  const roots = loadTrustedEditRoots();
  console.log(JSON.stringify({
    ok: true,
    path: trustedEditRootsPath(),
    count: roots.length,
    roots
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    error: error.message
  }, null, 2));
  process.exitCode = 1;
}
