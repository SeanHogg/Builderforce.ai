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
  fields: [
    { name: 'model', control: 'text', section: 'basic', labelKey: 'model', surface: 'full', placeholderKey: 'modelPlaceholder' },
    { name: 'instructions', control: 'textarea', section: 'basic', labelKey: 'instructions', surface: 'full' },
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
      options: [{ value: 'square', labelKey: 'stickyShapeSquare' }, { value: 'round', labelKey: 'stickyShapeRound' }],
    },
  ],
  actions: [],
});

registerKindSettings({
  kinds: ['timer'],
  marketplace: { sellable: () => false },
  fields: [{ name: 'duration', control: 'text', section: 'basic', labelKey: 'duration', surface: 'full' }],
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
