#!/usr/bin/env node
/**
 * Wordmark guard — the product is written `Builderforce.ai` (BRAND.name in
 * `src/lib/content/brand.ts`). The operator decision is that the camel-cased
 * `BuilderForce.ai` is wrong everywhere a user or a reader can see it, so any
 * occurrence fails. In TS/TSX import `BRAND.name` rather than typing the name;
 * in the catalogs write `Builderforce.ai`.
 *
 * Scanned: `frontend/src`, `api/src` and every `clients/<client>/src`.
 *
 * Two narrow exemptions, both because a DBA is a REGISTERED LEGAL NAME, not a
 * spelling of the product:
 *   1. the exact legal-entity string `Fix Faster LLC dba BuilderForce.ai`
 *      (LEGAL_DBA below) — removed from a line before it is tested, so any other
 *      `BuilderForce.ai` on the same line still fails;
 *   2. the API's legal-document files (LEGAL_DOCUMENT_FILES), which carry the
 *      DBA throughout and are pinned by tests and migration 0403.
 *
 * `BuilderForce Agents` (a separate product name) and package names do not
 * match the pattern and are untouched.
 *
 * Run via `npm run check:wordmark`; wired into `npm test` / `pnpm run check`
 * through `checks.manifest.mjs`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(ROOT, '..');
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.css', '.md', '.mdx']);
const WRONG = /BuilderForce\.ai/;

/** The registered legal name of the operating entity — exact, never a pattern. */
const LEGAL_DBA = 'Fix Faster LLC dba BuilderForce.ai';

/** API legal documents (repo-relative, forward slashes): they hold the DBA by design. */
const LEGAL_DOCUMENT_FILES = new Set([
  'api/src/application/legal/defaultLegalDocuments.ts',
  'api/src/application/legal/defaultLegalDocuments.test.ts',
  'api/src/application/legal/legalDocsService.ts',
]);

const clientsDir = resolve(REPO, 'clients');
const clientSrcs = existsSync(clientsDir)
  ? readdirSync(clientsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => resolve(clientsDir, entry.name, 'src'))
  : [];
const ROOTS = [resolve(ROOT, 'src'), resolve(REPO, 'api', 'src'), ...clientSrcs].filter((dir) => existsSync(dir));

const hits = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      walk(full);
    } else if (EXTENSIONS.has(extname(entry.name))) {
      const repoRelative = relative(REPO, full).split(sep).join('/');
      if (LEGAL_DOCUMENT_FILES.has(repoRelative)) continue;
      readFileSync(full, 'utf8').split('\n').forEach((line, index) => {
        if (WRONG.test(line.split(LEGAL_DBA).join(''))) hits.push(`${repoRelative}:${index + 1}`);
      });
    }
  }
}

for (const dir of ROOTS) walk(dir);

if (hits.length > 0) {
  console.error(`❌  Wordmark check failed (${hits.length}): write \`Builderforce.ai\` (BRAND.name), not \`BuilderForce.ai\`.\n`);
  for (const hit of hits) console.error(`  - ${hit}`);
  process.exit(1);
}

console.log(`✅  Wordmark check passed — no \`BuilderForce.ai\` under ${ROOTS.length} source roots (legal DBA exempt).`);
