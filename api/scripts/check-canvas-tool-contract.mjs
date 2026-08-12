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

const CANVAS_FILE = path.resolve('..', 'frontend', 'src', 'components', 'creation-canvas', 'CreationCanvas.tsx');
const CONTRACT_FILE = path.resolve('..', 'packages', 'creation-canvas-contract', 'src', 'canvasTools.ts');

for (const file of [CANVAS_FILE, CONTRACT_FILE]) {
  if (!fs.existsSync(file)) {
    console.error(`check-canvas-tool-contract: expected file is missing — ${file}`);
    process.exit(1);
  }
}

/**
 * Tool names the canvas declares, each with the DESCRIPTION it advertises.
 *
 * A declaration is `name: 'canvas_x',` followed by its `description:` and then
 * `parameters:`, so the span between the name and the parameters is exactly the
 * description — no separate string parser needed, and a template literal is covered.
 */
function declaredCanvasTools() {
  const text = fs.readFileSync(CANVAS_FILE, 'utf8');
  const declarations = new Map();
  for (const m of text.matchAll(/^\s*name:\s*'(canvas_[a-z0-9_]+)',$/gm)) {
    const end = text.indexOf('parameters:', m.index);
    declarations.set(m[1], end === -1 ? '' : text.slice(m.index + m[0].length, end));
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

if (failures.length) {
  console.error('check-canvas-tool-contract FAILED:\n');
  for (const failure of failures) console.error(`  • ${failure}`);
  console.error('\nA tool the canvas advertises but the gateway strips is invisible: the model plans around it and silently returns prose.');
  console.error('A tool a description names but the session lacks is worse: the model improvises a limitation and tells the user the product cannot do it.');
  process.exit(1);
}

console.log(`check-canvas-tool-contract: ${declared.size} canvas tools classified (${guestSafe.length} guest-safe, ${guestGated.length} guest-gated, ${accountRequired.length} account-required); ${guestAdvertised.size} guest-visible descriptions cross-checked.`);
