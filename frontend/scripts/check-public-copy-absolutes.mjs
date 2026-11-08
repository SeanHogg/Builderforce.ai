#!/usr/bin/env node
/**
 * The tested-wording rule for PUBLIC marketing copy (docs/marketing/CLAIMS-PROCESS.md).
 *
 * An absolute — every, always, never, zero, entire, guarantee(s/d), unlimited, 100% —
 * in public copy is a product guarantee the Claim-to-Proof register may not back.
 * This is a RATCHET over `en.json`:
 *
 *   - a key under a public marketing namespace that matches the pattern and is
 *     NOT in `public-copy-absolutes.baseline.json` fails (a new absolute);
 *   - a baselined key whose matched WORD SET differs from the one recorded in the
 *     baseline fails — editing a baselined sentence to add a different absolute
 *     is a new absolute, not an approved one;
 *   - a baseline key that no longer matches fails with "remove from baseline"
 *     (the baseline only ever shrinks);
 *   - a baseline entry with no justification fails;
 *   - a public route that reads a catalog namespace missing from PUBLIC_NAMESPACES
 *     (and not in NON_COPY_NAMESPACES) fails, so the scanned list cannot silently
 *     fall behind the routes.
 *
 * Baseline shape: `{ "<catalog key>": { "words": ["every"], "why": "idiomatic: ..." } }`.
 * To clear a hit, scope the sentence to what is true (and translate it in all
 * five locales), or — only for idiomatic / rhetorical / descriptive-scope uses —
 * add the key with the matched words and a short justification. `why` starting
 * `claim-review-pending:` marks a known-unreviewed product claim: debt, not approval.
 *
 * Run via `npm run check:public-copy-absolutes`; wired into `npm run check`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', 'src');
const EN = path.join(SRC, 'i18n', 'messages', 'en.json');
const BASELINE = path.join(HERE, 'public-copy-absolutes.baseline.json');

export const PUBLIC_NAMESPACES = [
  'marketing', 'marketingNav', 'marketingTrust', 'marketingDeck', 'honestMarketing',
  'home', 'features', 'featuresPage', 'compare', 'pricing', 'product', 'about',
  'evermind', 'method', 'methodology', 'agents', 'openSource', 'burnrateMarketing',
  'routeMarketing', 'newsletter', 'blog', 'realize', 'bookDemo',
];

/**
 * Namespaces public routes read that carry navigation / chrome / tier labels, not
 * claim copy. Anything a public route reads that is in neither list fails the check.
 */
export const NON_COPY_NAMESPACES = ['nav', 'common', 'planBadge'];

/** Route roots under src/app whose pages are the signed-out marketing surface. */
const PUBLIC_ROUTE_ROOTS = [
  'page.tsx', 'about', 'compare', 'features', 'pricing', 'product', 'evermind', 'method',
  'agents', 'open-source', 'blog', 'realize', 'book-demo', '[burnrateDomain]',
];

const ABSOLUTE = /(?:\b(?:every|always|never|zero|entire|guarantee[ds]?|unlimited)\b|100\s?%)/gi;

/** The distinct absolutes in a sentence, lowercased, sorted. */
function absolutesIn(value) {
  return [...new Set([...value.matchAll(ABSOLUTE)].map((m) => m[0].toLowerCase().replace(/\s+/g, '')))].sort();
}

function flatten(node, prefix) {
  if (node === null || typeof node !== 'object') return [[prefix, node]];
  return Object.entries(node).flatMap(([k, v]) => flatten(v, `${prefix}.${k}`));
}

function sourceFiles(target) {
  const full = path.join(SRC, 'app', target);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return [full];
  return fs.readdirSync(full, { recursive: true })
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => path.join(full, f));
}

const en = JSON.parse(fs.readFileSync(EN, 'utf8'));
const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));

const hits = new Map(); // key -> { value, words }
for (const namespace of PUBLIC_NAMESPACES) {
  if (!(namespace in en)) continue;
  for (const [key, value] of flatten(en[namespace], namespace)) {
    if (typeof value !== 'string') continue;
    const words = absolutesIn(value);
    if (words.length > 0) hits.set(key, { value, words });
  }
}

const failures = [];
for (const [key, { value, words }] of hits) {
  const entry = baseline[key];
  if (!entry) {
    failures.push(
      `[new-absolute] ${key} uses ${words.map((w) => `"${w}"`).join(', ')}: ${JSON.stringify(value.slice(0, 120))}\n` +
      '    Scope it to what is true in all five locales, or (idiomatic/descriptive use only) add it to scripts/public-copy-absolutes.baseline.json with its words and a justification.',
    );
    continue;
  }
  const recorded = [...(entry.words ?? [])].map((w) => String(w).toLowerCase()).sort();
  if (recorded.join('|') !== words.join('|')) {
    failures.push(
      `[changed-absolute] ${key} now matches [${words.join(', ')}] but the baseline approved [${recorded.join(', ')}]. ` +
      'A different absolute is a new absolute: scope it, or re-justify it in the baseline.',
    );
  }
  if (typeof entry.why !== 'string' || entry.why.trim() === '') failures.push(`[baseline] ${key} has no justification.`);
}
for (const key of Object.keys(baseline)) {
  if (!hits.has(key)) failures.push(`[stale-baseline] ${key} no longer matches — remove it from public-copy-absolutes.baseline.json.`);
}

// Namespace completeness: every namespace a public route reads is scanned or known to carry no claim copy.
const NAMESPACE_CALL = /\b(?:useTranslations|getTranslations)\(\s*(?:\{\s*namespace:\s*)?['"`]([A-Za-z0-9_]+)(?:\.[A-Za-z0-9_.]+)?['"`]/g;
const known = new Set([...PUBLIC_NAMESPACES, ...NON_COPY_NAMESPACES]);
const unlisted = new Map();
for (const target of PUBLIC_ROUTE_ROOTS) {
  for (const file of sourceFiles(target)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(NAMESPACE_CALL)) {
      if (!known.has(m[1])) unlisted.set(m[1], path.relative(SRC, file).replaceAll('\\', '/'));
    }
  }
}
for (const [namespace, file] of unlisted) {
  failures.push(
    `[unscanned-namespace] ${file} reads catalog namespace "${namespace}", which is not in PUBLIC_NAMESPACES. ` +
    'Add it there (so its absolutes are checked) or to NON_COPY_NAMESPACES if it carries no claim copy.',
  );
}

if (failures.length > 0) {
  console.error(`\n❌ check-public-copy-absolutes — ${failures.length} problem(s):\n`);
  for (const message of failures) console.error(`  ${message}\n`);
  process.exit(1);
}
const pending = Object.values(baseline).filter((entry) => entry.why.startsWith('claim-review-pending')).length;
console.log(
  `✅ check-public-copy-absolutes OK — ${hits.size} baselined absolutes across ${PUBLIC_NAMESPACES.length} public namespaces ` +
  `(${pending} tagged claim-review-pending).`,
);
