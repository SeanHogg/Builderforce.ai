import { spawnSync } from 'node:child_process';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkedTargets, readManifest } from './linkedPackages.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const workspace = join(root, 'pnpm-workspace.yaml');
const packages = new Set();

function add(dir) {
  if (packages.has(dir)) return;
  const manifest = readManifest(dir);
  if (!manifest) throw new Error(`Cannot read workspace package ${dir}`);
  // Source-only packages with no installable dependencies need no lock or install.
  if (!existsSync(join(dir, 'pnpm-lock.yaml'))) {
    if (Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).length === 0) return;
    throw new Error(`Missing pnpm lockfile for ${dir}`);
  }
  packages.add(dir);
  linkedTargets(dir, manifest).forEach(add);
}

for (const dir of ['brain-embedded', 'packages/brain-ui']) add(resolve(root, dir));
const entries = [...packages].map((dir) => `  - ${JSON.stringify(relative(root, dir).split(sep).join('/'))}`);

// Use the same locks as standalone installs during the pilot. Only the two Brain
// bundles are built afterward, under the same explicit build step on every runner.
writeFileSync(workspace, ['sharedWorkspaceLockfile: false', 'packages:', ...entries, ''].join('\n'), { flag: 'wx' });
try {
  const result = spawnSync('pnpm', ['--recursive', 'install', '--frozen-lockfile', '--ignore-scripts'], {
    cwd: root, stdio: 'inherit', shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  unlinkSync(workspace);
}
