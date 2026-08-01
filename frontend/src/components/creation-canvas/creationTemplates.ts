import type { CreationObjectKind } from './types';

export interface CreationTemplate {
  id: string;
  name: string;
  description: string;
  category: 'Marketplace template' | 'Object pack';
  objects: Array<{ kind: CreationObjectKind; title?: string; x: number; y: number }>;
  connections?: Array<{ source: number; target: number; label: string }>;
}

/**
 * Capability-safe packs shipped through the same catalog surfaced by Marketplace.
 * They contain only registry kinds, so tenant policy still controls every live
 * resource a user attaches after placing the pack.
 */
export const CREATION_TEMPLATES: readonly CreationTemplate[] = [
  {
    id: 'campaign', name: 'Campaign studio', category: 'Marketplace template',
    description: 'Plan a campaign, prototype its landing page, and evaluate forecast evidence.',
    objects: [
      { kind: 'workflow', title: 'Campaign workflow', x: 0, y: 0 },
      { kind: 'website', title: 'Campaign landing page', x: 520, y: 0 },
      { kind: 'dashboard', title: 'Campaign forecast', x: 1040, y: 0 },
      { kind: 'agent', title: 'Campaign strategist', x: 520, y: 330 },
    ], connections: [{ source: 0, target: 1, label: 'publishes' }, { source: 1, target: 2, label: 'measures' }],
  },
  {
    id: 'product-discovery', name: 'Product discovery', category: 'Marketplace template',
    description: 'Synthesize customer evidence, prioritize features, and expand concepts into mockups.',
    objects: [
      { kind: 'dataset', title: 'Customer feedback', x: 0, y: 0 },
      { kind: 'featureSummary', title: 'Top requested features', x: 420, y: 0 },
      { kind: 'mockupSet', title: 'Feature concept set', x: 940, y: 0 },
      { kind: 'evaluation', title: 'Opportunity evaluation', x: 320, y: 300 },
    ], connections: [{ source: 0, target: 1, label: 'evidence' }, { source: 1, target: 2, label: 'expands' }],
  },
  {
    id: 'data-story', name: 'Data story', category: 'Marketplace template',
    description: 'Import a dataset, build live visuals, and assemble an executive narrative.',
    objects: [
      { kind: 'dataset', title: 'Source dataset', x: 0, y: 0 },
      { kind: 'chart', title: 'Key trend', x: 420, y: 0 },
      { kind: 'dashboard', title: 'Decision dashboard', x: 900, y: 0 },
      { kind: 'slides', title: 'Executive data story', x: 420, y: 320 },
    ], connections: [{ source: 0, target: 1, label: 'data' }, { source: 1, target: 2, label: 'presents' }, { source: 2, target: 3, label: 'supports' }],
  },
  {
    id: 'stand-up', name: 'Impromptu stand-up', category: 'Object pack',
    description: 'Gather humans and agents, surface blockers, and create follow-up work.',
    objects: [
      { kind: 'standup', title: 'Team stand-up', x: 0, y: 0 },
      { kind: 'staff', title: 'Team member', x: 500, y: 0 },
      { kind: 'agent', title: 'Delivery agent', x: 500, y: 240 },
      { kind: 'task', title: 'Follow-up action', x: 0, y: 330 },
    ],
  },
  {
    id: 'model-build', name: 'Evermind model lab', category: 'Marketplace template',
    description: 'Prepare data, teach and tune Evermind, evaluate it, and package the result.',
    objects: [
      { kind: 'dataset', title: 'Training corpus', x: 0, y: 0 },
      { kind: 'evermind', title: 'Evermind model', x: 430, y: 0 },
      { kind: 'evaluation', title: 'Model evaluation', x: 950, y: 0 },
      { kind: 'agent', title: 'Published model agent', x: 520, y: 330 },
    ], connections: [{ source: 0, target: 1, label: 'trains' }, { source: 1, target: 2, label: 'evaluates' }, { source: 1, target: 3, label: 'packages' }],
  },
  {
    id: 'executive-review', name: 'Executive review', category: 'Object pack',
    description: 'Bring project health, priorities, roadmap, and presentation into one decision frame.',
    objects: [
      { kind: 'project', title: 'Project context', x: 0, y: 0 },
      { kind: 'dashboard', title: 'Portfolio health', x: 420, y: 0 },
      { kind: 'roadmap', title: 'Executive roadmap', x: 900, y: 0 },
      { kind: 'slides', title: 'Leadership presentation', x: 420, y: 330 },
    ], connections: [{ source: 0, target: 1, label: 'measures' }, { source: 0, target: 2, label: 'grounds' }, { source: 2, target: 3, label: 'presents' }],
  },
] as const;
