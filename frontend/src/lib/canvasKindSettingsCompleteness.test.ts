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
  const EXEMPT = new Set(['chat']);

  // Frozen at the count this test found on its first run. See `ROADMAP.md` —
  // "Canvas kind settings completeness" — for the per-kind design work each entry
  // needs before it can move to `canvasKindSettings.*.ts` (or gain its own exemption).
  const PENDING_KIND_SETTINGS = new Set([
    'table', 'spreadsheet', 'chart', 'map', 'kpi', 'code', 'llm', 'world', 'comment',
    'timer', 'sticky', 'roadmap', 'featureSummary', 'team', 'role', 'mcp', 'repository',
    'selection', 'diagnostics', 'terminal',
    'salesPipeline', 'salesContact', 'salesCampaign', 'targetMarket', 'salesGoal', 'salesMeeting',
    'inbox', 'emailCampaign', 'emailTemplate',
    'socialFeed', 'socialPost', 'socialCampaign',
    'datasource', 'erd', 'dataContract', 'dataQuality', 'metric', 'lineage',
    'course', 'practice',
    'testPlan', 'testCase', 'testRun', 'defect',
  ]);

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

  it('never double-declares a kind in both registries', () => {
    const doubled = CREATION_OBJECT_KINDS.filter((kind) => isSpecObjectKind(kind) && isKindSettingsKind(kind));
    expect(doubled).toEqual([]);
  });
});
