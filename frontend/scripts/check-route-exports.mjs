#!/usr/bin/env node
/**
 * Route modules export a combination Next.js will actually compile.
 *
 * Sibling of `check-edge-runtime.mjs`, and it exists for the same reason: Next
 * enforces rules about what a `page`/`layout`/`route` module may export, and it
 * enforces them in the WEBPACK BUILD — so the cost of breaking one is a red
 * deploy several minutes in, long after typecheck, lint, the guards and vitest
 * have all gone green. Nothing in the local chain could see it, because none of
 * it is a type error and none of it is a test:
 *
 *   x "metadata" and "generateMetadata" cannot be exported at the same time,
 *     please keep one of them.
 *   ,-[src/app/references/shared/[token]/page.tsx:19:1]
 *
 * That one took the frontend deploy down. The two exports were not even in
 * conflict about anything — the static `metadata` set `robots: noindex` and the
 * async one set the SAME flags plus a localized title — which is exactly how it
 * got written and reviewed without anyone seeing a problem. The rule is
 * structural, not semantic: Next refuses the pair, whatever they say.
 *
 * A localized route needs `generateMetadata` (the title comes from the catalog
 * through `getTranslations`), so the resolution is always the same — keep the
 * async form and fold the static object's fields into its return value.
 *
 * Run via `npm run check:route-exports`; wired into `npm test` with the other
 * guards and into the deploy job before `cf-build`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const appDir = resolve(here, '../src/app');

/** Module kinds Next applies the export rules to. */
const ROUTE_FILES = /^(page|layout|route|default|error|loading|not-found|template)\.(tsx|ts)$/;

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /^\s*\/\/.*$/gm;

/**
 * Pairs Next refuses to compile in one module, with the resolution that is
 * always right for this codebase. `both` names the two export forms; a rule
 * fires only when BOTH are present.
 */
const EXCLUSIVE_EXPORTS = [
  {
    a: { name: 'metadata', test: /export\s+(?:const|let|var)\s+metadata\b/ },
    b: { name: 'generateMetadata', test: /export\s+(?:async\s+)?function\s+generateMetadata\b|export\s+(?:const|let|var)\s+generateMetadata\b/ },
    fix: 'keep generateMetadata (a localized title needs the async form) and move the static object\'s fields into what it returns',
  },
  {
    a: { name: 'viewport', test: /export\s+(?:const|let|var)\s+viewport\b/ },
    b: { name: 'generateViewport', test: /export\s+(?:async\s+)?function\s+generateViewport\b|export\s+(?:const|let|var)\s+generateViewport\b/ },
    fix: 'keep one of them — generateViewport if any field depends on the request',
  },
];

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (ROUTE_FILES.test(entry.name)) out.push(full);
  }
  return out;
}

const violations = [];

for (const file of collect(appDir)) {
  // Comments are stripped so a documented example inside a doc block — the way
  // this very rule is described in the file it broke — is not read as an export.
  const source = readFileSync(file, 'utf8').replace(BLOCK_COMMENT, '').replace(LINE_COMMENT, '');
  for (const rule of EXCLUSIVE_EXPORTS) {
    if (rule.a.test.test(source) && rule.b.test.test(source)) {
      violations.push({
        file: relative(appDir, file).split('\\').join('/'),
        pair: `${rule.a.name} + ${rule.b.name}`,
        fix: rule.fix,
      });
    }
  }
}

if (violations.length > 0) {
  console.error(`❌  Route export check failed (${violations.length} module(s)):\n`);
  for (const v of violations) {
    console.error(`  - ${v.file}  exports ${v.pair}`);
    console.error(`      · ${v.fix}`);
  }
  console.error(
    '\n   Next.js rejects these pairs in the webpack build, so every one of them' +
      '\n   is a red deploy that no typecheck, lint or test can see first.\n',
  );
  process.exit(1);
}

console.log('✅  Route export check passed — no App Router module exports a pair Next.js rejects.');
