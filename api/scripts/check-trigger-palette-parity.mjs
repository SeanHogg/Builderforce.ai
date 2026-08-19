/**
 * check-trigger-palette-parity — a trigger the builder OFFERS must be one the
 * runtime can FIRE.
 *
 * ── THE DEFECT THIS EXISTS TO STOP ───────────────────────────────────────────────
 * The workflow builder's trigger node renders its choices from a literal option list in
 * `frontend/src/components/workflow-builder/nodeKinds.ts`. The runtime decides what is
 * real from `ACTIVATABLE_TRIGGER_TYPES` in `api/src/domain/workflowTriggers.ts`: only a
 * type in that list gets a `workflow_triggers` row at save, and only a row can ever fire.
 *
 * Those two lists drifted, and the drift was SILENT in the worst possible direction.
 * `board-event`, `form-submit`, `page-view`, `signup`, `purchase`, `email-open`,
 * `email-click` and `integration` sat in the palette for releases. A user could pick
 * "task moved", wire a whole workflow to it, save, and see it listed as an active
 * automation — and nothing was ever registered, so it could not fire. There was no
 * error to read: the feature simply did not exist behind a control that said it did.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────
 * Every `triggerType` option in the palette must be either `manual` (the deliberate
 * "started by a person" case, which needs no registry row) or a member of
 * `ACTIVATABLE_TRIGGER_TYPES`. The reverse is also checked: an activatable type the
 * palette never offers is a trigger nobody can reach.
 *
 * Both files are parsed as TEXT rather than imported — the frontend module pulls in
 * React types and the domain module is TypeScript, and a guard that needs a build step
 * is a guard that gets skipped.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const PALETTE = resolve(repoRoot, 'frontend/src/components/workflow-builder/nodeKinds.ts');
const DOMAIN = resolve(repoRoot, 'api/src/domain/workflowTriggers.ts');

/** The `triggerType` select's `options: [...]` array in the palette. */
function paletteTriggerTypes(source) {
  const anchor = source.indexOf("key: 'triggerType'");
  if (anchor === -1) throw new Error("nodeKinds.ts no longer declares a 'triggerType' field");
  const optionsAt = source.indexOf('options: [', anchor);
  if (optionsAt === -1) throw new Error("the 'triggerType' field no longer declares options");
  const close = source.indexOf(']', optionsAt);
  return [...source.slice(optionsAt, close).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** The union of EVENT_TRIGGER_TYPES and the transport types spread into
 *  ACTIVATABLE_TRIGGER_TYPES. */
function activatableTypes(source) {
  const read = (name) => {
    const at = source.indexOf(`export const ${name} = [`);
    if (at === -1) throw new Error(`workflowTriggers.ts no longer exports ${name}`);
    const close = source.indexOf('] as const', at);
    return [...source.slice(at, close).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  };
  return new Set([...read('EVENT_TRIGGER_TYPES'), ...read('ACTIVATABLE_TRIGGER_TYPES')]);
}

const palette = paletteTriggerTypes(readFileSync(PALETTE, 'utf8'));
const activatable = activatableTypes(readFileSync(DOMAIN, 'utf8'));

/** Offered by the builder but never registered — a control that promises nothing. */
const dead = palette.filter((type) => type !== 'manual' && !activatable.has(type));
/** Registrable but unreachable — a trigger no user can select. */
const unreachable = [...activatable].filter((type) => !palette.includes(type));

if (dead.length === 0 && unreachable.length === 0) {
  console.log(`check:trigger-palette OK — ${palette.length} palette options, all activatable or manual`);
  process.exit(0);
}

if (dead.length) {
  console.error(
    `check:trigger-palette FAILED — the builder offers ${dead.length} trigger type(s) the runtime can never fire:\n` +
    dead.map((t) => `  • '${t}' — add it to EVENT_TRIGGER_TYPES in api/src/domain/workflowTriggers.ts AND emit it from the service that owns the event, or remove it from the palette`).join('\n'),
  );
}
if (unreachable.length) {
  console.error(
    `check:trigger-palette FAILED — ${unreachable.length} activatable trigger type(s) are unreachable from the builder:\n` +
    unreachable.map((t) => `  • '${t}' — add it to the triggerType options in frontend/src/components/workflow-builder/nodeKinds.ts`).join('\n'),
  );
}
process.exit(1);
