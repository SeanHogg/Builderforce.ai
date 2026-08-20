import { describe, expect, it } from 'vitest';
import { CREATION_OBJECT_KINDS } from '@builderforce/creation-canvas-contract';
import { isSpecObjectKind } from './specObjects';
import { isKindSettingsKind } from './canvasKindSettings';
// `specObjectSets.ts` is the one module that knows every spec vocabulary — see its own
// header for why importing any ONE set here would have silently under-counted, exactly
// the failure this file exists to catch on the other side of the registry.
import './specObjectSets';
import './canvasKindSettings.people';
import './canvasKindSettings.simple';
import './canvasKindSettings.dispatch';
import './canvasKindSettings.custom';
import './canvasKindSettings.board';
import './canvasKindSettings.sales';
import './canvasKindSettings.outreach';
import './canvasKindSettings.dataArchitecture';
import './canvasKindSettings.qa';
import './canvasKindSettings.delivery';

/**
 * Every canvas kind resolves to a declared configuration — a `SpecObjectSpec` (edited
 * on its card) or a `KindSettingsManifest` (edited in the anchored panel / inspector).
 * This is the guard `agent`/`staff` and ~28 other kinds needed and never had:
 * `creationObjectRegistry.test.ts` already catches a kind missing from the PALETTE (its
 * "176 vs 175" drift); nothing caught one missing a CONFIGURATION until this file,
 * which is how thirty kinds fell through to a hand-written `kind === 'x'` chain with no
 * manifest behind it, and — this test's own first run found — another forty-two fell
 * through to nothing at all: no chain entry, no spec, no manifest, just the generic
 * "this object lives on the board" hint for every one of them.
 *
 * ── WHY A RATCHET, NOT A HARD ZERO ────────────────────────────────────────────────
 * That second group (`PENDING_KIND_SETTINGS` below) is real, pre-existing debt this
 * test surfaced rather than caused — and closing it is per-kind PRODUCT judgment, not
 * mechanical extraction: does a `chart` need settings beyond its data, does a
 * `salesPipeline` need a stage-list editor, does `terminal` need anything at all? That
 * is thirty-odd separate design questions, not one refactor, so it is tracked in
 * `ROADMAP.md` under "Canvas kind settings completeness" rather than guessed at here.
 * What this test DOES enforce, today: the pending list cannot grow. A newly registered
 * kind with no configuration fails immediately, the same day it is added — which is
 * the whole point of a ratchet the design-scale guard already proves works in this repo.
 */
describe('canvas kind settings completeness', () => {
  // `chat` is a genuine third bucket, not debt: a dedicated conversation surface
  // (`BrainObjectBody`, mounted by `CreationNode`), not a settings/inspector panel —
  // there is no configuration to declare because there is no form to draw.
  //
  // `course`/`practice` are the same bucket for a different reason: they already have
  // real, rich authoring UI — `CourseSubjectControl`/`PracticeAuthoring` in
  // `LearningControls.tsx` — mounted unconditionally in the full inspector (each
  // self-gates on `data.kind`, the way `ReadingLevelControl` does) rather than through
  // `KindSettingsManifest`'s `custom.component` dispatch. Routing them through the
  // manifest too would either duplicate that mount or force a second, indirect path to
  // the same component for no behavioural change — this test's job is to catch a kind
  // with NO configuration, and both of these have configuration, just declared beside
  // the inspector rather than inside this registry.
  const EXEMPT = new Set(['chat', 'course', 'practice']);

  // Every kind that had no declaration when this test was first written has one now —
  // see `canvasKindSettings.board.ts`, `.sales.ts`, `.outreach.ts`,
  // `.dataArchitecture.ts` and `.qa.ts`. Empty on purpose: the ratchet stays live for
  // whatever a newly registered kind might skip next.
  const PENDING_KIND_SETTINGS = new Set<string>([]);

  it('never grows the pending list beyond today\'s baseline', () => {
    const undeclared = CREATION_OBJECT_KINDS.filter(
      (kind) => !EXEMPT.has(kind) && !isSpecObjectKind(kind) && !isKindSettingsKind(kind),
    );
    const newlyUndeclared = undeclared.filter((kind) => !PENDING_KIND_SETTINGS.has(kind));
    expect(newlyUndeclared).toEqual([]);
  });

  it('does not carry a pending entry that quietly already has a declaration', () => {
    // The other direction of drift: an entry fixed here and forgotten in the set above
    // would keep passing forever while claiming debt that no longer exists.
    const stale = [...PENDING_KIND_SETTINGS].filter((kind) => isSpecObjectKind(kind) || isKindSettingsKind(kind));
    expect(stale).toEqual([]);
  });

  /**
   * A kind whose manifest AUTHORS the inputs its spec DERIVES from.
   *
   * The guard below reads a double declaration as drift, and for every kind it has ever
   * caught that was right: two places describing one card is two places to disagree
   * about it. `llm` is the case that is genuinely both, and the split is clean rather
   * than duplicated — the manifest declares the rate card and the volume, which are
   * numbers a PERSON types into the inspector, and the spec declares what is computed
   * from them (cost per request, projected monthly cost, monthly tokens, the
   * input/output split) and draws it on the card. Neither declares a field the other
   * does, and deliberately there is no control for a price: an authored total is exactly
   * what `SpecField.derive` exists to abolish.
   *
   * Named here rather than the guard relaxed, so a second entry is a deliberate act with
   * this argument to answer, and a kind that appears twice by accident still fails.
   */
  const AUTHORED_INPUTS_DERIVED_OUTPUTS = new Set(['llm']);

  it('never double-declares a kind in both registries', () => {
    const doubled = CREATION_OBJECT_KINDS.filter(
      (kind) => !AUTHORED_INPUTS_DERIVED_OUTPUTS.has(kind) && isSpecObjectKind(kind) && isKindSettingsKind(kind),
    );
    expect(doubled).toEqual([]);
  });

  it('does not exempt a kind that is no longer declared twice', () => {
    // The other direction, matching the pending-list guard above: an exemption kept
    // after the condition it describes is gone would hide the next real double
    // declaration of that kind.
    const stale = [...AUTHORED_INPUTS_DERIVED_OUTPUTS].filter((kind) => !(isSpecObjectKind(kind) && isKindSettingsKind(kind)));
    expect(stale).toEqual([]);
  });
});
