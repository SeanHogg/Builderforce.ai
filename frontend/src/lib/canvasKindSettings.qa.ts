/**
 * The four QA kinds `canvasKindSettingsCompleteness.test.ts` found undeclared.
 * `testRun` declares no fields — its `results` are written by the run itself, never
 * typed by hand, the same reasoning `evaluation`'s read-only history gets a
 * `custom.component` for elsewhere. Export is already covered for all four by the
 * universal `CanvasExportActions` section every kind gets, so none of these repeats it
 * as a manifest action.
 */

import { registerKindSettings } from './canvasKindSettings';

registerKindSettings({
  // A reusable plan, unlike the specific run below.
  kinds: ['testPlan'],
  marketplace: { sellable: () => true },
  fields: [{ name: 'targetUrl', control: 'text', section: 'basic', labelKey: 'targetUrl', surface: 'full' }],
  actions: [],
});

registerKindSettings({
  kinds: ['testCase'],
  marketplace: { sellable: () => true },
  fields: [
    {
      name: 'priority', control: 'select', section: 'basic', labelKey: 'priority', surface: 'full',
      options: [
        { value: 'low', labelKey: 'priorityLow' }, { value: 'normal', labelKey: 'priorityNormal' },
        { value: 'high', labelKey: 'priorityHigh' }, { value: 'critical', labelKey: 'priorityCritical' },
      ],
    },
    { name: 'spec', control: 'textarea', section: 'basic', labelKey: 'testSpec', surface: 'full' },
  ],
  actions: [],
});

registerKindSettings({ kinds: ['testRun'], marketplace: { sellable: () => false }, fields: [], actions: [] });

registerKindSettings({
  // A specific finding against this codebase, not a reusable artifact.
  kinds: ['defect'],
  marketplace: { sellable: () => false },
  fields: [
    {
      name: 'severity', control: 'select', section: 'basic', labelKey: 'severity', surface: 'full',
      options: [
        { value: 'low', labelKey: 'severityLow' }, { value: 'medium', labelKey: 'severityMedium' },
        { value: 'high', labelKey: 'severityHigh' }, { value: 'critical', labelKey: 'severityCritical' },
      ],
    },
    { name: 'expected', control: 'textarea', section: 'basic', labelKey: 'expected', surface: 'full' },
    { name: 'actual', control: 'textarea', section: 'basic', labelKey: 'actual', surface: 'full' },
  ],
  actions: [],
});
