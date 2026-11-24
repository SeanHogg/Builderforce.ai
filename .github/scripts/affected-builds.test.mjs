import assert from 'node:assert/strict';
import { test } from 'node:test';
import { affectedBuilds } from './affected-builds.mjs';

test('a self-hosted runtime change selects its own release', () => {
  const { agent, api, frontend, extension, npm } = affectedBuilds(['agent-runtime/src/run/onPremAdapter.ts']);
  assert.equal(agent, true);
  assert.equal(api || frontend || extension, false);
  assert.deepEqual(npm.include, []);
});

test('a shared agent change verifies its consumers and the kernel', () => {
  const plan = affectedBuilds(['packages/agent-run/src/openRun.ts']);
  for (const scope of ['agent', 'api', 'frontend', 'extension', 'kernel']) assert.equal(plan[scope], true, scope);
});

test('changes follow linked dependencies and do not match similar names', () => {
  const plan = affectedBuilds(['studio/src/index.ts']);
  assert.equal(plan.frontend, true);
  assert.equal(plan.extension, true);
  assert.deepEqual(plan.npm.include.map(({ dir }) => dir), ['studio', 'studio-embedded']);
  assert.equal(affectedBuilds(['studio-old/src/index.ts']).frontend, false);
});

test('Chrome oracle changes do not queue a frontend deployment', () => {
  const plan = affectedBuilds(['clients/chrome/src/host/rovrRunHost.test.ts']);
  assert.equal(plan['verify-frontend'], true);
  assert.equal(plan.frontend, false);
});

test('manual runs include every scope and docs-only changes select docs', () => {
  const { npm, ...all } = affectedBuilds([], true);
  assert.equal(npm.include.length, 6);
  assert.ok(Object.values(all).every(Boolean));
  const { help, npm: docsNpm, ...other } = affectedBuilds(['docs-site/src/content/docs/index.md']);
  assert.equal(help, true);
  assert.deepEqual(docsNpm.include, []);
  assert.ok(Object.values(other).every((selected) => !selected));
});
