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
 * Every `canvas_*` tool the canvas declares must appear EXACTLY ONCE in
 * `packages/creation-canvas-contract/src/canvasTools.ts`, in either the guest-safe set
 * or the account-required set — and the contract may not name a tool the canvas does
 * not declare. Adding a canvas tool is therefore a two-line change, and forgetting the
 * second line fails the build instead of the product.
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

/** Tool names the canvas actually declares, read from the action definitions. */
function declaredCanvasTools() {
  const text = fs.readFileSync(CANVAS_FILE, 'utf8');
  const names = new Set();
  for (const m of text.matchAll(/^\s*name:\s*'(canvas_[a-z0-9_]+)',$/gm)) names.add(m[1]);
  return names;
}

/** Tool names the shared contract classifies, per set. */
function classifiedCanvasTools() {
  const text = fs.readFileSync(CONTRACT_FILE, 'utf8');
  const read = (constName) => {
    const block = new RegExp(`export const ${constName} = \\[([\\s\\S]*?)\\] as const;`).exec(text);
    if (!block) return null;
    return [...block[1].matchAll(/'(canvas_[a-z0-9_]+)'/g)].map((m) => m[1]);
  };
  return { guestSafe: read('GUEST_SAFE_CANVAS_TOOLS'), accountRequired: read('ACCOUNT_REQUIRED_CANVAS_TOOLS') };
}

const declared = declaredCanvasTools();
const { guestSafe, accountRequired } = classifiedCanvasTools();

if (declared.size === 0 || guestSafe === null || accountRequired === null) {
  console.error('check-canvas-tool-contract: could not parse the canvas actions or the contract — the parse is stale, not the code.');
  process.exit(1);
}

const failures = [];

const duplicates = [...guestSafe, ...accountRequired].filter((name, index, all) => all.indexOf(name) !== index);
for (const name of new Set(duplicates)) {
  failures.push(`${name} is classified twice — a tool is either guest-safe or account-required, never both.`);
}

for (const name of declared) {
  if (!guestSafe.includes(name) && !accountRequired.includes(name)) {
    failures.push(`${name} is advertised by the canvas but classified nowhere. Add it to GUEST_SAFE_CANVAS_TOOLS (local document / public API only) or ACCOUNT_REQUIRED_CANVAS_TOOLS (reads or writes a tenant resource) in packages/creation-canvas-contract/src/canvasTools.ts.`);
  }
}

for (const name of [...guestSafe, ...accountRequired]) {
  if (!declared.has(name)) {
    failures.push(`${name} is classified in the contract but no longer declared by the canvas. Remove it.`);
  }
}

if (failures.length) {
  console.error('check-canvas-tool-contract FAILED:\n');
  for (const failure of failures) console.error(`  • ${failure}`);
  console.error('\nA tool the canvas advertises but the gateway strips is invisible: the model plans around it and silently returns prose.');
  process.exit(1);
}

console.log(`check-canvas-tool-contract: ${declared.size} canvas tools classified (${guestSafe.length} guest-safe, ${accountRequired.length} account-required).`);
