/**
 * The .NET runtime bundle mirror's rules (`dotnetRuntimeBundle.mjs`), pinned. Run by `npm run check`
 * (api/scripts/checks.manifest.mjs) with plain `node`.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  DOTNET_BUNDLE_CACHE_CONTROL, DOTNET_BUNDLE_R2_PREFIX, bundleObjectKey, bundleProblems, lockedVersion, uploadOrder,
} from './dotnetRuntimeBundle.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sha = (text) => createHash('sha256').update(text).digest('hex');

function bundle(files, manifestPatch = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dotnet-bundle-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  const manifest = { format: 2, entry: '_framework/dotnet.js', files: Object.fromEntries(Object.entries(files).map(([p, t]) => [p, sha(t)])), ...manifestPatch };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  return { dir, manifest };
}

test('reads the exact version the frontend lockfile resolved, peer suffix dropped', () => {
  const lock = [
    'importers:', '', '  .:', '    dependencies:',
    "      '@seanhogg/builderforce-brain-embedded':", '        specifier: ^1.0.0', '        version: 1.2.3',
    "      '@seanhogg/builderforce-webcontainers':", '        specifier: ^2026.11.4', '        version: 2026.11.5(@typescript/typescript6@6.0.2)',
    "      '@seanhogg/builderforce-webcontainers-core':", '        specifier: ^2026.11.4', '        version: 2026.11.9',
  ].join('\n');
  assert.equal(lockedVersion(lock), '2026.11.5');
  assert.equal(lockedVersion(lock.replace(/\n/g, '\r\n')), '2026.11.5');
  assert.equal(lockedVersion('importers: {}'), null);
  assert.equal(lockedVersion(lock.replace('2026.11.5(', 'link:../x(')), null);
});

test('reads the real frontend lockfile', () => {
  const version = lockedVersion(readFileSync(join(root, 'frontend', 'pnpm-lock.yaml'), 'utf8'));
  assert.match(version ?? '', /^\d+\.\d+\.\d+/);
});

test('keys every file under webcontainers/dotnet/<version>/ and uploads the manifest last', () => {
  assert.equal(bundleObjectKey('2026.11.5', '_framework\\dotnet.js'), 'webcontainers/dotnet/2026.11.5/_framework/dotnet.js');
  assert.throws(() => bundleObjectKey('^2026.11.5', 'manifest.json'));
  assert.deepEqual(uploadOrder({ files: { 'refs/netcore.bin': 'x', '_framework/dotnet.js': 'y' } }), ['_framework/dotnet.js', 'refs/netcore.bin', 'manifest.json']);
  assert.equal(DOTNET_BUNDLE_CACHE_CONTROL, 'public, max-age=31536000, immutable');
});

test('accepts a bundle whose files match the manifest, and names every mismatch', () => {
  const good = bundle({ '_framework/dotnet.js': 'js', 'refs/netcore.bin': 'pack' });
  try {
    assert.deepEqual(bundleProblems(good.dir), []);
    writeFileSync(join(good.dir, 'refs/netcore.bin'), 'tampered');
    rmSync(join(good.dir, '_framework/dotnet.js'));
    assert.deepEqual(bundleProblems(good.dir), ['_framework/dotnet.js: missing', 'refs/netcore.bin: does not match its hash']);
  } finally {
    rmSync(good.dir, { recursive: true, force: true });
  }
  const old = bundle({ 'a.js': 'a' }, { format: 1, files: { 'a.js': sha('a'), '../escape': sha('a') } });
  try {
    assert.deepEqual(bundleProblems(old.dir), ['manifest format 1; the runtime reads 2', '../escape: not a plain relative path']);
  } finally {
    rmSync(old.dir, { recursive: true, force: true });
  }
});

test('the API route reads the same bucket prefix', () => {
  const route = readFileSync(join(root, 'api/src/presentation/middleware/dotnetBundleRoute.ts'), 'utf8');
  assert.ok(route.includes(`DOTNET_BUNDLE_R2_PREFIX = '${DOTNET_BUNDLE_R2_PREFIX}'`));
  assert.ok(route.includes(`DOTNET_BUNDLE_CACHE_CONTROL = '${DOTNET_BUNDLE_CACHE_CONTROL}'`));
});
