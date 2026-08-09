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
 *     wrong in the other. 403 files carried one when this landed, then 341.
 *     **It is zero now**, and the count is no longer the mechanism: every file
 *     that still contains a hex is in `COLOUR_EXEMPT` below with a written
 *     reason, and anything else fails. A NUMBER lets 341 sit there looking like
 *     progress; a LIST forces the next person to say out loud why their literal
 *     is one of the handful of cases where a token genuinely cannot reach.
 *   - **An off-scale radius.** §2.4 documents five values (6 / 8 / 12 / 16 /
 *     full). 2,086 corners were off it; 9 are now, and each of those is a live
 *     expression rather than a literal. Most of the debt turned out to be
 *     `borderRadius: 8` — the right SIZE typed as a number, so the scale was
 *     being followed and never named.
 *
 * The radius ratchet stays SHRINK-ONLY: it fails when the count goes UP, and
 * also when it comes in BELOW its baseline without the baseline following — which
 * is what stops a ratchet from quietly going slack.
 *
 * §5 E6: "This is the item that makes the rest permanent. It lands with the
 * migration, not after it." Run via `npm run check:design-scale`; wired into
 * `npm test` beside the token guard.
 *
 * ## What the sweep taught, and what this guard now catches because of it
 *
 * Replacing a literal with a token is not always right, and four ways of getting
 * it wrong were found IN THE TREE, each shipped by an earlier pass of this same
 * migration. They are why `COLOUR_EXEMPT` is a list of reasons rather than a
 * list of paths:
 *
 *   1. A consumer that never reads our CSS. `xterm` paints its own canvas from a
 *      JS theme object; the cursor had been set to `var(--text-on-accent)` and
 *      simply vanished. Same class: `<meta name="theme-color">`, read by the
 *      browser chrome before a stylesheet exists.
 *   2. A document opened somewhere else. A print sheet, a downloadable landing
 *      page, a generated React Native scaffold — `borderRadius:
 *      'var(--radius-xl)'` is not even a number to React Native.
 *   3. A control whose VALUE must be a colour. `<input type="color">` accepts
 *      `#rrggbb` and nothing else; given a `var()` it silently shows black and
 *      writes black the moment it is touched.
 *   4. A cycle. `--text-primary: var(--text-primary)` inside a scope that means
 *      to OVERRIDE it is invalid at computed-value time, and takes the token away
 *      from every descendant.
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
  /** Not a budget any more — see COLOUR_EXEMPT. Every literal outside it fails. */
  literalHexFiles: 0,
  offScaleRadii: 9,
  /**
   * Literal font sizes, i.e. a size typed as a number instead of named as a
   * role. This is the third ratchet and it exists because §2.3 spent this
   * PRD's whole life as a table with nothing behind it: there was no
   * `--font-size-*` token and only one of eight roles had a class, so there was
   * nothing to import and every author typed a number. The public surface alone
   * carried 89 distinct values over 1,185 uses, against a radius scale — five
   * values, tokens, and the ratchet above — sitting at nine.
   *
   * Baselined AFTER the public-surface migration (1,494 → 457 on the marketing
   * tree, of which 378 are the board's own stylesheet). The rest of the app is
   * the sweep this number now drives, exactly as 2,087 → 9 drove the radii.
   */
  offScaleFontSizes: 3937,
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
  // ---- Where the tokens themselves are declared -------------------------
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
  // The landing hero is a LIT SCENE in both themes, so it overrides the shell's
  // ink inside itself. Same grounds as the board: a scope that declares its own
  // palette has to state values, and an override written as `var()` of the thing
  // it overrides is a cycle that strips the token from every descendant.
  /^components\/home\/LandingCanvasHero\.module\.css$/,

  // ---- Documents opened OUTSIDE this app --------------------------------
  // Nothing here is rendered by our stylesheet, so `var(--x)` resolves to
  // nothing: a print sheet composed in an isolated iframe, a downloadable
  // landing page or SCORM package, a data-URL poster, a QR the scanner reads.
  /^lib\/printDocument\.ts$/,
  /^lib\/creationDeliverables\.ts$/,
  /^lib\/courseLms\.ts$/,
  /^lib\/renderedSvg\.ts$/,
  /^lib\/gamePoster\.ts$/,
  /^lib\/creativeGeometry\.ts$/,
  /^lib\/qrCode\.ts$/,
  /^components\/ide\/QrCode\.tsx$/,
  // The RFP proposal is one of those documents; these two hold its palette and
  // the iframe it previews in.
  /^components\/rfp\/RfpContent\.tsx$/,
  /^app\/projects\/rfp\/\[id\]\/RfpDetailClient\.tsx$/,
  // Generated PROJECT source — the user's own app files, not our UI. React
  // Native takes a number for `borderRadius`; a `var()` is not one.
  /^lib\/vanillaDefaults\.ts$/,

  // ---- Colour that is not ours to theme ---------------------------------
  // Third-party BRAND marks. WhatsApp green is WhatsApp's; it does not flip
  // because the viewer picked light mode.
  /^app\/agents\/integrations\/page\.tsx$/,
  // A deterministic brand cover, drawn as an SVG from the post's slug. Fixed
  // brand colours, by design — it is an image, not a surface.
  /^components\/blog\/BlogCover\.tsx$/,
  // Physical devices: a phone's bezel and its dead screen are the phone's.
  /^components\/ide\/DevicePreview\.tsx$/,

  // ---- Colour the AUTHOR picks, persisted as data -----------------------
  // The value is written into the object and rendered back as-is, and the
  // control that picks it (`<input type="color">`) accepts only `#rrggbb`.
  /^components\/creation-canvas\/authoredColors\.ts$/,
  /^components\/canvas\/canvasModel\.ts$/,

  // ---- Consumers that never read a stylesheet ---------------------------
  // xterm renders to its own canvas from a plain JS theme object.
  /^components\/Terminal\.tsx$/,
  // `theme-color` is a meta tag the browser chrome reads before any CSS exists.
  /^app\/layout\.tsx$/,
  // The two candidate inks of a luminance test — arguments to arithmetic, not
  // a styling choice.
  /^lib\/contrastText\.ts$/,
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
 * `font-size: X` in CSS and `fontSize: X` in a style object.
 *
 * The nine roles (§2.3 plus Lede) are `--font-size-*` tokens, so a `var()` is
 * on the scale by construction and only a literal can be off it. `inherit` is
 * not a size — it is "whatever my parent already chose" — and is how a nested
 * element keeps its role rather than re-picking one.
 */
const FONT_SIZE = /font-?[Ss]ize:\s*((?:var\([^)]*\)|clamp\([^)]*\)|[^;,}\n])+)/g;
const FONT_SIZE_KEYWORDS = new Set(['inherit', 'unset', 'initial', 'revert', 'smaller', 'larger', '0']);

/**
 * Files whose font sizes are not this product's UI, each with a reason.
 *
 * The board declares its own scale for the same reason §2.6 rule 9 lets it
 * declare its own palette: a canvas object's label is drawn at a zoom-dependent
 * size in an art surface, not set in the shell's type ramp. The rest are the
 * documents opened OUTSIDE this app and the consumers that never read our CSS —
 * the same list, and the same reasons, as COLOUR_EXEMPT above.
 */
const FONT_SIZE_EXEMPT = [
  /^app\/globals\.css$/,
  /\.test\.(tsx?|css)$/,
  /^components\/creation-canvas\/CreationCanvas\.module\.css$/,
  /^lib\/printDocument\.ts$/,
  /^lib\/creationDeliverables\.ts$/,
  /^lib\/courseLms\.ts$/,
  /^lib\/renderedSvg\.ts$/,
  /^lib\/gamePoster\.ts$/,
  /^lib\/creativeGeometry\.ts$/,
  /^lib\/vanillaDefaults\.ts$/,
  /^components\/rfp\/RfpContent\.tsx$/,
  /^app\/projects\/rfp\/\[id\]\/RfpDetailClient\.tsx$/,
  /^components\/blog\/BlogCover\.tsx$/,
  /^components\/ide\/DevicePreview\.tsx$/,
  /^components\/Terminal\.tsx$/,
];

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
  // Generated PROJECT source. The mobile scaffold is React Native, where
  // `borderRadius` is a NUMBER — `'var(--radius-xl)'` is not a value RN can use,
  // and leaving it there had broken the scaffold's card and button corners.
  /^lib\/vanillaDefaults\.ts$/,
  /^lib\/printDocument\.ts$/,
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
const offScaleType = [];

for (const file of files) {
  const rel = relative(srcDir, file).split('\\').join('/');
  const raw = readFileSync(file, 'utf8');
  const text = raw.replace(BLOCK_COMMENT, '').replace(LINE_COMMENT, '');

  if (!COLOUR_EXEMPT.some((pattern) => pattern.test(rel)) && LITERAL_HEX.test(text)) {
    hexFiles.push(rel);
  }
  LITERAL_HEX.lastIndex = 0;

  if (!FONT_SIZE_EXEMPT.some((pattern) => pattern.test(rel))) {
    for (const match of text.matchAll(FONT_SIZE)) {
      const value = match[1].trim().replace(/^['"`]|['"`]$/g, '');
      // A token IS the scale; a keyword is not a size at all.
      if (value.startsWith('var(') || FONT_SIZE_KEYWORDS.has(value)) continue;
      // A template hole or a bound expression is resolved at runtime; the guard
      // cannot judge it and must not claim to.
      if (value.includes('${') || /^[A-Za-z_$]/.test(value)) continue;
      const line = text.slice(0, match.index).split('\n').length;
      offScaleType.push(`${rel}:${line}  font-size: ${value}`);
    }
  }

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

const measured = {
  literalHexFiles: hexFiles.length,
  offScaleRadii: offScale.length,
  offScaleFontSizes: offScaleType.length,
};
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
    console.error('');
    console.error('    If a token genuinely cannot reach — the value is read by something');
    console.error('    that never sees our CSS (an xterm canvas, a <meta>), it is written');
    console.error('    into a document opened elsewhere, it is a vendor brand mark, or it');
    console.error('    is a colour the AUTHOR picks and we persist — add the file to');
    console.error('    COLOUR_EXEMPT above WITH ITS REASON. The list is the review.');
  }
  if (measured.offScaleRadii > BASELINE.offScaleRadii) {
    console.error('\n  Off-scale radii (sample):');
    for (const r of offScale.slice(0, 12)) console.error(`    • ${r}`);
    console.error('    The scale is --radius-sm/md/lg/xl/full (6 / 8 / 12 / 16 / pill).');
  }
  if (measured.offScaleFontSizes > BASELINE.offScaleFontSizes) {
    console.error('\n  Literal font sizes (sample):');
    for (const f of offScaleType.slice(0, 12)) console.error(`    • ${f}`);
    console.error('    Name the ROLE, do not type the size. The nine roles are');
    console.error('    --font-size-hero / page-title / section / lede / card-title /');
    console.error('    body / small / eyebrow / field-label, and each has a matching');
    console.error('    .ui-text-* class carrying its weight, tracking and line height.');
    console.error('    Prefer the class: a role is all four, and picking only the size');
    console.error('    is how one "page title" became three different ones.');
    console.error('');
    console.error('    If the size is genuinely not this product\'s UI — the board\'s own');
    console.error('    art surface, a document opened outside this app, a consumer that');
    console.error('    never reads our CSS — add the file to FONT_SIZE_EXEMPT above WITH');
    console.error('    ITS REASON. The list is the review.');
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
  + `${measured.offScaleRadii} off-scale radii, ${measured.offScaleFontSizes} literal font sizes `
  + `(all three at baseline).`,
);
