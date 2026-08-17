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
 * on its card) or a `KindSettingsManifest` (edited in the anchored panel / inspector) —
 * with one narrow, named exception. This is the guard `agent`/`staff` and ~28 other
 * kinds needed and never had: `creationObjectRegistry.test.ts` already catches a kind
 * missing from the PALETTE (its "176 vs 175" drift); nothing caught one missing a
 * configuration until now, which is how thirty kinds fell through to a hand-written
 * `kind === 'x'` chain with no manifest behind it at all.
 */
describe('canvas kind settings completeness', () => {
  // `chat` is the one genuine third bucket: a dedicated conversation surface
  // (`BrainObjectBody`, mounted by `CreationNode`), not a settings/inspector panel —
  // there is no configuration to declare because there is no form to draw.
  const EXEMPT = new Set(['chat']);

  it('gives every registered kind a spec-object OR kind-settings declaration', () => {
    const undeclared = CREATION_OBJECT_KINDS.filter(
      (kind) => !EXEMPT.has(kind) && !isSpecObjectKind(kind) && !isKindSettingsKind(kind),
    );
    expect(undeclared).toEqual([]);
  });

  it('never double-declares a kind in both registries', () => {
    const doubled = CREATION_OBJECT_KINDS.filter((kind) => isSpecObjectKind(kind) && isKindSettingsKind(kind));
    expect(doubled).toEqual([]);
  });
});
