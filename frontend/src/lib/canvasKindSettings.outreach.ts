/**
 * The six outreach kinds `canvasKindSettingsCompleteness.test.ts` found undeclared.
 * `inbox` and `socialFeed` are live, connection-driven views (populated by the `connect`
 * canvas tool, not typed by hand) and `socialPost` is a read-only pin lifted out of a
 * feed tile, so those three declare no fields — the same "considered, nothing to edit"
 * empty manifest `canvasKindSettings.board.ts` uses for `selection`/`terminal`.
 */

import { registerKindSettings } from './canvasKindSettings';

registerKindSettings({ kinds: ['inbox'], marketplace: { sellable: () => false }, fields: [], actions: [] });
registerKindSettings({ kinds: ['socialFeed'], marketplace: { sellable: () => false }, fields: [], actions: [] });
registerKindSettings({ kinds: ['socialPost'], marketplace: { sellable: () => false }, fields: [], actions: [] });

registerKindSettings({
  kinds: ['emailCampaign'],
  marketplace: { sellable: () => false },
  fields: [{ name: 'subject', control: 'text', section: 'basic', labelKey: 'subject', surface: 'full' }],
  actions: [],
});

registerKindSettings({
  // A reusable template, unlike the campaign instance above.
  kinds: ['emailTemplate'],
  marketplace: { sellable: () => true },
  fields: [
    { name: 'subject', control: 'text', section: 'basic', labelKey: 'subject', surface: 'full' },
    { name: 'bodyHtml', control: 'textarea', section: 'basic', labelKey: 'campaignBody', surface: 'full' },
  ],
  actions: [],
});

registerKindSettings({
  kinds: ['socialCampaign'],
  marketplace: { sellable: () => false },
  fields: [
    { name: 'body', control: 'textarea', section: 'basic', labelKey: 'campaignBody', surface: 'full' },
    { name: 'linkUrl', control: 'text', section: 'basic', labelKey: 'linkUrl', surface: 'full' },
  ],
  actions: [],
});
