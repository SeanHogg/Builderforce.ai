/**
 * The two typecheckers, run CONCURRENTLY by `../scripts/run-checks.mjs`.
 *
 * They were chained `tsgo --noEmit && tsc --noEmit`, which is 22s + 90s serial for
 * two passes that read the same files and neither of which needs the other's
 * result. Run together they cost the slower one. The `&&` also meant a tsgo error
 * hid whatever tsc had to say; the runner reports both.
 *
 * Addressed by path rather than `require.resolve`, which throws
 * ERR_PACKAGE_PATH_NOT_EXPORTED here: `@typescript/native-preview` does not list
 * its bin in `exports`. These paths carry no version — pnpm's versioned directories
 * are under `.pnpm/`, and `node_modules/<pkg>` is the symlink to whichever one is
 * installed — so they survive a bump. Both bins are node scripts (`bin/tsgo` is an
 * ESM shim over `lib/tsgo.js`), which is what the runner spawns.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const CHECKERS = [
  ['tsgo', '../node_modules/@typescript/native-preview/bin/tsgo', '--noEmit'],
  ['tsc', '../node_modules/typescript/bin/tsc', '--noEmit'],
];

for (const [name, file] of CHECKERS) {
  if (!existsSync(resolve(here, file))) {
    throw new Error(`typecheck.manifest: ${name} not found at ${file} — run \`pnpm install\` in api/.`);
  }
}

export default CHECKERS;
