#!/usr/bin/env node
/**
 * FRONTEND LAYERING RATCHET — the direction of dependency inside `src/domains/`.
 *
 * ── WHY THIS EXISTS, AND WHY IT EXISTS NOW ───────────────────────────────────
 * PRD 22 §3.15 recorded that every architecture ratchet in this repository was
 * API-side: `api/scripts/` has `check-layering.mjs` and twenty more, and
 * `frontend/scripts/` enforced design tokens, transport and scale — nothing about
 * layering. Its Phase 0 item 5 is explicit about the ordering, and the reason is
 * the whole value of the guard:
 *
 *   > These must exist *before* Phase 3 moves code, or the move's mistakes
 *   > become the baseline.
 *
 * The first §3.4 move — the canvas DOMAIN layer — landed on 2026-08-20. This
 * guard lands directly behind it, while the baseline is still small enough to
 * read, rather than after the application and presentation slices when it would
 * be a list nobody audits.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────
 * A domain is `src/domains/<context>/` with up to four layers. Dependencies point
 * INWARD only:
 *
 *     presentation → application → domain
 *     infrastructure → domain          (it implements the domain's ports)
 *
 * So the violations this catches are the outward ones:
 *
 *   - `domain/` importing `application/`, `infrastructure/` or `presentation/`
 *     — of its own context or anyone else's.
 *   - `domain/` or `application/` or `infrastructure/` importing `components/`
 *     or `app/`, which are presentation whatever folder they sit in.
 *   - `application/` importing `presentation/`.
 *
 * That last family is the one that actually bites. `CanvasObjectData` used to be
 * declared in `components/creation-canvas/types.ts`, so every domain module that
 * needed the core type of its own aggregate would have imported UPWARD from a
 * component — and once one does, the rule is dead and backend table shapes start
 * arriving in component props, which is §3.5's god module in miniature.
 *
 * ── WHY A RATCHET AND NOT A WALL ─────────────────────────────────────────────
 * Same shape as `api/scripts/check-layering.mjs`, deliberately: a NEW violation
 * fails, and a baseline entry that no longer violates ALSO fails so the list
 * cannot silently keep stale debt. Today the baseline is empty, which is the
 * point of landing this before the remaining moves — the first entry anyone adds
 * has to be argued for in a diff.
 *
 * ── WHAT IS DELIBERATELY NOT ENFORCED YET ────────────────────────────────────
 * `src/lib/` is unclassified. It holds genuine domain material (the context map
 * itself is `lib/canvas/boundedContexts.ts`), typed API clients that are really
 * infrastructure, and pure helpers. Forbidding it would fail on day one for
 * correct reasons and teach everyone to add baseline lines, which is how a
 * ratchet becomes decoration. Classifying `lib/` is its own pass; this guard
 * enforces the direction that is unambiguous today.
 *
 * Run via `node scripts/check-layering.mjs`; wired into `npm test` through
 * `scripts/checks.manifest.mjs`. `--update` rewrites the baseline.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const srcDir = resolve(here, '../src');
const domainsDir = resolve(srcDir, 'domains');
const baselineFile = resolve(here, '.layering-baseline.txt');

const UPDATE = process.argv.includes('--update');

/**
 * What each layer may NOT depend on, as a matcher over the resolved specifier.
 *
 * Type-only imports are excluded before this runs: TypeScript erases them, so
 * they cross no runtime boundary. That is not a loophole — it is the same
 * allowance the api guard makes, and it is what lets a domain port name a shape
 * that a presentation module also names without a runtime edge between them.
 */
const FORBIDDEN = {
  domain: [
    { test: (s) => /^@\/domains\/[^/]+\/(application|infrastructure|presentation)\//.test(s), why: 'domain may not depend on an outer layer' },
    { test: (s) => /^@\/(components|app)\//.test(s), why: 'domain may not depend on presentation' },
  ],
  application: [
    { test: (s) => /^@\/domains\/[^/]+\/presentation\//.test(s), why: 'application may not depend on presentation' },
    { test: (s) => /^@\/(components|app)\//.test(s), why: 'application may not depend on presentation' },
  ],
  infrastructure: [
    { test: (s) => /^@\/domains\/[^/]+\/presentation\//.test(s), why: 'infrastructure may not depend on presentation' },
    { test: (s) => /^@\/(components|app)\//.test(s), why: 'infrastructure may not depend on presentation' },
  ],
};

const LAYERS = Object.keys(FORBIDDEN);

/** Every `from '…'` specifier in a RUNTIME import (i.e. not `import type`). */
function runtimeImports(text) {
  const specifiers = [];
  const pattern = /(?:^|\n)\s*(?:import|export)\s+([^;]*?)\bfrom\s+['"]([^'"]+)['"]/g;
  for (const match of text.matchAll(pattern)) {
    const clause = match[1] ?? '';
    // `import type { X } from` and `export type { X } from` are erased.
    if (/^\s*type\b/.test(clause)) continue;
    specifiers.push({ specifier: match[2], clause });
  }
  return specifiers;
}

function collect(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Repo-relative, forward-slashed, used as the baseline key. */
function key(file) {
  return relative(srcDir, file).split('\\').join('/');
}

/** The layer a file belongs to: `domains/<context>/<layer>/…`. */
function layerOf(relPath) {
  const match = relPath.match(/^domains\/[^/]+\/([^/]+)\//);
  return match && LAYERS.includes(match[1]) ? match[1] : null;
}

const current = new Map();
for (const file of collect(domainsDir)) {
  const relPath = key(file);
  // A test may reach anywhere to build a fixture; it is not the shipped call graph.
  if (/\.test\.tsx?$/.test(relPath)) continue;
  const layer = layerOf(relPath);
  if (!layer) continue;
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  for (const { specifier } of runtimeImports(text)) {
    for (const rule of FORBIDDEN[layer]) {
      if (rule.test(specifier)) current.set(relPath, `${rule.why} (imports '${specifier}')`);
    }
  }
}

if (UPDATE) {
  const header =
    '# Files under src/domains/ whose imports point OUTWARD, against the layering.\n' +
    '# This list may only SHRINK — see scripts/check-layering.mjs.\n' +
    '# Regenerate with: node scripts/check-layering.mjs --update\n';
  writeFileSync(baselineFile, header + [...current.keys()].sort().join('\n') + (current.size ? '\n' : ''), 'utf8');
  console.log(`Baseline rewritten: ${current.size} file(s).`);
  process.exit(0);
}

const baseline = new Set(
  existsSync(baselineFile)
    ? readFileSync(baselineFile, 'utf8')
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'))
    : [],
);

const added = [...current.keys()].filter((file) => !baseline.has(file)).sort();
const cleaned = [...baseline].filter((file) => !current.has(file)).sort();

let failed = false;

if (added.length > 0) {
  failed = true;
  console.error(`❌  New outward dependency in src/domains/ (${added.length}):\n`);
  for (const file of added) console.error(`      - ${file}\n        ${current.get(file)}`);
  console.error(
    '\n   Dependencies point INWARD: presentation → application → domain, and' +
      '\n   infrastructure → domain. A domain module that needs a type declared in a' +
      "\n   component does not import it — the type moves, and the component's copy" +
      '\n   becomes an alias (see components/creation-canvas/types.ts).' +
      '\n   The baseline is frozen debt; it may only shrink.\n',
  );
}

if (cleaned.length > 0) {
  failed = true;
  console.error(`✅→❌  ${cleaned.length} baseline entr(ies) no longer violate — remove them so the ratchet holds:\n`);
  for (const file of cleaned) console.error(`      - ${file}`);
  console.error('\n   Delete those lines from scripts/.layering-baseline.txt (or run: node scripts/check-layering.mjs --update).\n');
}

if (failed) process.exit(1);

const scanned = collect(domainsDir).filter((file) => layerOf(key(file)) && !/\.test\.tsx?$/.test(key(file))).length;
console.log(
  `✅  Frontend layering ratchet OK — ${scanned} layered module(s) under src/domains/, ` +
    `${current.size} known violation(s), 0 new.`,
);
