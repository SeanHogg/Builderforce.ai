#!/usr/bin/env node
/**
 * Version-sync guard.
 *
 * `src/version.ts` is what the API reports about itself — `GET /health`, the error
 * handler's response header, and every Copy-diagnostics capture read it. It is a
 * hand-written literal, and it silently drifted **44 releases** behind
 * `package.json` (2026.7.115 vs 2026.7.159).
 *
 * The cost was not cosmetic. A diagnostics report is used to answer "is my fix
 * deployed?", and for weeks it answered with a version that had not been live in
 * weeks — so a real investigation went looking for a stale deploy that did not exist,
 * while the actual defect sat elsewhere. A number that is wrong is worse than a number
 * that is absent, because it is trusted.
 *
 * The pairing is only safe if something enforces it, so this does. Run via
 * `npm run check:version`, wired into `npm test`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(here, '..', 'package.json');
const versionPath = resolve(here, '..', 'src', 'version.ts');

const pkgVersion = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
const source = readFileSync(versionPath, 'utf8');
const match = /export const API_VERSION\s*=\s*'([^']+)'/.exec(source);

if (!match) {
  console.error('❌  check:version — could not find `export const API_VERSION = \'…\'` in src/version.ts.');
  process.exit(1);
}

const declared = match[1];
if (declared !== pkgVersion) {
  console.error(
    '❌  check:version — API_VERSION is out of sync with package.json.\n'
    + `      src/version.ts : ${declared}\n`
    + `      package.json   : ${pkgVersion}\n\n`
    + '    The API reports src/version.ts from /health and in every diagnostics capture,\n'
    + '    so a stale value makes those reports claim a build that is not deployed.\n'
    + `    Fix: set API_VERSION to '${pkgVersion}' in api/src/version.ts.`,
  );
  process.exit(1);
}

console.log(`✅  Version sync OK — API_VERSION and package.json both ${pkgVersion}.`);
