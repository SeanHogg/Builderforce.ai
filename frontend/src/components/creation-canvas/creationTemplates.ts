import type { CreationNodeData, CreationObjectKind } from './types';
import { buildLlmCourse, COURSE_EXPORT_STANDARDS } from '@/lib/courseLms';

export interface CreationTemplate {
  id: string;
  /** English source text for the pack's name and blurb. The menu renders
   * `creationCanvas.template.<id>.name` / `.description` from the message
   * catalogs and falls back to these, so a pack is never nameless while a
   * translation is being added — but a shipped pack IS translated. */
  name: string;
  description: string;
  category: 'Marketplace template' | 'Object pack';
  objects: Array<{ kind: CreationObjectKind; title?: string; x: number; y: number; data?: Partial<CreationNodeData> }>;
  connections?: Array<{ source: number; target: number; label: string }>;
}

/**
 * Capability-safe packs shipped through the same catalog surfaced by Marketplace.
 * They contain only registry kinds, so tenant policy still controls every live
 * resource a user attaches after placing the pack.
 */
export const CREATION_TEMPLATES: readonly CreationTemplate[] = [
  {
    id: 'llm-builder-academy', name: 'LLM Builder Academy', category: 'Marketplace template',
    description: 'Learn the full LLM lifecycle through lessons, practice, assessments, and a portable SCORM package.',
    objects: [
      { kind: 'course', title: 'Build an LLM', x: 0, y: 0, data: { course: buildLlmCourse(), exportStandards: COURSE_EXPORT_STANDARDS } },
      { kind: 'dataset', title: 'Training corpus lab', x: 560, y: 0, data: { status: 'Practice workspace', subtitle: 'Inspect provenance, quality, deduplication, and splits.' } },
      { kind: 'code', title: 'Tokenizer & training notebook', x: 560, y: 330, data: { status: 'Practice workspace', language: 'python', code: '# Add tokenizer and training experiments here\n' } },
      { kind: 'evaluation', title: 'LLM release scorecard', x: 0, y: 520, data: { status: 'Knowledge checks', criteria: ['Capability', 'Safety', 'Robustness', 'Latency', 'Cost'] } },
      { kind: 'llm', title: 'Model blueprint', x: 1120, y: 160, data: { status: 'Capstone', model: 'decoder-only transformer', instructions: 'Document architecture, training budget, evaluation evidence, and release controls.' } },
    ],
    connections: [
      { source: 0, target: 1, label: 'practice' }, { source: 0, target: 2, label: 'practice' },
      { source: 1, target: 4, label: 'trains' }, { source: 2, target: 4, label: 'implements' }, { source: 4, target: 3, label: 'evaluates' },
    ],
  },
  {
    id: 'sales-command-center', name: 'Sales command center', category: 'Marketplace template',
    description: 'Run targeting, outreach, pipeline management, goals, and coaching from one collaborative canvas.',
    objects: [
      { kind: 'salesPipeline', title: 'Live sales pipeline', x: 0, y: 0 },
      { kind: 'targetMarket', title: 'Target market', x: 440, y: 0 },
      { kind: 'salesCampaign', title: 'Campaign workspace', x: 880, y: 0 },
      { kind: 'salesGoal', title: 'Weekly activity goals', x: 0, y: 320 },
      { kind: 'salesMeeting', title: 'Meetings & coaching', x: 440, y: 320 },
      { kind: 'agent', title: 'Sales coach', x: 880, y: 320 },
    ],
    connections: [{ source: 1, target: 2, label: 'targets' }, { source: 2, target: 0, label: 'creates leads' }, { source: 0, target: 3, label: 'measures' }, { source: 3, target: 5, label: 'coaches' }],
  },
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
  {
    id: 'creative-studio', name: 'Creative studio', category: 'Marketplace template',
    description: 'Compose video, images, animation, podcasts, and comics through Builderforce native creative capabilities.',
    objects: [
      { kind: 'template', title: 'Template library', x: 0, y: 0 },
      { kind: 'video', title: 'Video generator', x: 430, y: 0 },
      { kind: 'image', title: 'Image generator', x: 860, y: 0 },
      { kind: 'animation', title: 'Animation generator', x: 0, y: 310 },
      { kind: 'podcast', title: 'Podcast generator', x: 430, y: 310 },
      { kind: 'comic', title: 'Comic generator', x: 860, y: 310 },
    ],
    connections: [{ source: 0, target: 1, label: 'templates' }, { source: 0, target: 2, label: 'templates' }, { source: 0, target: 3, label: 'templates' }, { source: 0, target: 4, label: 'templates' }, { source: 0, target: 5, label: 'templates' }],
  },
  {
    id: 'career-documents', name: 'Resume & presentation studio', category: 'Marketplace template',
    description: 'Build a resume, supporting files, a paged document, and a presentation from one source brief.',
    objects: [
      { kind: 'resume', title: 'Resume builder', x: 0, y: 0 },
      { kind: 'document', title: 'Supporting document', x: 430, y: 0 },
      { kind: 'slides', title: 'Presentation', x: 900, y: 0 },
      { kind: 'file', title: 'Exported files', x: 430, y: 330 },
    ],
    connections: [{ source: 0, target: 1, label: 'supports' }, { source: 0, target: 2, label: 'presents' }, { source: 1, target: 3, label: 'exports' }, { source: 2, target: 3, label: 'exports' }],
  },
  {
    id: 'pitch-competition', name: 'Pitch competition war room', category: 'Marketplace template',
    description: 'Enter a pitch competition and win it: the written entry, the timed pitch, the judging scorecard, the judge Q&A drill, and the deck — scored against the competition’s own rules.',
    objects: [
      { kind: 'pitchApplication', title: 'Competition entry', x: 0, y: 0 },
      { kind: 'pitch', title: 'Three-minute pitch', x: 520, y: 0 },
      { kind: 'pitchScorecard', title: 'Judging scorecard', x: 1040, y: 0 },
      { kind: 'pitchQa', title: 'Judge Q&A drill', x: 0, y: 380 },
      { kind: 'slides', title: 'Pitch deck', x: 520, y: 380 },
      { kind: 'agent', title: 'Pitch coach', x: 1040, y: 380 },
    ],
    connections: [
      { source: 0, target: 1, label: 'qualifies' },
      { source: 1, target: 2, label: 'is scored by' },
      { source: 1, target: 4, label: 'presents' },
      { source: 2, target: 3, label: 'anticipates' },
      { source: 5, target: 2, label: 'coaches' },
    ],
  },
  {
    id: 'interactive-3d', name: 'Games & 3D studio', category: 'Marketplace template',
    description: 'Design playable games, CAD drawings, and 3D models with MCP-backed project persistence.',
    objects: [
      { kind: 'game', title: 'Game builder', x: 0, y: 0 },
      { kind: 'cad', title: 'CAD drawing', x: 430, y: 0 },
      { kind: 'model3d', title: '3D model', x: 860, y: 0 },
      { kind: 'evaluation', title: 'Playable output review', x: 430, y: 330 },
    ],
    connections: [{ source: 1, target: 2, label: 'models' }, { source: 0, target: 3, label: 'evaluates' }, { source: 2, target: 3, label: 'evaluates' }],
  },
] as const;
