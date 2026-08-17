/**
 * Kinds whose full-inspector body was ALREADY a real, well-factored component
 * (`GuidedTourInspector`, `BuildInspectorSection`, `CanvasVoiceInspector`,
 * `CanvasEmailComposer`, `EvermindInspector`, `PitchInspector`). Nothing about how
 * those work changes — this only turns their DISPATCH from a `kind === 'x'` branch
 * into a manifest lookup, same as every other kind here.
 */

import { registerKindSettings } from './canvasKindSettings';
import { PITCH_OBJECT_KINDS } from './pitchCompetition';

registerKindSettings({ kinds: ['guidedTour'], marketplace: { sellable: () => true }, fields: [], actions: [], custom: { component: 'guidedTour' } });
registerKindSettings({ kinds: ['build'], marketplace: { sellable: () => true }, fields: [], actions: [], custom: { component: 'build' } });
registerKindSettings({ kinds: ['voice'], marketplace: { sellable: () => true }, fields: [], actions: [], custom: { component: 'voice' } });
registerKindSettings({ kinds: ['email'], marketplace: { sellable: () => true }, fields: [], actions: [], custom: { component: 'email' } });
registerKindSettings({ kinds: ['evermind'], marketplace: { sellable: () => true }, fields: [], actions: [], custom: { component: 'evermind' } });
registerKindSettings({ kinds: [...PITCH_OBJECT_KINDS], marketplace: { sellable: () => true }, fields: [], actions: [], custom: { component: 'pitch' } });
