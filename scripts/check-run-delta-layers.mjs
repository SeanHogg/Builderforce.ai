#!/usr/bin/env node
/**
 * Run-delta layering guard (PRD 41 §D0, WS15): measured decides, predicted advises.
 *
 * Fails when any non-test file under `packages/run-delta/src/{engine,rules,verdict}/**`
 * reaches `packages/run-delta/src/predict/**` — by a relative import, through any chain of
 * the package's own files (a barrel re-exporting `predict/` counts), through the package's
 * own bare name (`@builderforce/run-delta`, resolved by its `exports`), or by naming
 * `@builderforce/run-delta/predict`. Type-only imports count too: a verdict that can see a
 * prediction's type is one refactor away from reading its value.
 *
 * The rule itself lives in scripts/lib/runDeltaLayers.mjs (pinned by its test); imports are
 * read from the TypeScript AST (scripts/lib/moduleImports.mjs), never by regex.
 * Run from anywhere; it derives the repo root from its own location.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSourceFiles, loadTypeScript, parseModuleSpecifiers, resolveRelativeFile, toPosix } from './lib/moduleImports.mjs';
import { PACKAGE_NAME, RUN_DELTA_SRC, findLayerViolations } from './lib/runDeltaLayers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, ...RUN_DELTA_SRC.split('/'));
const pkgDir = path.dirname(srcDir);

if (!existsSync(srcDir)) {
  console.error(`check:run-delta-layers: ${RUN_DELTA_SRC} does not exist — the guard has nothing to hold, which is a failure, not a pass.`);
  process.exit(1);
}

/** The package's own bare specifiers → the file each resolves to, from its `exports`. */
function selfExports() {
  const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
    const file = typeof target === 'string' ? target : target?.import ?? target?.default ?? target?.types;
    if (typeof file !== 'string') continue;
    out.set(subpath === '.' ? PACKAGE_NAME : `${PACKAGE_NAME}/${subpath.replace(/^\.\//, '')}`, path.resolve(pkgDir, file));
  }
  return out;
}

const ts = loadTypeScript(root);
const self = selfExports();
const rel = (file) => toPosix(path.relative(root, file));

/** @type {Map<string, import('./lib/runDeltaLayers.mjs').FileImports>} */
const graph = new Map();
for (const file of collectSourceFiles(srcDir)) {
  const specifiers = parseModuleSpecifiers(ts, file, readFileSync(file, 'utf8')).map((s) => s.specifier);
  const targets = specifiers
    .map((specifier) => (specifier.startsWith('.') ? resolveRelativeFile(file, specifier) : self.get(specifier) ?? null))
    .filter((target) => target !== null && target.startsWith(srcDir + path.sep))
    .map(rel);
  graph.set(rel(file), { specifiers, targets });
}

const violations = findLayerViolations(graph);
if (violations.length) {
  console.error(`❌  Run-delta layers (PRD 41 §D0): ${violations.length} verdict-side file(s) reach predict/.\n`);
  for (const { file, chain } of violations) console.error(`  - ${file}\n      ${chain.join('\n      → ')}`);
  console.error('\n   A prediction never sets or changes a verdict. Move what the verdict needs out of predict/ (into the delta contract), or move the code that reads a prediction out of engine/, rules/ and verdict/.');
  process.exit(1);
}
console.log(`✅  Run-delta layers: ${graph.size} file(s) read — nothing under engine/, rules/ or verdict/ reaches predict/.`);
