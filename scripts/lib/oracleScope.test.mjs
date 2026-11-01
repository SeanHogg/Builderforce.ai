/**
 * The guarded-set decision of `check:tests-unchanged`, pinned. Run by `npm run check` (api/scripts/checks.manifest.mjs) with plain
 * `node`, so a change to what the guard examines cannot pass CI unseen.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXACT, isGuarded, ORACLE_LIST, parseOracleList } from './oracleScope.mjs';

const listed = new Set(parseOracleList('# a comment\nbrain-embedded/src/runDriver.test.ts\n\nclients/chrome/src/host/rovrRunHost.test.ts\r\n'));

test('a file the oracle list names is guarded, wherever it lives', () => {
  assert.equal(isGuarded('brain-embedded/src/runDriver.test.ts', listed), true);
  assert.equal(isGuarded('clients/chrome/src/host/rovrRunHost.test.ts', listed), true);
});

test('the list itself is guarded, so a dropped line cannot free its test', () => {
  assert.equal(isGuarded(ORACLE_LIST, new Set()), true);
});

test('everything under packages/agent-run/test is guarded, fixtures and helpers included', () => {
  assert.equal(isGuarded('packages/agent-run/test/x', listed), true);
  assert.equal(isGuarded('packages/agent-run/test/support/fixture.ts', listed), true);
  assert.equal(isGuarded('packages/agent-run/src/index.ts', listed), false);
});

test('a parity snapshot is guarded and compared exactly; the Brain parity code is guarded but not exact', () => {
  const snapshot = 'brain-embedded/src/run/parity/snapshots/ask-user-terminal.json';
  assert.equal(isGuarded(snapshot, listed), true);
  assert.equal(EXACT.test(snapshot), true);
  assert.equal(isGuarded('brain-embedded/src/run/parity/normalise.ts', listed), true);
  assert.equal(EXACT.test('brain-embedded/src/run/parity/normalise.ts'), false);
});

test('the kernel, run and conformance tests are guarded', () => {
  assert.equal(isGuarded('packages/agent-loop/src/askUser.test.ts', listed), true);
  assert.equal(isGuarded('agent-runtime/src/run/channelHardening.test.ts', listed), true);
  assert.equal(isGuarded('agent-runtime/src/conformance/crossAdapter.test.ts', listed), true);
  assert.equal(isGuarded('api/src/application/runtime/cloudAdapter.conformance.test.ts', listed), true);
  assert.equal(isGuarded('brain-embedded/src/test/engineKit.ts', listed), true);
});

test('an ordinary test outside the set is free: ordinary feature work is not blocked', () => {
  assert.equal(isGuarded('api/src/application/marketing/campaignEngine.test.ts', listed), false);
  assert.equal(isGuarded('frontend/src/app/page.test.tsx', listed), false);
  assert.equal(isGuarded('agent-runtime/src/cron/cron-protocol-conformance.test.ts', listed), false);
  assert.equal(isGuarded('agent-runtime/src/run/nested/deep.test.ts', listed), false);
  assert.equal(isGuarded('brain-embedded/src/test/otherHelper.ts', listed), false);
});

test('a path is matched whole, not by a substring', () => {
  assert.equal(isGuarded('x/packages/agent-run/test/y.ts', listed), false);
});

test('the list parser drops comments, blanks and CR', () => {
  assert.deepEqual([...listed], ['brain-embedded/src/runDriver.test.ts', 'clients/chrome/src/host/rovrRunHost.test.ts']);
});
