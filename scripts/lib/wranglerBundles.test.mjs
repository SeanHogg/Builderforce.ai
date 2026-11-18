/**
 * Rule 10 of `check:source-package-graph` (`wranglerBundles.mjs`), pinned. Run by `npm run check`
 * (api/scripts/checks.manifest.mjs) with plain `node`.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { topLevelString, wranglerBundleProblems } from './wranglerBundles.mjs';

const site = (specifier, isTest = false) => ({ specifier, file: 'x.ts', relative: 'packages/p/src/x.ts', line: 1, isTest });

function fixture(toml) {
  const dir = mkdtempSync(join(tmpdir(), 'wrangler-bundles-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'wrangler.toml'), toml);
  return {
    dir,
    project: (paths) => ({ file: join(dir, 'tsconfig.json'), dir, paths, sources: [join(dir, 'src')] }),
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const RUNTIME = { 'mem/*': ['./node_modules/mem/dist/*/index.d.ts', './node_modules/mem/dist/*/index.js'] };
const DECLARATION = { 'mem/*': ['./node_modules/mem/dist/*/index.d.ts'] };

test('a top-level TOML key is read; the same key inside a table is not', () => {
  const text = 'name = "w"\nmain = "src/index.ts"\n\n[build]\ntsconfig = "nope.json"\n';
  assert.equal(topLevelString(text, 'main', true), 'src/index.ts');
  assert.equal(topLevelString(text, 'tsconfig', true), undefined);
  assert.equal(topLevelString('{ "main": "src/a.ts" }', 'main', false), 'src/a.ts');
});

test('a config that forces its project tsconfig onto runtime targets passes', () => {
  const f = fixture('main = "src/index.ts"\ntsconfig = "tsconfig.json"\n');
  try {
    assert.deepEqual(wranglerBundleProblems({ project: f.project(RUNTIME), nodes: [{ externals: [site('mem/stats')] }] }), []);
  } finally {
    f.done();
  }
});

test('a config that leaves esbuild on the nearest tsconfig fails', () => {
  const f = fixture('main = "src/index.ts"\n');
  try {
    const problems = wranglerBundleProblems({ project: f.project(RUNTIME), nodes: [{ externals: [site('mem/stats')] }] });
    assert.deepEqual(problems.map((p) => p.kind), ['tsconfig-not-forced']);
  } finally {
    f.done();
  }
});

test('a subpath mapped onto a declaration fails: esbuild skips it', () => {
  const f = fixture('main = "src/index.ts"\ntsconfig = "tsconfig.json"\n');
  try {
    const problems = wranglerBundleProblems({ project: f.project(DECLARATION), nodes: [{ externals: [site('mem/stats')] }] });
    assert.deepEqual(problems.map((p) => [p.kind, p.specifier]), [['declaration-target', 'mem/stats']]);
  } finally {
    f.done();
  }
});

test('nothing to bundle, nothing required: roots, test-only imports and configs outside the project', () => {
  const f = fixture('main = "src/index.ts"\n');
  try {
    const nodes = [{ externals: [site('mem'), site('mem/stats', true)] }];
    assert.deepEqual(wranglerBundleProblems({ project: f.project(DECLARATION), nodes }), []);
    const elsewhere = { ...f.project(DECLARATION), sources: [join(f.dir, 'other')] };
    assert.deepEqual(wranglerBundleProblems({ project: elsewhere, nodes: [{ externals: [site('mem/stats')] }] }), []);
  } finally {
    f.done();
  }
});
