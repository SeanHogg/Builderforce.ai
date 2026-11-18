#!/usr/bin/env node
// Mirror the .NET runtime bundle for the webcontainers version the frontend installed into the
// builderforce-cdn R2 bucket, where the API serves it on the preview origin at /dotnet/<version>/
// (api/src/presentation/middleware/dotnetBundleRoute.ts). Rules: scripts/lib/dotnetRuntimeBundle.mjs.
//
//   node .github/scripts/publish-dotnet-runtime.mjs [--dry-run] [--version <exact version>]
//
// 1. The version: --version, else frontend/pnpm-lock.yaml's @seanhogg/builderforce-webcontainers.
// 2. Already mirrored (its manifest is in the bucket)? Done — a version path is never written twice.
// 3. Not on npm as @seanhogg/builderforce-webcontainers-dotnet@<version> (a release before bundles were
//    published, or still publishing)? A warning, exit 0: `dotnet` commands decline cleanly until it is.
// 4. `npm pack` it, check every file against the manifest's SHA-256, upload every file, manifest LAST.
//
// Needs `wrangler` on PATH. Env: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID (wrangler; R2 edit), CDN_R2_BUCKET (default
// builderforce-cdn), DRY_RUN=1 (same as --dry-run: prints the uploads, writes nothing).
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOTNET_BUNDLE_CACHE_CONTROL, DOTNET_BUNDLE_PACKAGE, bundleObjectKey, bundleProblems, lockedVersion, uploadOrder,
} from '../../scripts/lib/dotnetRuntimeBundle.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DRY = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const BUCKET = process.env.CDN_R2_BUCKET || 'builderforce-cdn';
const CONCURRENCY = 8;
// wrangler on PATH, installed ONCE before the fan-out (release.yml) — never a cold `npx` per file.
const WRANGLER = process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const at = process.argv.indexOf('--version');
const version = at >= 0 ? process.argv[at + 1] : lockedVersion(readFileSync(join(ROOT, 'frontend', 'pnpm-lock.yaml'), 'utf8'));
if (!version) throw new Error('publish-dotnet-runtime: frontend/pnpm-lock.yaml resolves no exact @seanhogg/builderforce-webcontainers version.');
const log = (line) => console.log(`publish-dotnet-runtime: ${line}`);

/** Run wrangler with retries: one flaky upload must not fail the mirror. */
function wrangler(args, { quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const attempt = (left) => {
      const child = spawn(WRANGLER, args, { stdio: quiet ? 'ignore' : ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' });
      child.on('error', reject);
      child.on('exit', (code) => (code === 0 ? resolve(true) : left > 0 ? setTimeout(() => attempt(left - 1), 2_000) : quiet ? resolve(false) : reject(new Error(`wrangler ${args.slice(0, 4).join(' ')} exited ${code}`))));
    };
    attempt(quiet ? 0 : 2);
  });
}

/** Whether the bucket already holds this version (its manifest lands last, so it means "complete"). */
async function mirrored() {
  if (DRY) return false;
  const scratch = mkdtempSync(join(tmpdir(), 'dotnet-head-'));
  try {
    return await wrangler(['r2', 'object', 'get', `${BUCKET}/${bundleObjectKey(version, 'manifest.json')}`, '--remote', '--file', join(scratch, 'manifest.json')], { quiet: true });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function onNpm() {
  try {
    return execFileSync(npm, ['view', `${DOTNET_BUNDLE_PACKAGE}@${version}`, 'version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32' }).trim() === version;
  } catch {
    return false;
  }
}

async function upload(dir, paths) {
  let next = 0;
  const worker = async () => {
    while (next < paths.length) {
      const path = paths[next++];
      const key = bundleObjectKey(version, path);
      if (DRY) { log(`DRY wrangler r2 object put ${BUCKET}/${key} --file ${join(dir, path)} --cache-control "${DOTNET_BUNDLE_CACHE_CONTROL}"`); continue; }
      await wrangler(['r2', 'object', 'put', `${BUCKET}/${key}`, '--file', join(dir, path), '--cache-control', DOTNET_BUNDLE_CACHE_CONTROL, '--remote']);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, paths.length) }, worker));
}

if (await mirrored()) {
  log(`${version} is already mirrored in ${BUCKET} — a version path is never written twice; nothing to do.`);
  process.exit(0);
}
if (!onNpm()) {
  console.log(`::warning::${DOTNET_BUNDLE_PACKAGE}@${version} is not on npm: .NET previews decline until its release publishes the bundle (builderforce-webcontainers release.yml, publish-dotnet-runtime).`);
  process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), 'dotnet-bundle-'));
try {
  const tarball = execFileSync(npm, ['pack', `${DOTNET_BUNDLE_PACKAGE}@${version}`, '--pack-destination', work, '--silent'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim().split('\n').pop();
  execFileSync('tar', ['-xzf', join(work, tarball), '-C', work]);
  const dir = join(work, 'package');
  const problems = bundleProblems(dir);
  if (problems.length > 0) throw new Error(`${DOTNET_BUNDLE_PACKAGE}@${version} does not match its manifest:\n  ${problems.join('\n  ')}`);
  const order = uploadOrder(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
  const manifest = order.pop();
  await upload(dir, order);
  await upload(dir, [manifest]); // LAST: the manifest says "this version is complete"
  log(`mirrored ${DOTNET_BUNDLE_PACKAGE}@${version} (${order.length + 1} files) → r2://${BUCKET}/${bundleObjectKey(version, '')}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
