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
 *     wrong in the other. 315 files carried one when this landed.
 *   - **An off-scale radius.** §2.4 documents five values (6 / 8 / 12 / 16 /
 *     full). 26 CSS modules carried 20+ distinct ones, which is what makes a
 *     product look assembled rather than designed.
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
  literalHexFiles: 405,
  offScaleRadii: 2087,
};

/** The five documented steps (§2.4), plus 0 and the pill value. */
const ALLOWED_RADII = new Set(['0', '6px', '8px', '12px', '16px', '9999px', '50%', '100%']);

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
];

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /^\s*\/\/.*$/gm;

/** A 3-, 4-, 6- or 8-digit hex colour, not part of a longer identifier. */
const LITERAL_HEX = /(?<![\w&])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;

/** `border-radius: X` in CSS and `borderRadius: X` in an inline-style object. */
const RADIUS = /border-?[Rr]adius:\s*([^;,}\n]+)/g;

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** One declaration can carry several corners: `12px 12px 0 0`. Every part counts. */
function radiusParts(value) {
  return value
    .trim()
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
