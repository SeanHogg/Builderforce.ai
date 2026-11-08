#!/usr/bin/env node
/**
 * The vendor-fact rule for comparison content (docs/marketing/CLAIMS-PROCESS.md §6).
 *
 * Comparison copy is criteria-first. A sentence that states a vendor-specific
 * fact — a price or currency amount, a percentage, a user/customer count, a
 * version number — is allowed only with a sourced record in
 * `COMPARE_VENDOR_FACT_SOURCES` (data: frontend/src/lib/content/compareVendorFactSources.json):
 * `{ key, source, observed, reviewer, reviewBy }`, where `reviewBy` is at most
 * 30 days after `observed`. An expired `reviewBy` fails.
 *
 * Scope is by PATTERN, so new vendors and new leaves are covered without a list:
 *   - every string under `compare.competitors.<vendor>.*` (leaf narratives), and
 *   - every vendor cell `compare.arenas.<arena>.categories.N.rows.M.values.<vendor>`
 *     except the Builderforce column (`values.builderforce`), which describes this
 *     product, not a vendor.
 * All five locale catalogs are scanned; a record's `key` covers every locale.
 *
 * Counts that describe Builderforce itself ("seven roles") are spelled-out words
 * or sit in the Builderforce column, and none of the patterns below match words.
 *
 * Run via `npm run check:compare-vendor-facts`; wired into `npm run check`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MESSAGES = path.join(ROOT, 'src', 'i18n', 'messages');
const SOURCES_JSON = path.join(ROOT, 'src', 'lib', 'content', 'compareVendorFactSources.json');
const LOCALES = ['en', 'zh', 'es', 'fr', 'de'];
const MAX_REVIEW_DAYS = 30;
const DAY_MS = 86_400_000;

const failures = [];
const fail = (message) => failures.push(message);

/** A vendor fact: price/currency, percentage, per-unit rate, version, or audience count. */
const FACT_PATTERNS = [
  ['price', /[$€£¥]\s?\d|\d\s?[$€£¥]|\d\s?(?:USD|EUR|GBP|美元|欧元|元|dollars?|dólares|euros?|dollar)\b/iu],
  ['rate', /\d\s?\/\s?(?:mo|month|seat|user|yr|year|Monat|mes|mois)\b|\bper\s+(?:seat|user|month)\b/iu],
  ['percentage', /\d\s?%/u],
  ['version', /\bv\d+(?:\.\d+)*\b|\bversion\s+\d/iu],
  ['count', /\d[\d,.]*\s?[kKmM]?\+?\s*(?:users|developers|customers|companies|stars|utilisateurs|usuarios|Nutzer|用户|开发者)/iu],
];

function flatten(node, prefix = '') {
  if (node === null || typeof node !== 'object') return [[prefix, node]];
  return Object.entries(node).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k));
}

/** Is this catalog key a vendor surface (leaf narrative or a vendor's matrix cell)? */
function isVendorSurface(key) {
  if (/^compare\.competitors\.[^.]+\./.test(key)) return true;
  const cell = key.match(/^compare\.arenas\.[^.]+\.categories\.\d+\.rows\.\d+\.values\.([^.]+)$/);
  return Boolean(cell) && cell[1] !== 'builderforce';
}

// ── the sourced records, read directly from the JSON data file ─────────────
// Expiry deliberately fails CI on the `reviewBy` date (consistent with
// MARKETING_CLAIMS): a stale vendor fact must be re-observed or rewritten.
let sourceRecords = [];
try {
  sourceRecords = JSON.parse(fs.readFileSync(SOURCES_JSON, 'utf8'));
  if (!Array.isArray(sourceRecords)) throw new Error('top level must be an array');
} catch (err) {
  fail(`[sources] compareVendorFactSources.json could not be read: ${err.message}`);
  sourceRecords = [];
}
const records = new Map();
for (const raw of sourceRecords) {
  const field = (name) => (typeof raw?.[name] === 'string' ? raw[name] : undefined);
  const rec = {
    key: field('key'), source: field('source'), observed: field('observed'),
    reviewer: field('reviewer'), reviewBy: field('reviewBy'),
  };
  const label = rec.key ?? '(record without key)';
  for (const f of ['key', 'source', 'observed', 'reviewer', 'reviewBy']) {
    if (!rec[f]) fail(`[sources] ${label}: \`${f}\` is missing.`);
  }
  if (rec.source && !/^https:\/\//.test(rec.source)) fail(`[sources] ${label}: source must be an https:// primary-source URL.`);
  const observed = Date.parse(rec.observed ?? '');
  const reviewBy = Date.parse(rec.reviewBy ?? '');
  if (rec.observed && Number.isNaN(observed)) fail(`[sources] ${label}: observed is not an ISO date.`);
  if (rec.reviewBy && Number.isNaN(reviewBy)) fail(`[sources] ${label}: reviewBy is not an ISO date.`);
  if (!Number.isNaN(observed) && !Number.isNaN(reviewBy)) {
    if (reviewBy - observed > MAX_REVIEW_DAYS * DAY_MS) {
      fail(`[sources] ${label}: reviewBy is more than ${MAX_REVIEW_DAYS} days after observed.`);
    }
    if (reviewBy < observed) fail(`[sources] ${label}: reviewBy is before observed.`);
    if (reviewBy < Date.now()) {
      fail(`[expired] ${label}: reviewBy ${rec.reviewBy} has passed — re-observe the source or rewrite the copy criteria-first.`);
    }
  }
  if (rec.key) records.set(rec.key, rec);
}

// ── the copy ───────────────────────────────────────────────────────────────
const catalogs = LOCALES.map((locale) => {
  const messages = JSON.parse(fs.readFileSync(path.join(MESSAGES, `${locale}.json`), 'utf8'));
  return [locale, flatten(messages.compare ?? {}, 'compare')];
});

let scanned = 0;
const factKeys = new Set();
for (const [locale, entries] of catalogs) {
  for (const [key, value] of entries) {
    if (typeof value !== 'string' || !isVendorSurface(key)) continue;
    scanned += 1;
    const hit = FACT_PATTERNS.find(([, re]) => re.test(value));
    if (!hit) continue;
    factKeys.add(key);
    if (!records.has(key)) {
      fail(
        `[vendor-fact] ${locale}.json \`${key}\` states a vendor ${hit[0]}: ${JSON.stringify(value.slice(0, 140))}\n` +
        '    Rewrite it criteria-first, or add a COMPARE_VENDOR_FACT_SOURCES record (source, observed, reviewer, reviewBy <= observed + 30d).',
      );
    }
  }
}
for (const key of records.keys()) {
  if (!key.startsWith('compare.')) fail(`[sources] ${key}: records cover keys under \`compare.\` only.`);
  else if (!factKeys.has(key)) fail(`[sources] ${key}: no vendor fact is stated at this key any more — remove the record.`);
}

if (failures.length > 0) {
  console.error(`\n❌ check-compare-vendor-facts — ${failures.length} problem(s):\n`);
  for (const message of failures) console.error(`  ${message}\n`);
  process.exit(1);
}
console.log(`✅ check-compare-vendor-facts OK — ${scanned} vendor strings across ${LOCALES.length} locales state no unsourced vendor fact.`);
