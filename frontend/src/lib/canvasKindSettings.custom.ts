/**
 * Kinds with real derived cross-node state, array-of-object editing, or file/network
 * side effects that a plain `onChange(patch)` field can't express — `evaluation`'s
 * read-only test-result history, `task`'s PRD/agent-assignment joins, `dataset`'s file
 * import, `website`'s hero+theme mirroring. Each gets a `custom.component` pointing at
 * a section extracted VERBATIM out of the old `kind === 'x'` chain — the section
 * components and the `KIND_DETAIL_SECTIONS` dispatch table they register into live in
 * `CreationCanvas.tsx` itself, beside the `Inspector` that used to hand-write all of
 * this, because they close over the same derived state (`connectedAgentKnowledge`,
 * `deliveryAgent`, `taskAgents`…) that component already computes. This manifest only
 * declares that the kind exists and what may be done to it; the rendering stays exactly
 * what it was.
 */

import { registerKindSettings } from './canvasKindSettings';
import { WEB_PAGE_KINDS } from './canvasWebPage';
import { CREATIVE_GENERATOR_KINDS } from './creationObjectGroups';

registerKindSettings({ kinds: ['evaluation'], marketplace: { sellable: () => true }, fields: [], actions: [], custom: { component: 'evaluation' } });
registerKindSettings({ kinds: ['release'], marketplace: { sellable: () => true }, fields: [], actions: [], custom: { component: 'release' } });
registerKindSettings({ kinds: ['website', 'prototype'], marketplace: { sellable: () => true }, fields: [], actions: [], custom: { component: 'website' } });
registerKindSettings({ kinds: ['video'], marketplace: { sellable: () => true }, fields: [], actions: [], custom: { component: 'video' } });
registerKindSettings({ kinds: ['dataset'], marketplace: { sellable: () => true }, fields: [], actions: [], custom: { component: 'dataset' } });
registerKindSettings({ kinds: ['task'], marketplace: { sellable: () => true }, fields: [], actions: [], custom: { component: 'task' } });
registerKindSettings({ kinds: ['mockup'], marketplace: { sellable: () => true }, fields: [], actions: [], custom: { component: 'mockup' } });
registerKindSettings({ kinds: ['drawing'], marketplace: { sellable: () => true }, fields: [], actions: [], custom: { component: 'drawing' } });
registerKindSettings({ kinds: [...CREATIVE_GENERATOR_KINDS], marketplace: { sellable: () => true }, fields: [], actions: [], custom: { component: 'creative' } });
registerKindSettings({ kinds: [...WEB_PAGE_KINDS], marketplace: { sellable: () => true }, fields: [], actions: [], custom: { component: 'webPage' } });
