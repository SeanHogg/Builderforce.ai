#!/usr/bin/env node
/**
 * Design-scale ratchets (PRD 21 §2.9 item 3).
 *
 * The token guard beside this one proves every `var(--x)` resolves. It cannot
 * see the two failures that actually keep the design system unadopted, because
 * neither is invalid CSS:
 *
 *   - **A literal hex.** `#0a0f1a` renders identically in both themes, so a
 *     surface written that way is legible in the one the author had open and
 *     wrong in the other. 403 files carried one when this landed; 341 do now —
 *     the sweep replaced every literal that was EXACTLY a declared token's value
 *     in one of the two themes, which is the half that needs no judgement. What
 *     is left needs a reading of the element (is this `#fff` ink, or a surface?)
 *     and comes down per directory.
 *   - **An off-scale radius.** §2.4 documents five values (6 / 8 / 12 / 16 /
 *     full). 2,086 corners were off it; 9 are now, and each of those is a live
 *     expression rather than a literal. Most of the debt turned out to be
 *     `borderRadius: 8` — the right SIZE typed as a number, so the scale was
 *     being followed and never named.
 *
 * SHRINK-ONLY, not zero. Both counts are far above zero today and a guard that
 * demands zero on the first run is a guard somebody deletes. This one fails when
 * a count goes UP, so every pass can only improve — and when a count comes in
 * BELOW its baseline it says so and tells you to lower the baseline, which is
 * what stops the ratchet from silently going slack.
 *
 * §5 E6: "This is the item that makes the rest permanent. It lands with the
 * migration, not after it." Run via `npm run check:design-scale`; wired into
 * `npm test` beside the token guard.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const srcDir = resolve(here, '../src');

/**
 * The high-water marks. LOWER THESE as call sites migrate; never raise them.
 * A number here is a debt, not a budget.
 */
const BASELINE = {
  literalHexFiles: 341,
  offScaleRadii: 9,
};

/**
 * The five documented steps (§2.4), plus 0, the circle/pill values, and
 * `inherit` — which is not a size at all, it is "whatever my parent already
 * chose", and is how a clipped child keeps its parent's corner.
 */
const ALLOWED_RADII = new Set(['0', '6px', '8px', '12px', '16px', '9999px', '50%', '100%', 'inherit']);

/**
 * Files a literal colour is CORRECT in, each with a reason.
 *
 * `globals.css` is where both themes are declared, so every literal in the
 * product ultimately lives there — that is the point of it. The board declares
 * its own palette by convention (§2.6 rule 9), and marketing/brand assets carry
 * fixed brand colours that must not flip with the viewer's theme.
 */
const COLOUR_EXEMPT = [
  /^app\/globals\.css$/,
  /^app\/[^/]*\.css$/,
  /\.test\.(tsx?|css)$/,
  // §2.6 rule 9: "the board declares its own palette." This file is the board's
  // `globals.css` — it declares the whole `--canvas-*` family for BOTH themes
  // (light at the top, dark in the block near the end), for the reason recorded
  // in its own header: derived from the shell's light tokens, the board, its
  // cards and its panels collapsed into one flat sheet. Exempt on the same
  // grounds as `globals.css`: a token has to be declared somewhere, and this is
  // where the canvas's are.
  /^components\/creation-canvas\/CreationCanvas\.module\.css$/,
];

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /^\s*\/\/.*$/gm;

/** A 3-, 4-, 6- or 8-digit hex colour, not part of a longer identifier. */
const LITERAL_HEX = /(?<![\w&])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;

/**
 * `border-radius: X` in CSS and `borderRadius: X` in an inline-style object.
 *
 * Paren-aware: a value may legally contain a comma inside `var(--x, 8px)`, and a
 * naive `[^;,}\n]+` stopped there — reporting the perfectly correct
 * `var(--radius-md, 8px)` as the off-scale value `'var(--radius-md`. A JS object
 * property still ends at the first TOP-LEVEL comma, which is what this keeps.
 */
const RADIUS = /border-?[Rr]adius:\s*((?:var\([^)]*\)|[^;,}\n])+)/g;

/**
 * Files whose radii are not this product's UI, each with a reason.
 *
 * `DevicePreview` draws PHYSICAL devices — a phone's corner is 44px because the
 * phone's corner is 44px, and snapping it to the UI scale would draw the wrong
 * object. The deliverable builders emit standalone documents (a downloadable
 * landing page, a SCORM package) that are opened OUTSIDE this app, where none of
 * these tokens are declared: a `var(--radius-lg)` there resolves to nothing.
 */
const RADIUS_EXEMPT = [
  /^components\/ide\/DevicePreview\.tsx$/,
  /^lib\/creationDeliverables\.ts$/,
  /^lib\/courseLms\.ts$/,
];

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * One declaration can carry several corners: `12px 12px 0 0`. Every part counts.
 *
 * A JS value arrives QUOTED (`borderRadius: '12px 12px 0 0'`), and the quotes are
 * syntax rather than value — reading them as part of the first and last corner
 * turned four on-scale corners into two off-scale ones and reported an on-scale
 * `'50%'` as a defect. Strip them, so the guard measures what was written.
 */
function radiusParts(value) {
  const trimmed = value.trim();
  const quoted = /^(['"])([\s\S]*)\1$/.exec(trimmed);
  return (quoted ? quoted[2] : trimmed)
    .replace(/var\([^)]*\)/g, 'var()')
    .split(/[\s/]+/)
    .filter(Boolean);
}

const files = collect(srcDir);
const hexFiles = [];
const offScale = [];

for (const file of files) {
  const rel = relative(srcDir, file).split('\\').join('/');
  const raw = readFileSync(file, 'utf8');
  const text = raw.replace(BLOCK_COMMENT, '').replace(LINE_COMMENT, '');

  if (!COLOUR_EXEMPT.some((pattern) => pattern.test(rel)) && LITERAL_HEX.test(text)) {
    hexFiles.push(rel);
  }
  LITERAL_HEX.lastIndex = 0;

  if (RADIUS_EXEMPT.some((pattern) => pattern.test(rel))) continue;

  for (const match of text.matchAll(RADIUS)) {
    for (const part of radiusParts(match[1])) {
      // A token IS the scale — only a literal can be off it.
      if (part.startsWith('var(')) continue;
      if (ALLOWED_RADII.has(part)) continue;
      const line = text.slice(0, match.index).split('\n').length;
      offScale.push(`${rel}:${line}  border-radius: ${match[1].trim()}`);
    }
  }
}

const measured = { literalHexFiles: hexFiles.length, offScaleRadii: offScale.length };
const failures = [];
const slack = [];

for (const [key, baseline] of Object.entries(BASELINE)) {
  if (measured[key] > baseline) failures.push({ key, baseline, now: measured[key] });
  else if (measured[key] < baseline) slack.push({ key, baseline, now: measured[key] });
}

if (failures.length > 0) {
  console.error('❌  Design-scale ratchet went the wrong way:\n');
  for (const { key, baseline, now } of failures) {
    console.error(`  - ${key}: ${now} (baseline ${baseline}, +${now - baseline})`);
  }
  if (measured.literalHexFiles > BASELINE.literalHexFiles) {
    console.error('\n  Files carrying a literal hex (sample):');
    for (const f of hexFiles.slice(0, 12)) console.error(`    • ${f}`);
    console.error('    A literal renders the SAME in both themes. Use a token — and if the');
    console.error('    name you want does not exist, declare it in globals.css under BOTH');
    console.error("    :root and html[data-theme='light'].");
  }
  if (measured.offScaleRadii > BASELINE.offScaleRadii) {
    console.error('\n  Off-scale radii (sample):');
    for (const r of offScale.slice(0, 12)) console.error(`    • ${r}`);
    console.error('    The scale is --radius-sm/md/lg/xl/full (6 / 8 / 12 / 16 / pill).');
  }
  console.error('');
  process.exit(1);
}

if (slack.length > 0) {
  console.error('❌  A ratchet is slack — lower its baseline in scripts/check-design-scale.mjs:\n');
  for (const { key, baseline, now } of slack) {
    console.error(`  - ${key}: ${now}, baseline still ${baseline}. Set it to ${now}.`);
  }
  console.error('\n   The point of shrink-only is that the floor follows the work down.\n');
  process.exit(1);
}

console.log(
  `✅  Design-scale ratchets held — ${measured.literalHexFiles} files with a literal hex, `
  + `${measured.offScaleRadii} off-scale radii (both at baseline).`,
);
