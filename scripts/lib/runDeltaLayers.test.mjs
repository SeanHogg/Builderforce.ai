/**
 * What `check:run-delta-layers` holds, pinned (scripts/lib/runDeltaLayers.mjs). Run by `npm run check`
 * (api/scripts/checks.manifest.mjs) with plain `node`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findLayerViolations, isPredictSpecifier, isVerdictFile } from './runDeltaLayers.mjs';

const S = 'packages/run-delta/src';
/** A fixture graph: [file, targets, specifiers?]. */
const graphOf = (rows) => new Map(rows.map(([file, targets, specifiers = []]) => [`${S}/${file}`, {
  specifiers,
  targets: targets.map((t) => `${S}/${t}`),
}]));

test('a verdict-side file importing predict/ directly fails, with its chain', () => {
  const graph = graphOf([
    ['engine/verdict.ts', ['predict/risk.ts']],
    ['predict/risk.ts', ['contract.ts']],
    ['contract.ts', []],
  ]);
  assert.deepEqual(findLayerViolations(graph), [
    { file: `${S}/engine/verdict.ts`, chain: [`${S}/engine/verdict.ts`, `${S}/predict/risk.ts`] },
  ]);
});

test('every verdict layer is held: engine/, rules/ and verdict/', () => {
  const graph = graphOf([
    ['rules/apiBreaking.ts', ['predict/contract.ts']],
    ['verdict/combine.ts', ['predict/contract.ts']],
    ['engine/headline.ts', ['predict/contract.ts']],
    ['predict/contract.ts', []],
  ]);
  assert.deepEqual(findLayerViolations(graph).map((v) => v.file), [
    `${S}/engine/headline.ts`, `${S}/rules/apiBreaking.ts`, `${S}/verdict/combine.ts`,
  ]);
});

test('reaching predict/ through a barrel or a helper counts', () => {
  const graph = graphOf([
    ['engine/computeRunDelta.ts', ['summary.ts']],
    ['summary.ts', ['index.ts']],
    ['index.ts', ['predict/contract.ts', 'contract.ts']],
    ['predict/contract.ts', []],
    ['contract.ts', []],
  ]);
  assert.deepEqual(findLayerViolations(graph), [{
    file: `${S}/engine/computeRunDelta.ts`,
    chain: [`${S}/engine/computeRunDelta.ts`, `${S}/summary.ts`, `${S}/index.ts`, `${S}/predict/contract.ts`],
  }]);
});

test('naming the predict subpath by package name counts', () => {
  const graph = graphOf([['rules/onlyAdded.ts', [], ['@builderforce/run-delta/predict']]]);
  assert.deepEqual(findLayerViolations(graph), [
    { file: `${S}/rules/onlyAdded.ts`, chain: [`${S}/rules/onlyAdded.ts`, '@builderforce/run-delta/predict'] },
  ]);
  assert.equal(isPredictSpecifier('@builderforce/run-delta/predict/model'), true);
  assert.equal(isPredictSpecifier('@builderforce/run-delta/predictable'), false);
  assert.equal(isPredictSpecifier('@builderforce/run-delta/contract'), false);
});

test('the allowed directions pass: predict/ may import the contract and engine; others may import predict/', () => {
  const graph = graphOf([
    ['predict/risk.ts', ['contract.ts', 'engine/verdict.ts']],
    ['engine/verdict.ts', ['contract.ts']],
    ['registry/defaults.ts', ['predict/risk.ts']],
    ['index.ts', ['engine/verdict.ts', 'predict/risk.ts']],
    ['contract.ts', []],
  ]);
  assert.deepEqual(findLayerViolations(graph), []);
});

test('tests are exempt on both ends, and a cycle terminates', () => {
  const graph = graphOf([
    ['engine/verdict.test.ts', ['predict/risk.ts']],
    ['engine/a.ts', ['engine/b.ts', 'engine/a.test.ts']],
    ['engine/b.ts', ['engine/a.ts']],
    ['engine/a.test.ts', ['predict/risk.ts']],
    ['predict/risk.ts', []],
  ]);
  assert.deepEqual(findLayerViolations(graph), []);
  assert.equal(isVerdictFile(`${S}/engine/verdict.test.ts`), false);
  assert.equal(isVerdictFile(`${S}/engine/verdict.ts`), true);
  assert.equal(isVerdictFile(`${S}/registry/defaults.ts`), false);
});
