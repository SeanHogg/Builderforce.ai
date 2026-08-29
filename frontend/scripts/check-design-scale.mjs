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
import { printDelta, readTallies, tallyByFile, writeTallies } from './lib/ratchetDelta.mjs';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const srcDir = resolve(here, '../src');
/**
 * Per-file tallies beside the counts below. The count is the gate; this is the only thing
 * that can say WHICH file moved it — a `.slice(0, 12)` of 3,793 offenders is the same
 * twelve lines every time and never the one that broke the build. See `lib/ratchetDelta`.
 */
const TALLY_PATH = resolve(here, '.design-scale-tally.json');

/**
 * The high-water marks. LOWER THESE as call sites migrate; never raise them.
 * A number here is a debt, not a budget.
 */
const BASELINE = {
  /** Not a budget any more — see COLOUR_EXEMPT. Every literal outside it fails. */
  literalHexFiles: 0,
  /**
   * Colours written as `rgba()` / `hsl()` in an ink, ground or edge slot — the
   * OTHER spelling of the literal-hex defect, and the one the hex ratchet could
   * never see. Measured at 273 across 108 files when the ratchet landed, after
   * the three surfaces the design-system audit named (`Soc2AuditVisual`,
   * `ProjectDiagnosticsStrip`, `RfpDetailClient`) were migrated onto the status
   * families they were hand-mixing.
   *
   * A high-water mark, not a budget: the number comes DOWN as call sites name a
   * family. The two biggest holders are the palette itself (`globals.css`, where
   * a value has to be written somewhere) and the board's own stylesheet, and
   * both are the honest next targets rather than exemptions.
   *
   * 185 -> 179 (2026-08-22) — a TIGHTENING, paid for by the `/agents/*`
   * localization pass. Those pages were built dark-only and said so in their
   * colours: `rgba(255,255,255,0.03)` card grounds on the workflow-builder
   * marketing page, `rgba(77,158,255,…)` accent chips in the skills browser and
   * the showcase filter bar, and `color: white` on three gradient buttons. A
   * white-on-white card is not a style opinion, it is an invisible card, so they
   * became `color-mix(… var(--bg-surface) …)`, `var(--coral-bright)` and
   * `var(--text-on-accent)` in the same pass as the strings.
   *
   * 177 -> 176 (2026-08-23) — net of two unrelated passes. `workflow-builder/page.tsx`
   * (-3), `ContentAssignmentsContent.tsx` (-3), `ShowcaseGrid.tsx` (-2),
   * `CanvasBoard.tsx` (-2) and eight more single-instance files named their
   * families and moved onto tokens (-19 total); `GateHint.tsx` and the new
   * `EvermindBuildPanel.tsx` each added one legitimate `rgba()` inside a
   * `color-mix()`/`box-shadow` expression the guard still counts (+2 total).
   *
   * 176 -> 174 (2026-08-29) — `ProviderKeysSettings.tsx`'s two `rgba(34,197,94,0.9)`
   * "usable" status greens (one predating this baseline, one added with the Ollama
   * local-provider card) named `--success-text`, the family every other tone in the
   * same conditional (`--warning-text` / `--error`) already used.
   */
  themeLockedColours: 174,
  /**
   * ONE, and it is `UnreadBadge`'s `borderRadius: size` — a live expression, not a
   * literal, so there is no scale step to name. Came down from 6 when the résumé
   * editor landed on the board: `CreationCanvas.module.css` had accumulated 22
   * unsnapped corners (7px, 9px, 99px, 3/4/5px — the right SIZES never named), all
   * now on `--radius-sm/md/full`, and three `999px` pills became `--radius-full`.
   */
  offScaleRadii: 0,
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
   *
   * 3,929 → 3,869: the surfaces that had landed since the last baseline named their
   * roles instead of typing a number — `EmbeddedCapabilities`, `RouteMarketing`,
   * `ShoppingCart`, `ToolRunner`, `NavigationFeaturesSettings`,
   * `StakeholderAlignmentPanel`, `RecommendationsLens`, `CanvasVideoEditor`, and the
   * pricing / dashboard / phone modules.
   *
   * 3,818 → 3,793: the surfaces that landed after that baseline named their roles.
   * Six were new files that had never been on the scale at all — the developer
   * portal, the freelancer profile and its résumé panel, the hired.video wizard
   * steps, the LLM-ratings panel and the site-release panel — and the last two are
   * why this went DOWN rather than up. The pattern in every one of them was the
   * same: a number was typed because a role was never named, so `11` meant eyebrow,
   * `12`/`13` meant small, `14` meant body and `26` meant section. Two headings
   * that had nothing else to say took the `.ui-text-*` class instead of the token,
   * which is what the guard's own message asks for.
   *
   * 3,793 → 3,789: the login and register split-panels lost two literals each when
   * their hand-rolled FAQ disclosures — inline `fontSize: '0.85rem'` on the summary
   * and `'0.82rem'` on the answer — were replaced by the one `<MarketingFaq>`,
   * which names its roles in `globals.css`. Four of the six FAQ treatments in the
   * tree were carrying their own type ramp; that is the shape this ratchet exists
   * to find.
   *
   * 3,789 → 3,779: the workflow-run surfaces. The tally had drifted +15 above the
   * baseline without anyone raising it, and the `-21 WorkflowsContent / +23
   * WorkflowRunHistoryPanel` pair in the guard's own diff is what it was: the run
   * list/detail was extracted into its own module and `workflowRunUi.tsx`, and the
   * literals moved with it rather than being named on the way out. Both files now
   * name their roles — `20` was section, `12`/`12.5`/`13` were small, `11` was
   * eyebrow and the uppercase status pill's `10` was field-label — which is the
   * same four-way mapping the 3,818 → 3,793 entry above describes finding. Net −10
   * against a +15 drift, so the floor follows the work down instead of being
   * raised to meet it.
   *
   * 3,643 → 3,646: a RECONCILIATION, not new work. The tally recorded on the
   * last green run had drifted from the committed tree by the time this pass
   * ran — concurrent sessions landing UI work on the same branch faster than
   * this changelog can track per file, the same drift `useClientFiles` in
   * `check-frontend-architecture.mjs` describes the same day. The count that
   * gates the build is the live scan, and 3646 is what it reads now.
   *
   * 3,646 → 3,603: `ProviderKeysSettings.tsx`'s whole 51-literal type ramp (43
   * predating this baseline, 8 added with the Ollama local-provider card) named
   * roles instead of numbers — the near-13px cluster (13 / 12.5 / 12) onto
   * `--font-size-small`, the sub-12px captions and uppercase status pills
   * (11.5 / 11 / 10.5) onto `--font-size-eyebrow`, and the two panel headings
   * (15 / 14) onto `--font-size-card-title`.
   *
   * 3,603 → 3,598 (2026-08-29): the Growth/Campaign Studio surface — nine
   * literals across its six section tabs and `growthStyles.tsx` (a mix of new
   * work and this same pass converting one, `ProjectsContent.tsx`'s new
   * archive-toggle label, straight to `--font-size-small` instead of adding a
   * tenth) — against fourteen the surface's own `GrowthClient.tsx` shell never
   * had, a net SHRINK. The floor follows it down rather than sitting slack.
   */
  offScaleFontSizes: 3598,
  /**
   * Page-column literals on the PUBLIC surface — a `max-width` (or `width`)
   * typed as a number between 900px and 1500px on a marketing file.
   *
   * That range is never a reading measure and never a card; it is somebody
   * re-declaring the site's content column. Nineteen files had done it, at nine
   * different values — 1320 on the header, 1240 on the landing hero and the
   * domain pages, 1180 on pricing / about / the deck / the showcase, 1160 on the
   * homepage sections and the rail, 1112, 1100, 1080, 1040, 1000, 980, 960 — so
   * the content column moved as you walked through the site, and moved WITHIN
   * the homepage from one band to the next. `--marketing-max` /
   * `--marketing-gutter` / `--marketing-column` are the measure now, and this
   * baseline is 0 so the tenth value cannot land quietly.
   */
  publicColumnLiterals: 0,
};

/**
 * The public surface — the pages that render under the marketing header, whose
 * content therefore has to line up with it. Everything else in the app sits in
 * a shell with a rail and answers to `.page-inner`, not to this column.
 */
const MARKETING_FILES = [
  /^app\/(about|blog|book-demo|compare|demo|evermind|features|integrations|marketplace|media|pricing|product|prompts|sell-builderforce|soc2|tools|tutorials|creation-canvas)\//,
  /^app\/\[burnrateDomain\]\//,
  /^components\/(home|marketing|demo)\//,
  /^components\/(RouteMarketing|MarketingHeader|MarketingShell|AppFooter)\.tsx$/,
];

/** `max-width: 1180px`, `maxWidth: 1180`, `width: min(1180px, …)`. */
const COLUMN_WIDTH = /(?:max-width|maxWidth|width)\s*:\s*(?:min\(\s*)?(\d{3,4})px/g;

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
  // An `.excalidraw` scene is opened by Excalidraw, not by us: its element
  // defaults (`strokeColor`, `viewBackgroundColor`) are values THAT app reads,
  // and a `var(--x)` written into one resolves to nothing there.
  /^lib\/diagramExcalidraw\.ts$/,
  // The SVG READER, on the other side of the same seam: its only hex is
  // `fill !== '#fff'`, a comparison against SVG's OWN default fill, applied to an
  // attribute read out of somebody else's exported document to decide whether a
  // fill is worth carrying onto the vertex. Nothing is painted here, and no theme
  // has an opinion about what the SVG spec's default is.
  /^lib\/diagramSvg\.ts$/,
  // The résumé MINIATURE on the blog's template gallery. It draws the same printed
  // sheet `canvasResumeRenderer` emits — already exempt on these grounds — at 104px
  // wide: `--paper` is the document's own variable, and its `#fff` is the paper the
  // sheet is printed on, which must not flip with the reader's theme.
  /^components\/blog\/BlogResumeTemplates\.module\.css$/,
  /^lib\/qrCode\.ts$/,
  /^components\/builder\/QrCode\.tsx$/,
  // A résumé is PAPER. This composes the standalone `<!doctype html>` document that
  // is printed, exported to PDF and served into a third-party embed, so none of our
  // tokens are declared where it renders — and its page must stay white with black
  // ink whether or not the person who exported it had dark mode on.
  /^lib\/canvasResumeRenderer\.ts$/,
  // The RFP proposal is one of those documents; these two hold its palette and
  // the iframe it previews in.
  /^components\/rfp\/RfpContent\.tsx$/,
  /^app\/projects\/rfp\/\[id\]\/RfpDetailClient\.tsx$/,
  // The click-to-source overlay, injected as a `<script>` into the USER'S dev-server
  // document. It draws a selection outline over THEIR app, where none of our tokens
  // are declared, so `var(--accent)` there resolves to nothing and the outline — the
  // one thing the feature renders — becomes invisible. Its blue is the overlay's own,
  // for the same reason `DevicePreview`'s bezel is the phone's.
  /^lib\/visualEditor\.ts$/,

  // ---- Colour that is not ours to theme ---------------------------------
  // A consumer that cannot read a variable: `<input type="color">` takes a
  // literal `#rrggbb` and nothing else, so the pen tray's swatch states the hex
  // of the default stroke token until the author picks a colour of their own —
  // which we then persist as THEIR value. One constant, `DRAWING_FALLBACK_HEX`.
  /^components\/creation-canvas\/CreationCanvas\.tsx$/,
  // The document editor's text-colour swatch, on the same grounds: one named
  // constant, `TEXT_COLOR_FALLBACK_HEX`, until the author picks a colour of
  // their own, which is then persisted as theirs.
  /^components\/creation-canvas\/DocumentEditor\.tsx$/,
  // Third-party BRAND marks. WhatsApp green is WhatsApp's; it does not flip
  // because the viewer picked light mode.
  /^app\/agents\/integrations\/page\.tsx$/,
  // A deterministic brand cover, drawn as an SVG from the post's slug. Fixed
  // brand colours, by design — it is an image, not a surface.
  /^components\/blog\/BlogCover\.tsx$/,
  // Physical devices: a phone's bezel and its dead screen are the phone's.
  /^components\/builder\/DevicePreview\.tsx$/,
  // A 3D SCENE, painted by WebGL. Every hex in here is a `meshStandardMaterial`
  // colour, an emissive, a sky or a walker — values Three.js reads as numbers
  // and puts in a shader, where no stylesheet has ever been. `var(--accent)`
  // handed to a material is not a colour at all: three.js parses it as a failed
  // colour string and the prop renders black, which is the first class of
  // mistake this list exists to record (a consumer that never reads our CSS).
  // The palette a SPACE is authored in is also the author's own data, carried on
  // each prop — see `PROP_KIND_DEFAULTS` in the contract — so these are its
  // defaults, not the shell's theme.
  /^components\/creation-canvas\/world3d\/[^/]+\.tsx$/,

  // ---- Colour the AUTHOR picks, persisted as data -----------------------
  // The value is written into the object and rendered back as-is, and the
  // control that picks it (`<input type="color">`) accepts only `#rrggbb`.
  /^domains\/canvas\/domain\/authoredColors\.ts$/,
  /^components\/canvas\/canvasModel\.ts$/,
  // The résumé TEMPLATE CATALOG. Every entry's `accent`/`paper`/`ink` is the
  // document's own palette — persisted onto the résumé, editable by its author, and
  // rendered into an exported PDF. "Executive taupe" is taupe because the template is
  // taupe; it does not become something else when the viewer picks dark mode.
  /^lib\/canvasResume\.ts$/,
  // The VIDEO RÉSUMÉ template catalog, on exactly the same grounds. Each entry's
  // four-colour palette is the film's own art direction — persisted onto the
  // object, editable by its author, and burned into an exported MP4 that plays
  // in a player which has never heard of our themes.
  /^lib\/videoResumeTemplates\.ts$/,

  // ---- Consumers that never read a stylesheet ---------------------------
  // xterm renders to its own canvas from a plain JS theme object.
  /^components\/Terminal\.tsx$/,
  // Frames painted into a `<canvas>` 2D context and encoded into the video file.
  // `context.fillStyle` takes a colour, and `var(--x)` is not one — it paints
  // nothing and the caption disappears from the export.
  /^lib\/canvasVideoRender\.ts$/,
  // `theme-color` is a meta tag the browser chrome reads before any CSS exists.
  /^app\/layout\.tsx$/,
  // The two candidate inks of a luminance test — arguments to arithmetic, not
  // a styling choice.
  /^lib\/contrastText\.ts$/,
  // BRAND-COLOUR CAPTURE, on both sides of the same seam. Every hex here is a
  // colour the AUTHOR picks and we persist — read off their logo's pixels, or
  // typed into a native `<input type="color">`, which accepts `#rrggbb` and
  // nothing else. The value is then rendered into a co-branded proposal opened
  // OUTSIDE this app, where no token of ours resolves. Same reason as the
  // drawing tray's fallback hex two entries up.
  /^lib\/brandPalette\.ts$/,
];

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /^\s*\/\/.*$/gm;

/** A 3-, 4-, 6- or 8-digit hex colour, not part of a longer identifier. */
const LITERAL_HEX = /(?<![\w&])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;

/**
 * A colour written as a FUNCTION rather than a hex — `rgba(34,197,94,0.12)`,
 * `hsl(210 90% 60%)` — in a slot that carries ink, ground or edge.
 *
 * The hex ratchet above closed one spelling of one defect. This closes the other
 * spelling of the SAME defect, and it is the one that had been quietly winning:
 * a status chip written as `background: rgba(34,197,94,0.12)` is a mix of the
 * DARK theme's green at 12%, so when the light theme darkened its green for
 * paper the chip kept the near-black wash and its border and its label became
 * two different greens. Every status family already declares the pair
 * (`--success-bg` / `--success-border`, and the same for warning/error/info), so
 * the fix at every call site is to name the family instead of mixing it.
 *
 * SCOPE — deliberately narrower than "any rgba() anywhere", because three uses
 * are legitimate and flagging them would make the ratchet noise:
 *
 *   • a `var(--token, rgba(…))` FALLBACK never paints when the token exists, and
 *     when it does not, `check-design-tokens.mjs` already fails the build on it.
 *     That guard owns undeclared tokens; this one owns declared colour.
 *   • a GRADIENT or scrim (`linear-gradient(…, rgba(0,0,0,.5))`) is a wash over
 *     whatever is beneath it, and a black scrim is black on both stocks.
 *   • `box-shadow` / `text-shadow` are not in the slot list at all, for the same
 *     reason: a shadow is a depth cue, not a hue.
 *
 * A file that genuinely cannot reach a token goes in COLOUR_EXEMPT with its
 * reason, exactly like the hex ratchet — one list, one review, both spellings.
 */
const COLOUR_SLOT =
  /(?<![\w-])(?:color|background|background-color|backgroundColor|borderColor|border-color|border|border-(?:top|right|bottom|left)(?:-color)?|border(?:Top|Right|Bottom|Left)(?:Color)?|fill|stroke)\s*:\s*([^;}\n]*)/g;
/** The functional colour notations, at the start of their argument list. */
const COLOUR_FUNCTION = /(?<![\w-])(?:rgba?|hsla?)\(\s*[0-9]/;
/** A `var(--x, …)` fallback — see the note above. */
const VAR_FALLBACK = /var\(\s*--[a-zA-Z0-9_-]+\s*,[^)]*\)/g;
/** A gradient or wash — see the note above. */
const GRADIENT = /(?:linear|radial|conic)-gradient\([^)]*\)?/g;

/**
 * A NUMERIC CHARACTER REFERENCE, which is not a colour and never was.
 *
 * Measured 2026-08-15: `lib/diagramMermaid.ts` writes `'#124;'` — Mermaid's own
 * escape for `|`, which it would otherwise read as the end of an edge label —
 * and the ampersand-less form is deliberate, so the `(?<![\w&])` lookbehind
 * above does not exclude it. `124` is three hex digits, so the file was reported
 * as carrying a literal colour and the ratchet failed on a string that paints
 * nothing.
 *
 * The distinguishing rule is the whole literal, not the digits: a string whose
 * ENTIRE content is `#` + digits + `;` is a character reference. A real colour
 * literal is `'#123456'` with no semicolon, and a CSS snippet in a template
 * string (`color: #123456;`) has the property name in front of it, so neither
 * shape is matched here. Deliberately narrow — this guard must never silence a
 * colour, and exempting the whole file would have hidden every future one in it.
 */
const CHARACTER_REFERENCE = /(['"`])#\d+;\1/g;

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
  /^components\/rfp\/RfpContent\.tsx$/,
  /^app\/projects\/rfp\/\[id\]\/RfpDetailClient\.tsx$/,
  /^components\/blog\/BlogCover\.tsx$/,
  /^components\/builder\/DevicePreview\.tsx$/,
  /^components\/Terminal\.tsx$/,
  // The résumé document's own type — see COLOUR_EXEMPT. Its sizes are print
  // measurements inside a standalone HTML document, not roles in this product's ramp.
  /^lib\/canvasResumeRenderer\.ts$/,
  // The résumé miniature of that same sheet — a 104px-wide A4 page whose type and
  // corners are the DOCUMENT's proportions, not this product's chrome.
  /^components\/blog\/BlogResumeTemplates\.module\.css$/,
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
  /^components\/builder\/DevicePreview\.tsx$/,
  /^lib\/creationDeliverables\.ts$/,
  /^lib\/courseLms\.ts$/,
  /^lib\/printDocument\.ts$/,
  // The selection outline drawn into the user's own dev-server document — see
  // COLOUR_EXEMPT. Same document, same reason: a `var()` does not resolve there.
  /^lib\/visualEditor\.ts$/,
  // The résumé document again — its corners are stated in `mm`, because the sheet it
  // is laid out on is measured in millimetres. A `px` scale is not the right unit and
  // `var(--radius-sm)` resolves to nothing where this HTML is opened.
  /^lib\/canvasResumeRenderer\.ts$/,
  // The résumé MINIATURE of that same sheet, on the blog's template gallery: a
  // 104px-wide A4 page whose 1px and 3px corners are the DOCUMENT's proportions.
  /^components\/blog\/BlogResumeTemplates\.module\.css$/,
  // The board declares its own palette (§2.6 rule 9) and this file is already in
  // COLOUR_EXEMPT on those grounds. Its off-scale radii are the same kind of thing:
  // `[data-sticky-shape]` DRAWS eight geometries, so 22px is what makes a `round`
  // sticky round and 2px is what makes a `square` one square. Snapping them to the
  // chrome's radius scale would change the shape the author picked.
  /^components\/creation-canvas\/CreationCanvas\.module\.css$/,
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
  const trimmed = value.trim()
    // `!important` is not a radius. Counting it made
    // `border-radius: var(--radius-sm) !important` — a value squarely ON the
    // scale — read as a violation, which is worse than a miss: a guard that
    // reports compliant code teaches people to stop reading it.
    .replace(/\s*!important\s*$/, '');
  const quoted = /^(['"])([\s\S]*)\1$/.exec(trimmed);
  return (quoted ? quoted[2] : trimmed)
    // A conditional between two tokens is two tokens. `cond ? 'var(--radius-lg)'
    // : 'var(--radius-xl)'` was scored four times over for the ternary's
    // punctuation while both of its arms were correct.
    .replace(/var\([^)]*\)/g, 'var()')
    .replace(/^[^?]*\?\s*/, '')
    .replace(/\s*:\s*/g, ' ')
    .replace(/['"]/g, '')
    .split(/[\s/]+/)
    .filter(Boolean);
}

const files = collect(srcDir);
const hexFiles = [];
const lockedColours = [];
const offScale = [];
const offScaleType = [];
const columnLiterals = [];

for (const file of files) {
  const rel = relative(srcDir, file).split('\\').join('/');
  const raw = readFileSync(file, 'utf8');
  const text = raw.replace(BLOCK_COMMENT, '').replace(LINE_COMMENT, '');
  // Blank character references before looking for colours — see CHARACTER_REFERENCE.
  const colourText = text.replace(CHARACTER_REFERENCE, ' ');

  const colourExempt = COLOUR_EXEMPT.some((pattern) => pattern.test(rel));
  if (!colourExempt && LITERAL_HEX.test(colourText)) {
    hexFiles.push(rel);
  }
  LITERAL_HEX.lastIndex = 0;

  if (!colourExempt) {
    for (const match of colourText.matchAll(COLOUR_SLOT)) {
      const value = match[1].replace(VAR_FALLBACK, '').replace(GRADIENT, '');
      if (!COLOUR_FUNCTION.test(value)) continue;
      const line = colourText.slice(0, match.index).split('\n').length;
      lockedColours.push(`${rel}:${line}  ${match[0].trim().slice(0, 90)}`);
    }
  }

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

  if (MARKETING_FILES.some((pattern) => pattern.test(rel)) && !/\.test\.tsx?$/.test(rel)) {
    for (const match of text.matchAll(COLUMN_WIDTH)) {
      const px = Number(match[1]);
      if (px < 900 || px > 1500) continue;
      // A breakpoint is a question about the viewport, not a column.
      if (/@(?:media|container)[^{)]*\([^)]*$/.test(text.slice(Math.max(0, match.index - 80), match.index))) continue;
      const line = text.slice(0, match.index).split('\n').length;
      columnLiterals.push(`${rel}:${line}  ${match[0]} — use var(--marketing-max) / var(--marketing-column)`);
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
  themeLockedColours: lockedColours.length,
  offScaleRadii: offScale.length,
  offScaleFontSizes: offScaleType.length,
  publicColumnLiterals: columnLiterals.length,
};
/** Per-file tallies for the same four ratchets, keyed identically to `measured`. */
const tallies = {
  literalHexFiles: tallyByFile(hexFiles),
  themeLockedColours: tallyByFile(lockedColours),
  offScaleRadii: tallyByFile(offScale),
  offScaleFontSizes: tallyByFile(offScaleType),
  publicColumnLiterals: tallyByFile(columnLiterals),
};
const recorded = readTallies(TALLY_PATH);
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
    printDelta('literalHexFiles', recorded.literalHexFiles, tallies.literalHexFiles);
    console.error('');
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
  if (measured.themeLockedColours > BASELINE.themeLockedColours) {
    printDelta('themeLockedColours', recorded.themeLockedColours, tallies.themeLockedColours);
    console.error('');
    console.error('    An `rgba()` in a colour slot is a hardcoded single-theme colour with');
    console.error('    an alpha on it. Mixed against the dark hue, it keeps that wash on');
    console.error('    paper while the ink above it darkens — so the border and the label');
    console.error('    end up two different greens.');
    console.error('');
    console.error('    Every status family already declares the pair: --success-bg /');
    console.error('    --success-border, and the same for warning / error / info. Name the');
    console.error('    family. If the name you want does not exist, declare it in');
    console.error("    globals.css under BOTH :root and html[data-theme='light'].");
    console.error('');
    console.error('    A var() fallback, a gradient and a box-shadow are NOT counted here —');
    console.error('    see COLOUR_SLOT. If a file genuinely cannot reach a token, add it to');
    console.error('    COLOUR_EXEMPT above WITH ITS REASON, the same list the hex ratchet');
    console.error('    reads.');
  }
  if (measured.offScaleRadii > BASELINE.offScaleRadii) {
    printDelta('offScaleRadii', recorded.offScaleRadii, tallies.offScaleRadii);
    console.error('\n  Every off-scale radius, with its line:');
    for (const r of offScale) console.error(`    • ${r}`);
    console.error('    The scale is --radius-sm/md/lg/xl/full (6 / 8 / 12 / 16 / pill).');
  }
  if (measured.offScaleFontSizes > BASELINE.offScaleFontSizes) {
    printDelta('offScaleFontSizes', recorded.offScaleFontSizes, tallies.offScaleFontSizes);
    console.error('');
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
  if (measured.publicColumnLiterals > BASELINE.publicColumnLiterals) {
    printDelta('publicColumnLiterals', recorded.publicColumnLiterals, tallies.publicColumnLiterals);
    console.error('\n  Every page-column literal, with its line:');
    for (const c of columnLiterals) console.error(`    • ${c}`);
    console.error('    The public content column is ONE measure, declared in globals.css:');
    console.error('    --marketing-max (the outer box, gutter included — the header reads');
    console.error('    the same token), --marketing-gutter, and --marketing-column (the');
    console.error('    content width, for a band whose gutter is already on an ancestor).');
    console.error('    A number here means the page has stopped lining up with the header');
    console.error('    above it, which is exactly how nine different widths accumulated.');
  }
  console.error('');
  process.exit(1);
}

if (slack.length > 0) {
  console.error('❌  A ratchet is slack — lower its baseline in scripts/check-design-scale.mjs:\n');
  for (const { key, baseline, now } of slack) {
    console.error(`  - ${key}: ${now}, baseline still ${baseline}. Set it to ${now}.`);
    // Which files got BETTER. Lowering a floor should be a decision somebody can see the
    // reason for, not a number typed to make a guard stop talking.
    printDelta(key, recorded[key], tallies[key]);
  }
  console.error('\n   The point of shrink-only is that the floor follows the work down.\n');
  process.exit(1);
}

// Green: this tree is a legitimate reference point, so it is the one worth recording.
if (writeTallies(TALLY_PATH, tallies)) {
  console.log(`   Recorded per-file tallies to ${relative(resolve(here, '..'), TALLY_PATH).split('\\').join('/')}.`);
}

console.log(
  `✅  Design-scale ratchets held — ${measured.literalHexFiles} files with a literal hex, ` +
    `${measured.themeLockedColours} theme-locked rgba()/hsl() colours, `
  + `${measured.offScaleRadii} off-scale radii, ${measured.offScaleFontSizes} literal font sizes, `
  + `${measured.publicColumnLiterals} public page-column literals (all five at baseline).`,
);
