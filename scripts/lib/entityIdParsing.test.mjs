/**
 * What `check:entity-id-parsing` holds, pinned (scripts/lib/entityIdParsing.mjs). Run by `npm run check`
 * (api/scripts/checks.manifest.mjs) with plain `node`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OWNER, applyAllowlist, findViolations, kindsFor } from './entityIdParsing.mjs';

const kinds = (rel, line) => findViolations(rel, line).map((f) => f.kind);

test('scoped trees are held to both patterns; the rest of api to the UUID one; tests, fixtures and the owner to none', () => {
  assert.deepEqual(kindsFor('brain-embedded/src/a.ts'), ['uuid', 'integer']);
  assert.deepEqual(kindsFor('api/src/application/sync/a.ts'), ['uuid', 'integer']);
  assert.deepEqual(kindsFor('clients/chrome/src/a.tsx'), ['uuid', 'integer']);
  assert.deepEqual(kindsFor('api/src/presentation/routes/a.ts'), ['uuid']);
  assert.deepEqual(kindsFor('frontend/src/a.ts'), []);
  assert.deepEqual(kindsFor('brain-embedded/src/a.test.ts'), []);
  assert.deepEqual(kindsFor('packages/local-first/src/__fixtures__/rows.ts'), []);
  assert.deepEqual(kindsFor(OWNER), []);
  assert.deepEqual(kindsFor('brain-embedded/src/notes.md'), []);
});

test('UUID regexes are found in their usual spellings', () => {
  const rel = 'brain-embedded/src/a.ts';
  for (const line of [
    'const R = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;',
    "new RegExp('[0-9a-fA-F]{8}-[0-9a-fA-F]{4}')",
    'const R = /[\\da-f]{8}\\-/;',
    'if (/^[0-9a-f-]{36}$/i.test(id)) {}',
  ]) assert.deepEqual(kinds(rel, line), ['uuid'], line);
  assert.deepEqual(kinds(rel, 'const SHA = /^[0-9a-f]{40}$/;'), []);
  assert.deepEqual(kinds(rel, 'const SHORT = /^[0-9a-f]{8}$/;'), []);
});

test('whole-string integer parses are found; partial digit matches are not', () => {
  const rel = 'clients/vscode/src/a.ts';
  for (const line of [
    'if (/^\\d+$/.test(v)) {}',
    'const R = /^[1-9]\\d*$/;',
    'const R = /^-?\\d+$/;',
    'const R = /^[0-9]+$/;',
    'const R = /^\\s*\\d+\\s*$/;',
    "new RegExp('^\\\\d+$')",
  ]) assert.deepEqual(kinds(rel, line), ['integer'], line);
  for (const line of ['const R = /\\d+/g;', 'const YEAR = /^\\d{4}$/;', 'const V = /^\\d+\\.\\d+$/;', 'const R = /^v\\d+$/;']) {
    assert.deepEqual(kinds(rel, line), [], line);
  }
});

test('comment lines are not held: they describe the patterns', () => {
  const rel = 'brain-embedded/src/a.ts';
  assert.deepEqual(kinds(rel, ' * parseSyncId (`/^[1-9]\\d*$/`)'), []);
  assert.deepEqual(kinds(rel, '// was /^\\d+$/'), []);
});

test('an allowlist entry covers its file and kind only, and an unused entry is stale', () => {
  const findings = [
    { file: 'a.ts', kind: 'uuid', line: 1, text: '' },
    { file: 'a.ts', kind: 'integer', line: 2, text: '' },
  ];
  const { violations, stale } = applyAllowlist(findings, [
    { file: 'a.ts', kind: 'uuid', reason: 'x' },
    { file: 'b.ts', kind: 'uuid', reason: 'gone' },
  ]);
  assert.deepEqual(violations.map((v) => v.kind), ['integer']);
  assert.deepEqual(stale.map((e) => e.file), ['b.ts']);
});
