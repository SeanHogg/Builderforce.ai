/**
 * The delivery-lifecycle kinds — `pullRequest`, `ciRun`, `deployment`,
 * `productionIncident`, `environment` — plus `deliveryRollup`, the PMO rollup mirrored
 * onto a board. The first five have no wired sync action yet (no `refresh`/`sync`
 * handler exists in `detailsActionHandlers` for any of them, the same reason
 * `canvasKindSettings.dataArchitecture.ts`'s live-tool kinds decline to advertise a
 * button nothing answers) — each just gets the identifying fields a person would type
 * when referencing something that shipped outside the board, until a real sync exists
 * to author them instead. `deliveryRollup` is the one exception: `refresh` IS wired,
 * to `pmoApi.rollup` — see its own block below.
 */

import { registerKindSettings } from './canvasKindSettings';

registerKindSettings({
  // A specific PR against a specific repo, not a reusable artifact.
  kinds: ['pullRequest'],
  marketplace: { sellable: () => false },
  fields: [
    { name: 'url', control: 'text', section: 'basic', labelKey: 'repositoryUrl', surface: 'full' },
    { name: 'branch', control: 'text', section: 'basic', labelKey: 'branch', surface: 'full' },
    { name: 'baseBranch', control: 'text', section: 'basic', labelKey: 'baseBranch', surface: 'full' },
    { name: 'author', control: 'text', section: 'basic', labelKey: 'author', surface: 'full' },
  ],
  actions: [],
});

registerKindSettings({
  kinds: ['ciRun'],
  marketplace: { sellable: () => false },
  fields: [
    { name: 'url', control: 'text', section: 'basic', labelKey: 'repositoryUrl', surface: 'full' },
    { name: 'branch', control: 'text', section: 'basic', labelKey: 'branch', surface: 'full' },
    { name: 'commitSha', control: 'text', section: 'basic', labelKey: 'commitSha', surface: 'full' },
  ],
  actions: [],
});

registerKindSettings({
  kinds: ['deployment'],
  marketplace: { sellable: () => false },
  fields: [
    { name: 'environmentName', control: 'text', section: 'basic', labelKey: 'environmentName', surface: 'full' },
    { name: 'version', control: 'text', section: 'basic', labelKey: 'version', surface: 'full' },
    { name: 'url', control: 'text', section: 'basic', labelKey: 'repositoryUrl', surface: 'full' },
  ],
  actions: [],
});

registerKindSettings({
  kinds: ['productionIncident'],
  marketplace: { sellable: () => false },
  fields: [
    {
      name: 'severity', control: 'select', section: 'basic', labelKey: 'severity', surface: 'full',
      options: [
        { value: 'low', labelKey: 'severityLow' }, { value: 'medium', labelKey: 'severityMedium' },
        { value: 'high', labelKey: 'severityHigh' }, { value: 'critical', labelKey: 'severityCritical' },
      ],
    },
    { name: 'owner', control: 'text', section: 'basic', labelKey: 'owner', surface: 'full' },
    { name: 'postmortemUrl', control: 'text', section: 'basic', labelKey: 'postmortemUrl', surface: 'full' },
  ],
  actions: [],
});

registerKindSettings({
  kinds: ['environment'],
  marketplace: { sellable: () => false },
  fields: [
    { name: 'environmentUrl', control: 'text', section: 'basic', labelKey: 'repositoryUrl', surface: 'full' },
    {
      name: 'environmentKind', control: 'select', section: 'basic', labelKey: 'environmentKind', surface: 'full',
      options: [
        { value: 'production', labelKey: 'environmentProduction' }, { value: 'staging', labelKey: 'environmentStaging' },
        { value: 'preview', labelKey: 'environmentPreview' }, { value: 'development', labelKey: 'environmentDevelopment' },
      ],
    },
  ],
  actions: [],
});

/** Everything below `scopeKind`/`scopeId` is written by the `refresh` action
 *  (`refreshDeliveryRollup` in `CreationCanvas.tsx`, calling `pmoApi.rollup`) —
 *  never authored, so every stat field is locked. */
const rollupStatField = (name: string, labelKey: string) => ({
  name, control: 'number' as const, section: 'basic' as const, labelKey, surface: 'full' as const,
  editable: () => false,
});

registerKindSettings({
  // One board's own view of PMO's live rollup, not a listing — never sellable.
  kinds: ['deliveryRollup'],
  marketplace: { sellable: () => false },
  hintKey: 'deliveryRollupHint',
  fields: [
    {
      name: 'scopeKind', control: 'select', section: 'basic', labelKey: 'scopeKind', surface: 'full',
      options: [
        { value: 'workspace', labelKey: 'scopeWorkspace' }, { value: 'portfolio', labelKey: 'scopePortfolio' },
        { value: 'initiative', labelKey: 'scopeInitiative' }, { value: 'project', labelKey: 'scopeProject' },
      ],
    },
    {
      name: 'scopeId', control: 'text', section: 'basic', labelKey: 'scopeId', surface: 'full',
      visible: (data) => data.scopeKind !== 'workspace',
    },
    rollupStatField('totalTasks', 'totalTasks'),
    rollupStatField('completedCount', 'completedCount'),
    rollupStatField('openCount', 'openCount'),
    rollupStatField('avgCycleTimeHours', 'avgCycleTimeHours'),
    rollupStatField('throughputPerWeek', 'throughputPerWeek'),
    rollupStatField('agentLlmCostUsd', 'agentLlmCostUsd'),
    rollupStatField('deploymentFrequencyPerDay', 'deploymentFrequencyPerDay'),
    rollupStatField('leadTimeHours', 'leadTimeHours'),
    rollupStatField('changeFailureRatePct', 'changeFailureRatePct'),
    rollupStatField('mttrHours', 'mttrHours'),
    rollupStatField('avgOkrProgress', 'avgOkrProgress'),
  ],
  actions: [{ name: 'refresh', labelKey: 'refreshDeliveryRollup', style: 'primary', handler: 'refreshDeliveryRollup' }],
});
