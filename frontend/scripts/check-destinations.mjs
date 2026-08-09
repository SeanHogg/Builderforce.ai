#!/usr/bin/env node
/**
 * The destination ratchet (PRD 21 §11.7.1).
 *
 * The unified menu is not held together by review. It is held together by there
 * being exactly ONE place a navigable destination can be declared — because the
 * failure it undoes was not carelessness. Four people each added the first list
 * for their own layer (`NAV_GROUPS` for the rail, `BURNRATE_DOMAINS` for
 * marketing, kernel `DOMAINS` for the data model, the roster for the footer),
 * and the CFO ended up existing four times under four names, one of which
 * navigated out of the product into a marketing page.
 *
 * Five checks, all cheap enough to run in `npm test`:
 *
 *   1. ONE DECLARATION — no second array of {href, labelKey} objects.
 *   2. NO DUPLICATE LABELS — two rows resolving to one name is the bug returning.
 *   3. NO MARKETING HREF IN THE APP RAIL — a destination never sends a signed-in
 *      person to an explainer page.
 *   4. EVERY SEAT HAS A HUE, and no two seats share one.
 *   5. EVERY REFERENCE ROW RESOLVES — unique slug, and copy that exists.
 *
 * Deliberately NOT ratcheted: the number of destinations. PRD 18/19 add
 * hundreds of leaves and a count would fight them. What is ratcheted is the
 * number of REGISTRIES, and that number is 1.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const REGISTRY = path.join(SRC, 'lib', 'navGroups.ts');

/**
 * Files allowed to declare something that LOOKS like a destination list. Every
 * entry carries a written reason — the pattern §2.7 settled on after a
 * count-based ratchet went slack, because a number lets a file sit there
 * looking like progress while a list makes the next author say out loud why a
 * registry row cannot reach their case.
 */
const ALLOWED = new Map([
  ['src/lib/navGroups.ts', 'THE registry. This is the one place.'],
  ['src/lib/content.ts', 'Marketing CONTENT (blog, tutorials, resource links) — not app destinations, and not reachable from the rail.'],
  ['src/lib/adminGroups.ts', 'Level-2 sub-views of the Platform Admin destination, which the registry references by import rather than restating.'],
  ['src/lib/destinations/registry.ts', 'A DERIVED projection for the ⌘K palette — it flattens the registry, and declares nothing of its own beyond two canvas rows.'],
]);

const failures = [];
const fail = (message) => failures.push(message);

/** Every .ts/.tsx under src, minus tests and node_modules. */
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const registrySource = fs.readFileSync(REGISTRY, 'utf8');

// ── 1 · One declaration ────────────────────────────────────────────────────
// An object literal carrying BOTH a route-ish field and a label-ish field is a
// destination by any other name. Looking for the PAIR rather than for either
// half is what keeps this quiet: a link list with only hrefs is a link list.
const DESTINATION_SHAPE = /\{[^{}]*\b(?:href|route|path)\s*:[^{}]*\b(?:labelKey|menuLabel|labelId)\s*:[^{}]*\}/;

for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (ALLOWED.has(rel)) continue;
  const source = fs.readFileSync(file, 'utf8');
  if (DESTINATION_SHAPE.test(source)) {
    fail(
      `[one-declaration] ${rel} declares an object with both a route and a label.\n` +
      '    A destination belongs in src/lib/navGroups.ts. If this genuinely cannot,\n' +
      "    add it to ALLOWED in this script with the reason written out.",
    );
  }
}

// ── 2 · No duplicate labels ────────────────────────────────────────────────
const groupBlock = registrySource.match(/export const NAV_GROUPS[\s\S]*?\n\];/);
if (!groupBlock) fail('[registry] NAV_GROUPS could not be located in navGroups.ts.');

const labelKeys = [...(groupBlock?.[0] ?? '').matchAll(/labelKey:\s*'([^']+)'/g)].map((m) => m[1]);
const seenLabels = new Set();
for (const key of labelKeys) {
  if (seenLabels.has(key)) fail(`[duplicate-label] Two destinations resolve to \`${key}\`. One name, one row.`);
  seenLabels.add(key);
}

// ── 3 · No marketing href in the app rail ──────────────────────────────────
// The exact bug this whole PRD exists to undo: the authenticated rail rendering
// nine rows that navigated OUT of the product into marketing pages.
const marketingHrefs = new Set(
  [...registrySource.matchAll(/marketingHref:\s*'([^']+)'/g)].map((m) => m[1]),
);
const groupHrefs = [...(groupBlock?.[0] ?? '').matchAll(/href:\s*'([^']+)'/g)].map((m) => m[1]);
for (const href of groupHrefs) {
  if (marketingHrefs.has(href)) {
    fail(
      `[marketing-href] A NAV_GROUPS row points at \`${href}\`, which is a reference page.\n` +
      '    Point it at the in-app destination; the explainer belongs in REFERENCE_DESTINATIONS.',
    );
  }
}

// ── 4 · Every seat has a hue, and no two share one ─────────────────────────
const seatsSource = fs.readFileSync(path.join(SRC, 'lib', 'seats.ts'), 'utf8');
const cssSource = fs.readFileSync(path.join(SRC, 'app', 'globals.css'), 'utf8');

const seatList = [...(seatsSource.match(/export const SEATS = \[[\s\S]*?\] as const;/)?.[0] ?? '')
  .matchAll(/'([^']+)'/g)].map((m) => m[1]);
if (seatList.length === 0) fail('[seats] SEATS could not be located in seats.ts.');

const seatVars = new Map(
  [...seatsSource.matchAll(/^\s{2}([A-Za-z]+):\s*'(--seat-[a-z-]+)',/gm)].map((m) => [m[1], m[2]]),
);

const hueByVar = new Map();
for (const seat of seatList) {
  const variable = seatVars.get(seat);
  if (!variable) {
    fail(`[seat-hue] Seat \`${seat}\` has no --seat-* mapping in lib/seats.ts.`);
    continue;
  }
  const declared = cssSource.match(new RegExp(`^\\s*${variable}:\\s*([^;]+);`, 'm'));
  if (!declared) {
    fail(`[seat-hue] \`${variable}\` is not declared in globals.css. Every seat needs a hue in both themes.`);
    continue;
  }
  const value = declared[1].trim();
  if (hueByVar.has(value)) {
    fail(
      `[seat-hue] \`${variable}\` and \`${hueByVar.get(value)}\` both resolve to ${value}.\n` +
      '    Two seats sharing a hue defeats the point: the badge stops identifying anyone.',
    );
  }
  hueByVar.set(value, variable);
}

// ── 5 · Every reference row resolves ───────────────────────────────────────
const referenceBlock = registrySource.match(/export const REFERENCE_DESTINATIONS[\s\S]*?\n\];/)?.[0] ?? '';
const copy = JSON.parse(fs.readFileSync(path.join(SRC, 'i18n', 'messages', 'en.json'), 'utf8'));
const domainCopy = copy?.burnrateMarketing?.domains ?? {};

const seenHrefs = new Set();
for (const row of referenceBlock.matchAll(/copyId:\s*'([^']+)'[\s\S]*?marketingHref:\s*'([^']+)'/g)) {
  const [, copyId, href] = row;
  if (seenHrefs.has(href)) fail(`[reference] Two reference rows claim \`${href}\`. A URL has one owner.`);
  seenHrefs.add(href);
  if (!domainCopy[copyId]) {
    fail(`[reference] \`${copyId}\` has no copy under burnrateMarketing.domains in en.json.`);
  }
}

// ── report ─────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(`\n❌ check-destinations — ${failures.length} problem(s):\n`);
  for (const message of failures) console.error(`  ${message}\n`);
  process.exit(1);
}

console.log(
  `✅ check-destinations OK — ${labelKeys.length} destinations and ${seenHrefs.size} reference pages ` +
  `in one registry; ${seatList.length} seats, ${hueByVar.size} distinct hues.`,
);
