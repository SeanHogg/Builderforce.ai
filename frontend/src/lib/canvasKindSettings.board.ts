/**
 * The generic board/data/build kinds `canvasKindSettingsCompleteness.test.ts` found with
 * no configuration at all — not even a hand-written `kind === 'x'` branch, just the
 * fallback "this object lives on the board" hint. Per the module rule in
 * `canvasKindSettings.ts`, each gets a plain field list here UNLESS it genuinely has
 * nothing to configure — the field list is empty (not the kind omitted) so the
 * completeness guard can tell "considered, nothing to edit" from "never declared".
 *
 * `table`, `spreadsheet`, `world`, `roadmap`, `featureSummary`, `comment`, `selection`,
 * `diagnostics` and `terminal` are that empty case: a table/spreadsheet's own grid is its
 * editor, a world's own 3D view is its editor, a roadmap/feature-summary's content is
 * AI-synthesized, a comment thread is edited inline, and `selection`/`diagnostics`/
 * `terminal` are read-only captures from the IDE with nothing a person authors.
 */

import { registerKindSettings } from './canvasKindSettings';
// The ONE geometry vocabulary. The sticky's shape control reads it rather than restating
// it — see the field's own note for why two lists of one vocabulary fail silently.
import { STENCIL_SHAPES } from './canvasStencils';

registerKindSettings({ kinds: ['table'], marketplace: { sellable: () => true }, fields: [], actions: [] });
registerKindSettings({ kinds: ['spreadsheet'], marketplace: { sellable: () => true }, fields: [], actions: [] });
registerKindSettings({ kinds: ['world'], marketplace: { sellable: () => true }, fields: [], actions: [] });
registerKindSettings({ kinds: ['roadmap'], marketplace: { sellable: () => true }, fields: [], actions: [] });
registerKindSettings({ kinds: ['featureSummary'], marketplace: { sellable: () => true }, fields: [], actions: [] });
// Board furniture / IDE captures — nothing here is sellable, same reasoning `frame` uses.
registerKindSettings({ kinds: ['comment'], marketplace: { sellable: () => false }, fields: [], actions: [] });
registerKindSettings({ kinds: ['selection'], marketplace: { sellable: () => false }, fields: [], actions: [] });
registerKindSettings({ kinds: ['diagnostics'], marketplace: { sellable: () => false }, fields: [], actions: [] });
registerKindSettings({ kinds: ['terminal'], marketplace: { sellable: () => false }, fields: [], actions: [] });

registerKindSettings({
  kinds: ['chart'],
  marketplace: { sellable: () => true },
  fields: [
    {
      name: 'chartType', control: 'select', section: 'basic', labelKey: 'chartType', surface: 'full',
      options: [
        { value: 'bar', labelKey: 'chartTypeBar' }, { value: 'line', labelKey: 'chartTypeLine' },
        { value: 'pie', labelKey: 'chartTypePie' }, { value: 'area', labelKey: 'chartTypeArea' },
      ],
    },
    { name: 'chartTitle', control: 'text', section: 'basic', labelKey: 'chartTitle', surface: 'full' },
    { name: 'xAxisLabel', control: 'text', section: 'basic', labelKey: 'xAxisLabel', surface: 'full' },
    { name: 'yAxisLabel', control: 'text', section: 'basic', labelKey: 'yAxisLabel', surface: 'full' },
  ],
  actions: [],
});

registerKindSettings({
  kinds: ['map'],
  marketplace: { sellable: () => true },
  fields: [
    { name: 'mapTitle', control: 'text', section: 'basic', labelKey: 'mapTitle', surface: 'full' },
    { name: 'mapValueLabel', control: 'text', section: 'basic', labelKey: 'mapValueLabel', surface: 'full' },
    { name: 'mapRegionName', control: 'text', section: 'basic', labelKey: 'mapRegionName', surface: 'full' },
  ],
  actions: [],
});

registerKindSettings({
  kinds: ['kpi'],
  marketplace: { sellable: () => true },
  fields: [
    { name: 'target', control: 'number', section: 'basic', labelKey: 'targetValue', surface: 'full' },
    { name: 'unit', control: 'text', section: 'basic', labelKey: 'unit', surface: 'full' },
  ],
  actions: [],
});

registerKindSettings({
  kinds: ['code'],
  marketplace: { sellable: () => true },
  fields: [
    { name: 'language', control: 'text', section: 'basic', labelKey: 'language', surface: 'full' },
    { name: 'path', control: 'text', section: 'basic', labelKey: 'path', surface: 'full' },
  ],
  actions: [],
});

registerKindSettings({
  kinds: ['llm'],
  marketplace: { sellable: () => true },
  // The rate card and the volume are AUTHORED here; every number computed from them —
  // cost per request, projected monthly cost, monthly tokens, the input/output split —
  // is derived by the spec and drawn on the card, so there is deliberately no control
  // for a price. See `lib/modelObjects.ts`. Until these existed the cost fields were
  // writable only by Brain, which is why a projector nothing could feed sat unimported.
  fields: [
    { name: 'model', control: 'text', section: 'basic', labelKey: 'model', surface: 'full', placeholderKey: 'modelPlaceholder' },
    { name: 'instructions', control: 'textarea', section: 'basic', labelKey: 'instructions', surface: 'full' },
    { name: 'costPerMillionInput', control: 'number', section: 'basic', labelKey: 'llmCostPerMillionInput', surface: 'full', min: 0 },
    { name: 'costPerMillionOutput', control: 'number', section: 'basic', labelKey: 'llmCostPerMillionOutput', surface: 'full', min: 0 },
    { name: 'tokensPerRequestIn', control: 'number', section: 'basic', labelKey: 'llmTokensPerRequestIn', surface: 'full', min: 0 },
    { name: 'tokensPerRequestOut', control: 'number', section: 'basic', labelKey: 'llmTokensPerRequestOut', surface: 'full', min: 0 },
    { name: 'monthlyRequests', control: 'number', section: 'basic', labelKey: 'llmMonthlyRequests', surface: 'full', min: 0 },
    // 0–1, not 0–100: it is the share `projectLlmCost` multiplies by, and converting in
    // the control would put the same conversion in two places the day a second surface
    // edits it.
    { name: 'cacheHitRate', control: 'number', section: 'advanced', labelKey: 'llmCacheHitRate', surface: 'full', min: 0, max: 1 },
    { name: 'latencyP50Ms', control: 'number', section: 'advanced', labelKey: 'llmLatencyP50Ms', surface: 'full', min: 0 },
    { name: 'latencyP95Ms', control: 'number', section: 'advanced', labelKey: 'llmLatencyP95Ms', surface: 'full', min: 0 },
  ],
  actions: [],
});

registerKindSettings({
  kinds: ['sticky'],
  // Board furniture, same as `frame` — a note groups nothing to sell.
  marketplace: { sellable: () => false },
  fields: [
    { name: 'stickyColor', control: 'color', section: 'basic', labelKey: 'stickyColor', surface: 'full' },
    {
      name: 'stickyShape', control: 'select', section: 'basic', labelKey: 'stickyShape', surface: 'full',
      // The geometries `CreationCanvas.module.css` can DRAW, read from the ONE stencil
      // registry rather than restated here. This list used to be eight values written
      // out beside a stylesheet that knew about them — two lists of one vocabulary, and
      // the degradation when they disagree is SILENT (an undrawn shape falls back to the
      // square card), so a select offering a shape nothing draws looks like a bug in the
      // card rather than a missing rule. `lib/canvasStencils.ts` is now the source both
      // the palette's stencil packs and this control read.
      options: STENCIL_SHAPES.map((shape) => ({ value: shape.value, labelKey: `stencilShape.${shape.labelKey}` })),
    },
  ],
  actions: [],
});

/**
 * The two clocks.
 *
 * `timer` declares its TIMEBOX (`durationMs`) and nothing else a person types: the card
 * runs the clock and derives what it shows. It used to declare a free-text `duration`
 * field, which was a label — the card had no clock at all, so the string was the entire
 * feature. `stopwatch` has no box by definition, so it declares nothing and its manifest
 * is the "considered, nothing to edit" empty case this module's header describes.
 *
 * Neither is sellable, for the same reason `frame` is not: board furniture.
 */
registerKindSettings({
  kinds: ['timer'],
  marketplace: { sellable: () => false },
  fields: [{
    name: 'durationMs', control: 'number', section: 'basic', labelKey: 'timerDurationMs', surface: 'both', min: 1000,
  }],
  actions: [],
});
registerKindSettings({ kinds: ['stopwatch'], marketplace: { sellable: () => false }, fields: [], actions: [] });

/**
 * The transclusion — another document, shown live.
 *
 * One field, because the reference IS the object: everything else on the card is the
 * referenced document's own current content, which is exactly what a transclusion must
 * not let anybody edit from here. Not sellable — it is a pointer at somebody's document,
 * and what would be sold is the pointer.
 */
registerKindSettings({
  kinds: ['transclusion'],
  marketplace: { sellable: () => false },
  fields: [{ name: 'documentId', control: 'text', section: 'basic', labelKey: 'transclusionDocumentId', surface: 'both' }],
  actions: [],
});

/**
 * A platform component, mounted on the board.
 *
 * One field, and it is the same shape `transclusion` uses one field for: the
 * reference IS the object. Everything else the card shows is the component's own
 * live, tenant-scoped surface, which is exactly what must not be editable from a
 * board's inspector.
 *
 * Not sellable, and for a sharper reason than a transclusion's. What would be
 * sold is a view onto the SELLER's tenant data — the buyer would get a card that
 * either shows them nothing or shows them somebody else's business. A component
 * travels to a buyer as part of the platform they are already on, not as an
 * object in a listing.
 */
registerKindSettings({
  kinds: ['component'],
  marketplace: { sellable: () => false },
  fields: [{ name: 'componentId', control: 'text', section: 'basic', labelKey: 'componentId', surface: 'both' }],
  actions: [],
});

registerKindSettings({
  // A live-connected tool call, not a template — nothing here to resell.
  kinds: ['mcp'],
  marketplace: { sellable: () => false },
  fields: [{ name: 'operation', control: 'text', section: 'basic', labelKey: 'operation', surface: 'full' }],
  actions: [],
});

registerKindSettings({
  // A specific linked repo, not a reusable artifact.
  kinds: ['repository'],
  marketplace: { sellable: () => false },
  fields: [
    { name: 'url', control: 'text', section: 'basic', labelKey: 'repositoryUrl', surface: 'full' },
    { name: 'branch', control: 'text', section: 'basic', labelKey: 'branch', surface: 'full' },
  ],
  actions: [],
});

registerKindSettings({
  // A specific board's roster — see `staff`'s manifest for the same reasoning.
  kinds: ['team'],
  marketplace: { sellable: () => false },
  fields: [],
  actions: [],
});

registerKindSettings({
  // A specific requisition tied to this org's headcount, not a listing to sell.
  kinds: ['role'],
  marketplace: { sellable: () => false },
  fields: [
    { name: 'responsibilities', control: 'textarea', section: 'basic', labelKey: 'responsibilities', surface: 'full' },
    { name: 'level', control: 'select', section: 'basic', labelKey: 'level', surface: 'full', options: [
      { value: 'junior', labelKey: 'levelJunior' }, { value: 'mid', labelKey: 'levelMid' },
      { value: 'senior', labelKey: 'levelSenior' }, { value: 'lead', labelKey: 'levelLead' },
    ] },
    { name: 'salary', control: 'number', section: 'basic', labelKey: 'salary', surface: 'full' },
    // Currency codes are the value's own name, never translated copy — same rule the
    // `workflow` manifest's runtime options follow.
    { name: 'currency', control: 'select', section: 'basic', labelKey: 'currency', surface: 'full', options: [
      { value: 'USD', label: 'USD' }, { value: 'EUR', label: 'EUR' }, { value: 'GBP', label: 'GBP' },
    ] },
    { name: 'headcountStatus', control: 'select', section: 'basic', labelKey: 'headcountStatus', surface: 'full', options: [
      { value: 'open', labelKey: 'headcountOpen' }, { value: 'filled', labelKey: 'headcountFilled' },
      { value: 'paused', labelKey: 'headcountPaused' },
    ] },
  ],
  actions: [],
});
