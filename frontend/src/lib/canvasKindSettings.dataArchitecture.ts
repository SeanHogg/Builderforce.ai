/**
 * The six `dataArchitectureObjects.ts` kinds `canvasKindSettingsCompleteness.test.ts`
 * found undeclared. `dataContract`, `dataQuality`, `metric` and `lineage` are authored
 * entirely through their Brain tools (`canvas_set_data_contract`, `canvas_run_data_quality`,
 * `canvas_define_metric`, `canvas_trace_lineage` — see
 * `packages/creation-canvas-contract/src/canvasTools.ts`), never by hand, so they declare
 * no fields; a settings form would just duplicate a button with no wired handler to call.
 * `datasource`/`erd` keep the one field a person plausibly types directly — a query, a
 * dialect — alongside what their tools author.
 */

import { registerKindSettings } from './canvasKindSettings';

registerKindSettings({
  kinds: ['datasource'],
  marketplace: { sellable: () => false },
  fields: [{ name: 'sql', control: 'textarea', section: 'advanced', labelKey: 'sqlQuery', surface: 'full' }],
  actions: [],
});

registerKindSettings({
  // A reusable data model, unlike the live connection above.
  kinds: ['erd'],
  marketplace: { sellable: () => true },
  fields: [
    {
      // Dialect names are the engines' own brands, never translated copy.
      name: 'dialect', control: 'select', section: 'basic', labelKey: 'sqlDialect', surface: 'full',
      options: [
        { value: 'postgres', label: 'PostgreSQL' }, { value: 'mysql', label: 'MySQL' },
        { value: 'sqlite', label: 'SQLite' }, { value: 'mssql', label: 'SQL Server' },
      ],
    },
    { name: 'notes', control: 'textarea', section: 'basic', labelKey: 'notes', surface: 'full' },
  ],
  actions: [],
});

registerKindSettings({ kinds: ['dataContract'], marketplace: { sellable: () => true }, fields: [], actions: [] });
registerKindSettings({ kinds: ['dataQuality'], marketplace: { sellable: () => false }, fields: [], actions: [] });
registerKindSettings({ kinds: ['metric'], marketplace: { sellable: () => true }, fields: [], actions: [] });
registerKindSettings({ kinds: ['lineage'], marketplace: { sellable: () => false }, fields: [], actions: [] });
