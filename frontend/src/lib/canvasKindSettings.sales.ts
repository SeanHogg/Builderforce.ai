/**
 * The six sales kinds `canvasKindSettingsCompleteness.test.ts` found undeclared. Every
 * one is a specific instance of a tenant's own pipeline (a contact, a campaign, a goal)
 * rather than a reusable template, so none of them is marketplace-sellable — the same
 * reasoning `standup`/`projectComparison` already establish for live, tenant-bound state.
 */

import { registerKindSettings } from './canvasKindSettings';

registerKindSettings({
  kinds: ['salesPipeline'],
  marketplace: { sellable: () => false },
  fields: [{ name: 'stages', control: 'chips', section: 'basic', labelKey: 'stages', surface: 'full' }],
  actions: [],
});

registerKindSettings({
  kinds: ['salesContact'],
  marketplace: { sellable: () => false },
  fields: [
    { name: 'email', control: 'text', section: 'basic', labelKey: 'emailAddress', surface: 'full' },
    { name: 'company', control: 'text', section: 'basic', labelKey: 'company', surface: 'full' },
  ],
  actions: [],
});

registerKindSettings({
  kinds: ['salesCampaign'],
  marketplace: { sellable: () => false },
  fields: [
    { name: 'subject', control: 'text', section: 'basic', labelKey: 'subject', surface: 'full' },
    { name: 'market', control: 'text', section: 'basic', labelKey: 'market', surface: 'full' },
  ],
  actions: [],
});

registerKindSettings({
  // Researched market insight, not a live pipeline row — reusable the way `targetMarket`'s
  // sibling `project` lens is.
  kinds: ['targetMarket'],
  marketplace: { sellable: () => true },
  fields: [
    { name: 'market', control: 'text', section: 'basic', labelKey: 'market', surface: 'full' },
    { name: 'channels', control: 'chips', section: 'basic', labelKey: 'channels', surface: 'full' },
  ],
  actions: [],
});

registerKindSettings({
  kinds: ['salesGoal'],
  marketplace: { sellable: () => false },
  fields: [
    { name: 'outreachTarget', control: 'number', section: 'basic', labelKey: 'outreachTarget', surface: 'full' },
    { name: 'contactsTarget', control: 'number', section: 'basic', labelKey: 'contactsTarget', surface: 'full' },
    { name: 'meetingsTarget', control: 'number', section: 'basic', labelKey: 'meetingsTarget', surface: 'full' },
  ],
  actions: [],
});

registerKindSettings({
  kinds: ['salesMeeting'],
  marketplace: { sellable: () => false },
  fields: [
    { name: 'durationMinutes', control: 'number', section: 'basic', labelKey: 'duration', surface: 'full' },
    { name: 'meetingUrl', control: 'text', section: 'basic', labelKey: 'meetingUrl', surface: 'full' },
  ],
  actions: [],
});
