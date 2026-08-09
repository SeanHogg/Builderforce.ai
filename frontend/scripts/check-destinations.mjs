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
 * Six checks, all cheap enough to run in `npm test`:
 *
 *   1. ONE DECLARATION — no second array of {href, labelKey} objects.
 *   2. NO DUPLICATE LABELS — two rows resolving to one name is the bug returning.
 *   3. NO MARKETING HREF IN THE APP RAIL — a destination never sends a signed-in
 *      person to an explainer page.
 *   4. EVERY SEAT HAS A HUE, and no two seats share one.
 *   5. EVERY PUBLIC ROW RESOLVES — unique URL, copy that exists, and a footer
 *      column that lists only ids the registry declares.
 *   6. EVERY DECLARED PANEL SECTION EXISTS — the index rail cannot advertise an
 *      anchor its page stopped rendering.
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
  // `src/lib/content.ts` used to sit here, exempted as "marketing CONTENT, not
  // app destinations". The exemption was FALSE, and the ratchet stayed green
  // while `FOOTER_COLUMNS` and `RESOURCE_NAV_LINKS` — the site footer and the
  // Learn ▾ menu — declared destinations behind it. That is how the storefront
  // came to be called "Workforce Registry" in the footer and "Marketplace"
  // everywhere else, and how an `/agents` link outlived the `/agents`
  // destination. Both lists are registry rows now, and the exemption is gone:
  // an allow-list entry is only as good as the sentence justifying it, so this
  // one is left in place as a comment rather than deleted silently.
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
// Only the EXPLAINER rows. `/marketplace` is both a public page and an app
// destination — one place with one name — and flagging that would be flagging
// the unification itself. What must never happen is a rail row pointing at a
// `panel: true` row, i.e. at a page that exists to describe the product rather
// than to be it.
const marketingHrefs = new Set(
  [...registrySource.matchAll(/marketingHref:\s*'([^']+)',[\s\S]{0,300}?panel:\s*true/g)].map((m) => m[1]),
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
const referenceBlock = registrySource.match(/export const PUBLIC_DESTINATIONS[\s\S]*?\n\];/)?.[0] ?? '';
if (!referenceBlock) fail('[registry] PUBLIC_DESTINATIONS could not be located in navGroups.ts.');
const copy = JSON.parse(fs.readFileSync(path.join(SRC, 'i18n', 'messages', 'en.json'), 'utf8'));
const domainCopy = copy?.burnrateMarketing?.domains ?? {};

const seenHrefs = new Set();
for (const href of [...referenceBlock.matchAll(/marketingHref:\s*'([^']+)'/g)].map((m) => m[1])) {
  if (seenHrefs.has(href)) fail(`[reference] Two public rows claim \`${href}\`. A URL has one owner.`);
  seenHrefs.add(href);
}
for (const copyId of [...referenceBlock.matchAll(/copyId:\s*'([^']+)'/g)].map((m) => m[1])) {
  if (!domainCopy[copyId]) {
    fail(`[reference] \`${copyId}\` has no copy under burnrateMarketing.domains in en.json.`);
  }
}

// Every footer column id must be a row. A footer that lists an id nobody
// declares renders a shorter column and says nothing about why.
const declaredIds = new Set([...referenceBlock.matchAll(/\bid:\s*'([^']+)'/g)].map((m) => m[1]));
const footerBlock = registrySource.match(/export const FOOTER_COLUMNS[\s\S]*?\n\];/)?.[0] ?? '';
for (const column of footerBlock.matchAll(/ids:\s*\[([^\]]*)\]/g)) {
  for (const [, id] of column[1].matchAll(/'([^']+)'/g)) {
    if (!declaredIds.has(id)) fail(`[footer] Footer column lists \`${id}\`, which is not a public destination.`);
  }
}

// Two public pages may not claim the same rail row. The Product menu links a
// destination to whichever page is bound to it, so a duplicate `groupId` would
// pick a winner silently — and `/product-management` vs `/survival-focused-agile`
// for "Projects" is exactly the case where the silent pick would be wrong.
const boundGroups = new Set();
for (const row of referenceBlock.matchAll(/groupId:\s*'([^']+)'/g)) {
  const id = row[1];
  if (boundGroups.has(id)) {
    fail(`[public-face] Two public pages both claim to be the face of \`${id}\`. A row has one.`);
  }
  boundGroups.add(id);
  if (!(groupBlock?.[0] ?? '').includes(`id: '${id}'`)) {
    fail(`[public-face] A public page is bound to \`${id}\`, which is not a NAV_GROUPS row.`);
  }
}

// ── 6 · Every declared panel section exists in the page that owns it ───────
// The panel's index rail is declared on the registry row. If a page renames an
// anchor, the rail silently scrolls nowhere — so the ids are asserted against
// the route's own source rather than trusted.
for (const row of referenceBlock.matchAll(/marketingHref:\s*'([^']+)',[\s\S]{0,400}?sections:\s*\[([\s\S]*?)\n\s*\],/g)) {
  const [, href, body] = row;
  const pageFile = path.join(SRC, 'app', href.replace(/^\//, ''), 'page.tsx');
  if (!fs.existsSync(pageFile)) {
    fail(`[sections] \`${href}\` declares panel sections but ${path.relative(ROOT, pageFile)} does not exist.`);
    continue;
  }
  const pageSource = fs.readFileSync(pageFile, 'utf8');
  for (const [, id] of body.matchAll(/\bid:\s*'([^']+)'/g)) {
    if (!pageSource.includes(`id="${id}"`)) {
      fail(`[sections] \`${href}\` declares section \`${id}\`, which its page never renders as an anchor.`);
    }
  }
}

// ── report ─────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(`\n❌ check-destinations — ${failures.length} problem(s):\n`);
  for (const message of failures) console.error(`  ${message}\n`);
  process.exit(1);
}

console.log(
  `✅ check-destinations OK — ${labelKeys.length} app destinations and ${seenHrefs.size} public pages ` +
  `in one registry; ${seatList.length} seats, ${hueByVar.size} distinct hues.`,
);
