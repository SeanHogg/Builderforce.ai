#!/usr/bin/env node
/**
 * Conditional Vitest for frontend Brain component tests (#2559 / epic #2555 step 4).
 *
 * Sibling packages (`packages/brain-ui`, `brain-embedded`) are other tickets —
 * this wrapper only looks under `frontend/src`.
 *
 * Presence detection (union of the three globs; first match is enough to run):
 *   - src/**/*[Bb]rain*.test.{ts,tsx}
 *   - src/**/brain/**/*.{test,spec}.{ts,tsx}
 *   - colocated same-stem `Brain*.test.{ts,tsx}` next to a `Brain*.tsx`
 *
 * Same-stem is deliberate: `BrainBackdrop.tsx` lives in `src/components/`, and
 * treating every `*.test.tsx` in that directory as colocated would run the full
 * component suite, which this epic step must not do.
 *
 * If none match: print one skip reason and exit 0 so `check:frontend` can still
 * pass. If any match: run Vitest on those files only, with the same heap
 * ceiling as `pnpm test`. Does not write catalogs, emit a build, or need network.
 */
import { existsSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, '..');
const srcDir = resolve(frontendRoot, 'src');
const vitestBin = resolve(frontendRoot, 'node_modules/vitest/vitest.mjs');

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else out.push(full);
  }
  return out;
}

function posixRel(file) {
  return relative(frontendRoot, file).split('\\').join('/');
}

const files = existsSync(srcDir) ? collect(srcDir) : [];
const detected = new Set();

for (const file of files) {
  const relFromSrc = relative(srcDir, file).split('\\').join('/');
  const name = basename(file);

  // src/**/*[Bb]rain*.test.{ts,tsx}
  if (/[Bb]rain.*\.test\.(ts|tsx)$/.test(name)) {
    detected.add(file);
    continue;
  }

  // src/**/brain/**/*.{test,spec}.{ts,tsx}
  if (/(^|\/)brain\//.test(relFromSrc) && /\.(test|spec)\.(ts|tsx)$/.test(name)) {
    detected.add(file);
  }
}

for (const file of files) {
  const name = basename(file);
  if (!/^Brain.*\.tsx$/.test(name)) continue;
  if (/\.(test|spec)\.tsx$/.test(name)) continue;
  const dir = dirname(file);
  const stem = name.slice(0, -'.tsx'.length);
  for (const ext of ['.test.ts', '.test.tsx']) {
    const candidate = join(dir, `${stem}${ext}`);
    if (existsSync(candidate)) detected.add(candidate);
  }
}

if (detected.size === 0) {
  process.stdout.write('skip: no frontend Brain component tests\n');
  process.exit(0);
}

if (!existsSync(vitestBin)) {
  process.stderr.write(
    'test:brain: vitest not found at node_modules/vitest/vitest.mjs — run `pnpm install` in frontend/.\n',
  );
  process.exit(1);
}

const targets = [...detected].map(posixRel).sort();
const child = spawn(
  process.execPath,
  ['--max-old-space-size=8192', vitestBin, 'run', ...targets],
  {
    cwd: frontendRoot,
    stdio: 'inherit',
    env: process.env,
  },
);

child.on('error', (err) => {
  process.stderr.write(`test:brain: failed to spawn vitest: ${err}\n`);
  process.exit(1);
});

child.on('close', (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
