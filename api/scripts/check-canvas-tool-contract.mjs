/**
 * check-canvas-tool-contract — the canvas may not advertise a tool nobody classified.
 *
 * ── THE DEFECT THIS EXISTS TO STOP ───────────────────────────────────────────────
 * Two packages decide what an anonymous Creation Canvas turn can do. The BROWSER
 * (`frontend/src/components/creation-canvas/CreationCanvas.tsx`) decides what to
 * advertise to the model; this API (`src/application/guest/guestCanvasTools.ts`)
 * decides what to accept. They must describe the same vocabulary, and the gap between
 * them is SILENT in the worst possible way: the model plans around a tool it was told
 * exists, the gateway deletes it before dispatch, and the model — having nothing to
 * call — returns prose. Nothing errors, and the run is indistinguishable from one that
 * simply chose not to act.
 *
 * Measured on the public landing canvas, 2026-08-12 (ui 2026.7.210 / api 2026.7.235):
 * 24 canvas tools advertised, 12 reaching the model, ZERO tool calls across three
 * turns, every turn answering "I couldn't prepare any canvas changes from that
 * request." Five of the twelve removed tools were guest-SAFE and merely missing from
 * the allowlist — including `canvas_read_object`, which the canvas system prompt names
 * and instructs the model to call.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────
 * 1. Every `canvas_*` tool the canvas declares must appear EXACTLY ONCE in
 *    `packages/creation-canvas-contract/src/canvasTools.ts`, in the guest-safe, the
 *    guest-gated, or the account-required set — and the contract may not name a tool
 *    the canvas does not declare. Adding a canvas tool is therefore a two-line change,
 *    and forgetting the second line fails the build instead of the product.
 * 2. A tool DESCRIPTION travels in the tool list, so a guest-advertised tool may only
 *    name other guest-advertised tools. `canvas_add_object`'s description said "For an
 *    actual image, NEVER use this tool; use canvas_add_image" while `canvas_add_image`
 *    was account-required and therefore absent from every guest board — the model was
 *    being redirected to a tool it had not been given. It duly improvised: two refused
 *    drawing calls and "I cannot generate images" to a user who had asked for a picture
 *    (measured 2026-08-12, ui 2026.7.213). This is the `canvas_*` half of the same
 *    contract `check-prompt-tool-names.mjs` enforces for `builtin_*` names.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * Anchored at this module rather than at `process.cwd()` — the same reason
 * `check-prompt-tool-names.mjs` is: a guard whose inputs are found only when it is
 * launched from `api/` is a guard the next runner disarms by accident.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Every source file that DECLARES canvas actions.
 *
 * The canvas component held all of them until the build vocabulary was added;
 * that component is ~9 700 lines with a single ~3 700-line action `useMemo`, so
 * new tool families land as their own modules and are spread into the array.
 * The guard follows the declarations rather than the file, because the rule it
 * enforces is about the advertised VOCABULARY, not about where it is typed. A
 * new family adds one line here.
 */
const CANVAS_FILES = [
  path.resolve(repoRoot, 'frontend', 'src', 'components', 'creation-canvas', 'CreationCanvas.tsx'),
  path.resolve(repoRoot, 'frontend', 'src', 'lib', 'canvasBuildTools.ts'),
  path.resolve(repoRoot, 'frontend', 'src', 'lib', 'canvasFounderOpsTools.ts'),
  path.resolve(repoRoot, 'frontend', 'src', 'lib', 'canvasEquityTools.ts'),
  // These three were declaring canvas tools that this guard never saw, which is the
  // instruction above going unfollowed rather than a limitation: five tools
  // (`canvas_legal_document_*`, `canvas_request_signature`) were advertised by the canvas
  // and named nowhere in the contract, so rule 1 was simply not being applied to them.
  path.resolve(repoRoot, 'frontend', 'src', 'lib', 'canvasDataRoomTools.ts'),
  path.resolve(repoRoot, 'frontend', 'src', 'lib', 'canvasDocumentTemplateTools.ts'),
  path.resolve(repoRoot, 'frontend', 'src', 'lib', 'canvasLegalDocumentTools.ts'),
  // The legal seat's RECORD projection (`canvas_sync_legal`), added with the three
  // record kinds it fills. Listed the same day it was written, because a family absent
  // from this array makes the guard pass VACUOUSLY — its tools are unclassified, which
  // means they are advertised to a guest board rather than account-gated, and nothing
  // says so. That is exactly how the five `canvas_legal_document_*`/`canvas_request_
  // signature` tools three lines up went a release without rule 1 applying to them.
  path.resolve(repoRoot, 'frontend', 'src', 'lib', 'canvasLegalRecordTools.ts'),
  path.resolve(repoRoot, 'frontend', 'src', 'lib', 'canvasSignatureTools.ts'),
  path.resolve(repoRoot, 'frontend', 'src', 'lib', 'canvasSellMotionTools.ts'),
  // The requisition's binding to its real `job_postings` row (FO-B3). Listed the same
  // day it was written, for the reason the note above `canvasLegalRecordTools.ts` gives:
  // a family absent from this array makes the guard pass VACUOUSLY.
  path.resolve(repoRoot, 'frontend', 'src', 'lib', 'canvasHiringPostingTools.ts'),
];
const CONTRACT_FILE = path.resolve(repoRoot, 'packages', 'creation-canvas-contract', 'src', 'canvasTools.ts');

for (const file of [...CANVAS_FILES, CONTRACT_FILE]) {
  if (!fs.existsSync(file)) {
    console.error(`check-canvas-tool-contract: expected file is missing — ${file}`);
    process.exit(1);
  }
}

/**
 * `export const SOME_NAME = 'canvas_x';` in the contract file — the constant a
 * declaration may name INSTEAD of repeating the string literal, so a tool whose
 * name is quoted more than once (a redirect message, an account gate) has exactly
 * one place that spells it. Resolved here so `declaredCanvasTools` can treat
 * `name: CANVAS_GAME_TOOL,` as declaring `canvas_add_game`, the same as a literal.
 */
function contractToolConstants() {
  const text = fs.readFileSync(CONTRACT_FILE, 'utf8');
  const constants = new Map();
  for (const m of text.matchAll(/^export const ([A-Z][A-Z0-9_]*)\s*=\s*'(canvas_[a-z0-9_]+)';$/gm)) {
    constants.set(m[1], m[2]);
  }
  return constants;
}

/**
 * Tool names the canvas declares, each with the DESCRIPTION it advertises.
 *
 * A declaration is `name: 'canvas_x',` (or `name: SOME_CONST,` naming a constant
 * {@link contractToolConstants} resolves) followed by its `description:` and then
 * `parameters:`, so the span between the name and the parameters is exactly the
 * description — no separate string parser needed, and a template literal is covered.
 */
function declaredCanvasTools() {
  const constants = contractToolConstants();
  const declarations = new Map();
  for (const file of CANVAS_FILES) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/^\s*name:\s*(?:'(canvas_[a-z0-9_]+)'|([A-Z][A-Z0-9_]*)),$/gm)) {
      const name = m[1] ?? constants.get(m[2]);
      if (!name) continue;
      const end = text.indexOf('parameters:', m.index);
      declarations.set(name, end === -1 ? '' : text.slice(m.index + m[0].length, end));
    }
  }
  return declarations;
}

/** Tool names the shared contract classifies, per set. */
function classifiedCanvasTools() {
  const text = fs.readFileSync(CONTRACT_FILE, 'utf8');
  const read = (constName) => {
    const block = new RegExp(`export const ${constName} = \\[([\\s\\S]*?)\\] as const;`).exec(text);
    if (!block) return null;
    return [...block[1].matchAll(/'(canvas_[a-z0-9_]+)'/g)].map((m) => m[1]);
  };
  return {
    guestSafe: read('GUEST_SAFE_CANVAS_TOOLS'),
    guestGated: read('GUEST_GATED_CANVAS_TOOLS'),
    accountRequired: read('ACCOUNT_REQUIRED_CANVAS_TOOLS'),
  };
}

const declarations = declaredCanvasTools();
const declared = new Set(declarations.keys());
const { guestSafe, guestGated, accountRequired } = classifiedCanvasTools();

if (declared.size === 0 || guestSafe === null || guestGated === null || accountRequired === null) {
  console.error('check-canvas-tool-contract: could not parse the canvas actions or the contract — the parse is stale, not the code.');
  process.exit(1);
}

const classified = [...guestSafe, ...guestGated, ...accountRequired];
/** Advertised to an anonymous board: guest-safe outright, or gated but present. */
const guestAdvertised = new Set([...guestSafe, ...guestGated]);
const failures = [];

const duplicates = classified.filter((name, index, all) => all.indexOf(name) !== index);
for (const name of new Set(duplicates)) {
  failures.push(`${name} is classified twice — a tool is guest-safe, guest-gated, or account-required, never more than one.`);
}

for (const name of declared) {
  if (!classified.includes(name)) {
    failures.push(`${name} is advertised by the canvas but classified nowhere. Add it to GUEST_SAFE_CANVAS_TOOLS (local document / public API only), GUEST_GATED_CANVAS_TOOLS (needs a tenant, but refuses a guest with the account gate in the browser), or ACCOUNT_REQUIRED_CANVAS_TOOLS (reads or writes a tenant resource) in packages/creation-canvas-contract/src/canvasTools.ts.`);
  }
}

for (const name of classified) {
  if (!declared.has(name)) {
    failures.push(`${name} is classified in the contract but no longer declared by the canvas. Remove it.`);
  }
}

// RULE 2 — a description may not redirect the model to a tool this session lacks.
for (const [name, description] of declarations) {
  if (!guestAdvertised.has(name)) continue;
  const referenced = new Set([...description.matchAll(/canvas_[a-z0-9_]+/g)].map((m) => m[0]));
  for (const other of referenced) {
    if (other === name || !declared.has(other) || guestAdvertised.has(other)) continue;
    failures.push(`${name} is advertised to anonymous boards but its description names ${other}, which is account-required and absent there. Either reclassify ${other} as guest-gated so it can state its own reason, or stop naming it in a guest-visible description.`);
  }
}

// ── RULE 3 — the SYSTEM PROMPT may not name a tool this board lacks either ──────
//
// Rule 2 covers tool descriptions. It does not cover the much larger surface that
// actually failed: the canvas system prompt, which is assembled in
// `frontend/src/lib/creationCanvasAi.ts` and reaches the model in the SAME request as
// the tool list.
//
// Measured 2026-08-15 (ui 2026.8.17 / api 2026.8.11). The prompt's SOCIAL block is
// unconditional and named all five social tools — "call canvas_add_social_feed",
// "canvas_create_social_campaign", "canvas_publish_social_campaign" — while every one
// of them was account-required and therefore stripped from an anonymous board. The
// model was handed detailed operating instructions for capabilities it did not have.
// Asked to connect social accounts and post to all of them, it resolved the
// contradiction by inventing a product limitation and recommending a competitor. Zero
// tool calls, nothing on the board.
//
// Rule 1 could not catch it (every tool was classified) and rule 2 could not catch it
// (no tool DESCRIPTION was at fault). The property is the same one in both: a name that
// reaches the model must be a name the model can call.
//
// A prompt block wrapped in `persistence === 'server'` is exempt, because that block
// does not exist on an anonymous board — that is how the BUILDING SOFTWARE paragraph
// legitimately names the seven account-required build tools.
const PROMPT_FILE = path.resolve(repoRoot, 'frontend', 'src', 'lib', 'creationCanvasAi.ts');

/** True when this node sits inside the true-branch of a `persistence === 'server'`
 *  conditional — i.e. the text only reaches a signed-in board. */
function isServerOnly(node) {
  for (let current = node; current; current = current.parent) {
    const parent = current.parent;
    if (!parent) break;
    if (ts.isConditionalExpression(parent) && parent.whenTrue === current
      && /persistence\s*===\s*'server'/.test(parent.condition.getText())) return true;
    // The mirror form: `persistence === 'local' ? [] : [ … ]`.
    if (ts.isConditionalExpression(parent) && parent.whenFalse === current
      && /persistence\s*===\s*'local'/.test(parent.condition.getText())) return true;
  }
  return false;
}

if (!fs.existsSync(PROMPT_FILE)) {
  failures.push(`the canvas prompt is missing — expected ${PROMPT_FILE}. This guard reads it; a moved file must move this path too.`);
} else {
  const source = ts.createSourceFile(PROMPT_FILE, fs.readFileSync(PROMPT_FILE, 'utf8'), ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const text = node.getText();
      const named = new Set([...text.matchAll(/canvas_[a-z0-9_]+/g)].map((m) => m[0]));
      const reachable = [...named].filter((name) => declared.has(name));
      if (reachable.length && !isServerOnly(node)) {
        for (const name of reachable) {
          if (guestAdvertised.has(name)) continue;
          const { line } = source.getLineAndCharacterOfPosition(node.getStart());
          failures.push(`the canvas system prompt names ${name} at creationCanvasAi.ts:${line + 1}, but that tool is account-required and absent from an anonymous board. Either reclassify it as guest-gated so it states its own reason when called, or move that prompt block inside the \`options.persistence === 'server'\` branch.`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (failures.length) {
  console.error('check-canvas-tool-contract FAILED:\n');
  for (const failure of failures) console.error(`  • ${failure}`);
  console.error('\nA tool the canvas advertises but the gateway strips is invisible: the model plans around it and silently returns prose.');
  console.error('A tool a description names but the session lacks is worse: the model improvises a limitation and tells the user the product cannot do it.');
  process.exit(1);
}

console.log(`check-canvas-tool-contract: ${declared.size} canvas tools classified (${guestSafe.length} guest-safe, ${guestGated.length} guest-gated, ${accountRequired.length} account-required); ${guestAdvertised.size} guest-visible descriptions and the canvas system prompt cross-checked.`);
