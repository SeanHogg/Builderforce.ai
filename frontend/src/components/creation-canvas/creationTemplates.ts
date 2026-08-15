import type { CreationNodeData, CreationObjectKind } from './types';
import { buildLlmCourse, COURSE_EXPORT_STANDARDS } from '@/lib/courseLms';
import { salesHubTemplate } from '@/lib/sales/salesHubCanvas';

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
    // The SAME board a sales associate is provisioned with — `salesHubTemplate()`
    // projects it from `buildSalesHubGraph`, so the pack a builder places and the
    // canvas an associate lands on cannot describe selling this product two
    // different ways. It replaced `sales-command-center`, which was six empty
    // cards with placeholder titles: a blank page with furniture on it.
    // The projection returns `kind: string` because the graph builder is in
    // `lib/` and must not depend on this module's presentation union. The
    // narrowing is asserted HERE, in the layer that owns the union, and
    // `creationObjectRegistry.test.ts` proves every kind in every template
    // resolves — so the assertion is checked rather than trusted.
    ...(salesHubTemplate() as unknown as CreationTemplate),
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
    id: 'social-growth-campaign', name: 'Social growth command center', category: 'Marketplace template',
    description: 'Analyze cross-platform trends, turn the evidence into a campaign, and schedule publishing across social and owned media.',
    objects: [
      {
        kind: 'workflow', title: 'Cross-platform social listening', x: 0, y: 0,
        data: { status: 'Connect social accounts', approvalMode: 'required', steps: [
          { title: 'Search recent X conversation', connector: 'x-social', action: 'search_recent', input: { query: '{{campaign.topic}} -is:retweet', max_results: 100, 'tweet.fields': 'created_at,public_metrics,lang,author_id' } },
          { title: 'Find Instagram hashtag', connector: 'instagram-business', action: 'search_hashtag', input: { q: '{{campaign.hashtag}}', user_id: '{{connections.instagram.userId}}' } },
          { title: 'Read Instagram top media', connector: 'instagram-business', action: 'hashtag_top_media', input: { hashtag_id: '{{steps.s2.data.0.id}}', user_id: '{{connections.instagram.userId}}', fields: 'id,caption,media_type,permalink,like_count,comments_count' } },
          { title: 'Read TikTok creator performance', connector: 'tiktok-social', action: 'list_videos', input: { fields: 'id,title,create_time,share_url,view_count,like_count,comment_count,share_count', max_count: 20 } },
          { title: 'Synthesize cross-platform trends', prompt: 'Compare themes, velocity, engagement and audience signals across the connector results. Return ranked trends plus chartLabels, chartValues, sources and a concise recommendation.' },
        ] },
      },
      { kind: 'chart', title: 'Top social trends', x: 560, y: 0, data: { status: 'Run listening workflow', chartTitle: 'Cross-platform trend momentum', xAxisLabel: 'Trend', yAxisLabel: 'Momentum score', chartLabels: ['Trend 1', 'Trend 2', 'Trend 3'], chartValues: [0, 0, 0], sources: [] } },
      { kind: 'dashboard', title: 'Social performance summary', x: 1120, y: 0, data: { status: 'Awaiting connected data', dateRange: 'Last 7 days', kpis: [{ label: 'Reach', value: '—', trend: '—' }, { label: 'Engagement', value: '—', trend: '—' }, { label: 'Adoption', value: '—', trend: '—' }] } },
      { kind: 'document', title: 'Adoption campaign brief', x: 0, y: 430, data: { status: 'CMO draft', markdown: '# Adoption campaign\n\n## Evidence\nConnect and run the social listening workflow.\n\n## Audience and message\n\n## Channel plan\n\n## Adoption goal and measurement\n' } },
      {
        kind: 'workflow', title: 'Scheduled social publishing', x: 560, y: 430,
        data: { status: 'Review before activation', approvalMode: 'required', steps: [
          { title: 'Weekday campaign cadence', kind: 'trigger', triggerType: 'schedule', cron: '0 9 * * 1-5', timezone: 'America/New_York' },
          { title: 'Write channel variants', prompt: 'Use the connected adoption campaign brief and latest trend evidence to write platform-native variants. Preserve the campaign claim, CTA and tracking URL; do not invent evidence.' },
          { title: 'Publish on X', connector: 'x-social', action: 'create_post', input: { text: '{{steps.s2.x}}' } },
          { title: 'Publish on LinkedIn', connector: 'linkedin-social', action: 'create_post', input: { author: '{{campaign.linkedinAuthor}}', commentary: '{{steps.s2.linkedin}}', visibility: 'PUBLIC', lifecycleState: 'PUBLISHED' } },
          { title: 'Publish on Facebook', connector: 'facebook-pages', action: 'create_post', input: { page_id: '{{campaign.facebookPageId}}', message: '{{steps.s2.facebook}}', link: '{{campaign.url}}' } },
          { title: 'Publish to website', connector: 'website-publisher', action: 'publish_content', input: { content: { campaignId: '{{campaign.id}}', title: '{{steps.s2.website.title}}', body: '{{steps.s2.website.body}}', status: 'published' }, idempotency_key: '{{run.id}}-website' } },
        ] },
      },
      { kind: 'website', title: 'Campaign landing page', x: 1120, y: 430, data: { status: 'Draft', websiteHeadline: 'Turn attention into adoption', websiteBody: 'Shape the landing page around the campaign evidence and one measurable adoption action.', websiteCta: 'Get started' } },
      { kind: 'agent', title: 'CMO', x: 560, y: 800, data: { role: 'CMO', focus: 'Cross-platform trends, campaign strategy, adoption and measured iteration', status: 'Ready' } },
    ],
    connections: [
      { source: 0, target: 1, label: 'trend evidence' }, { source: 1, target: 2, label: 'summarizes' },
      { source: 1, target: 3, label: 'grounds' }, { source: 3, target: 4, label: 'drives' },
      { source: 4, target: 5, label: 'publishes' }, { source: 6, target: 3, label: 'owns' },
    ],
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
  {
    id: 'assessment-cycle', name: 'Assessment cycle', category: 'Marketplace template',
    description: 'Run a piece of assessment end to end: a cohort, a brief, the rubric it is marked against, one submission per learner, and the gradebook that aggregates them.',
    objects: [
      {
        kind: 'cohort', title: 'PHYS2041 · Semester 2', x: 0, y: 0,
        data: {
          status: 'Import a roster', courseCode: 'PHYS2041', term: '2026 Semester 2', deliveryMode: 'hybrid',
          instructors: ['Module lead', 'Tutor'],
          summary: 'Import the roster from a CSV or a connected LMS — every submission and mark joins on the learner ref it carries.',
        },
      },
      {
        kind: 'assignment', title: 'Assignment 1 · Literature critique', x: 520, y: 0,
        data: {
          status: 'Draft brief', weight: 30, maxMarks: 100, attemptsAllowed: 1,
          // `open` is the default everywhere and is wrong for anything summative; the
          // template ships the deliberate choice rather than the inherited one.
          assessmentMode: 'closed',
          latePolicy: '5% per day, zero after 5 days',
          brief: 'Critique one paper from the reading list: state its claim, assess whether the evidence supports it, and identify the strongest objection.',
          deliverables: [{ title: 'Critique', detail: '1,500 words, PDF' }, { title: 'Reference list', detail: 'APA, on the board' }],
        },
      },
      {
        kind: 'rubric', title: 'Critique rubric', x: 1040, y: 0,
        data: {
          status: 'Add descriptors', totalMarks: 100,
          levels: ['Fail', 'Pass', 'Credit', 'Distinction'],
          moderationRule: 'Double-blind mark every fail and every distinction; a gap over 10 marks goes to a third marker.',
          criteria: {
            columns: ['Fail', 'Pass', 'Credit', 'Distinction'],
            rows: [
              { label: 'Claim identified', weight: 2, cells: ['No claim stated', 'Claim stated', 'Claim stated precisely', 'Claim stated and situated in the literature'] },
              { label: 'Evidence assessed', weight: 3, cells: ['Assertion only', 'Some evidence cited', 'Evidence weighed', 'Evidence weighed against alternatives'] },
              { label: 'Objection', weight: 3, cells: ['None', 'An objection', 'The strongest objection', 'The strongest objection, answered'] },
              { label: 'Referencing', weight: 2, cells: ['Absent', 'Present, inconsistent', 'Consistent', 'Consistent and complete'] },
            ],
          },
        },
      },
      {
        kind: 'submission', title: 'Submission · one per learner', x: 520, y: 400,
        data: {
          status: 'Not submitted',
          artifacts: [{ title: 'Distribute to the cohort', detail: 'Creates one of these per enrolled learner, each with its own owner and authorship record.' }],
        },
      },
      {
        kind: 'gradebook', title: 'PHYS2041 gradebook', x: 1040, y: 400,
        data: {
          status: 'No marks yet',
          gradeBands: [
            { grade: 'F', minimum: 0, maximum: 49 }, { grade: 'P', minimum: 50, maximum: 64 },
            { grade: 'C', minimum: 65, maximum: 74 }, { grade: 'D', minimum: 75, maximum: 100 },
          ],
        },
      },
      {
        kind: 'accommodation', title: 'Approved adjustments', x: 0, y: 400,
        data: {
          status: 'Not approved', extraTimePercent: 25,
          provisions: ['25% extra time', 'Captioned recordings'], formats: ['captioned video', 'tagged PDF'],
          evidenceHeld: 'not-required',
        },
      },
    ],
    connections: [
      { source: 0, target: 1, label: 'is set for' }, { source: 1, target: 2, label: 'is marked against' },
      { source: 1, target: 3, label: 'is answered by' }, { source: 3, target: 4, label: 'aggregates into' },
      { source: 5, target: 1, label: 'adjusts' },
    ],
  },
  {
    /**
     * The board a service business runs its week from.
     *
     * Deliberately ONE pack rather than one per industry, for the reason `operations.ts`
     * argues: the seeded values name a heating engineer's day because a template has to
     * be concrete to be useful, and every kind on it is the same kind a property manager,
     * a clinic or a workshop uses with a different `discipline`. A "field service" pack
     * beside a "property" pack and a "fleet" pack would be three copies of this board.
     */
    id: 'field-operations', name: 'Field operations', category: 'Marketplace template',
    description: 'Run the work you sell: the assets you look after, the jobs against them, the day they are dispatched on, the parts they consume, and the certificate that makes them lawful.',
    objects: [
      {
        kind: 'serviceAsset', title: 'Boiler · Riverside House', x: 0, y: 0,
        data: {
          status: 'In service', discipline: 'fieldService', assetClass: 'Commercial gas boiler',
          criticality: 'critical', site: 'Riverside House, plant room (key with concierge)',
          summary: 'Every job, cost and certificate joins to this asset — which is what makes repair-or-replace answerable rather than argued.',
        },
      },
      {
        kind: 'workOrder', title: 'No heating · Riverside House', x: 520, y: 0,
        data: {
          status: 'Unscheduled', orderType: 'reactive', priority: 'urgent', discipline: 'fieldService',
          reportedFault: 'Tenants report no heating on floors 3–5 since this morning. Pressure gauge reading low.',
          tasks: [{ title: 'Diagnose pressure loss', detail: 'Check expansion vessel, PRV and system pressure before condemning anything.' }],
        },
      },
      {
        kind: 'visit', title: 'First attendance', x: 1040, y: 0,
        data: { status: 'Not scheduled', arrivalWindow: '08:00–12:00', durationMinutes: 90, travelMinutes: 35 },
      },
      {
        kind: 'dispatchBoard', title: 'Today · North patch', x: 0, y: 380,
        data: {
          status: 'Planning the day', discipline: 'fieldService', area: 'North',
          constraints: ['Gas Safe registration for any boiler job', 'Two-person lift over 25kg', 'Congestion charge zone before 18:00'],
        },
      },
      {
        kind: 'estimate', title: 'Quote · pressure fault remedial', x: 520, y: 380,
        data: {
          status: 'Draft',
          exclusions: ['Making good', 'Out-of-hours attendance', 'Asbestos survey'],
          summary: 'Price what you will actually do. The lines total themselves — the card cannot show a figure that disagrees with them.',
        },
      },
      {
        kind: 'serviceAgreement', title: 'Riverside · annual cover', x: 1040, y: 380,
        data: {
          status: 'Draft', cadence: 'quarterly', billingCycle: 'annual', responseHours: 4, resolutionHours: 24,
          summary: 'Planned work is generated from the cadence here rather than remembered into existence.',
        },
      },
      {
        kind: 'inspection', title: 'Annual gas safety check', x: 0, y: 760,
        data: {
          status: 'Not started', inspectionType: 'statutory certificate', standard: 'Gas Safety (Installation and Use) Regulations 1998',
          summary: 'A failed statutory inspection usually means the asset stops being used today — the outcome has to be legible on the card.',
        },
      },
      {
        kind: 'certification', title: 'Engineer · Gas Safe registration', x: 520, y: 760,
        data: {
          status: 'Unverified', credentialType: 'trade registration', issuer: 'Gas Safe Register',
          summary: 'An expired certificate does not announce itself. The validity here is computed from the expiry, never asserted.',
        },
      },
      {
        kind: 'inventoryItem', title: 'Expansion vessel · 24L', x: 1040, y: 760,
        data: { status: 'Not counted', location: 'Van 4', leadTimeDays: 3, summary: 'Van stock and store stock are different balances; merging them is how a job leaves without its part.' },
      },
      { kind: 'supplier', title: 'Trade counter · heating parts', x: 0, y: 1140, data: { status: 'Prospective', leadTimeDays: 3 } },
      { kind: 'purchaseOrder', title: 'Replenishment order', x: 520, y: 1140, data: { status: 'Draft' } },
      { kind: 'shipment', title: 'Inbound delivery', x: 1040, y: 1140, data: { status: 'Not dispatched', destination: 'Store' } },
      {
        kind: 'incident', title: 'Near miss · plant room access', x: 520, y: 1520,
        data: {
          status: 'Reported', incidentType: 'near-miss', severity: 'major',
          summary: 'Recorded for the same reason an injury is: the same event with a luckier ending. Restricted by default — it names a person.',
        },
      },
    ],
    connections: [
      { source: 1, target: 0, label: 'is work on' }, { source: 1, target: 2, label: 'is attended by' },
      { source: 3, target: 2, label: 'dispatches' }, { source: 4, target: 1, label: 'prices' },
      { source: 5, target: 0, label: 'covers' }, { source: 6, target: 0, label: 'certifies' },
      { source: 7, target: 2, label: 'permits' }, { source: 8, target: 1, label: 'is consumed by' },
      { source: 9, target: 10, label: 'supplies' }, { source: 10, target: 11, label: 'ships as' },
      { source: 11, target: 8, label: 'replenishes' }, { source: 12, target: 2, label: 'occurred during' },
    ],
  },
  {
    id: 'research-programme', name: 'Research programme', category: 'Marketplace template',
    description: 'The scholarly lifecycle in the order it is actually gated: funding, ethics, pre-registration, method, consent, participants, data plan, manuscript and peer review.',
    objects: [
      { kind: 'grantProposal', title: 'Funding application', x: 0, y: 0, data: { status: 'Draft proposal', aims: [{ title: 'Aim 1', detail: 'State a claim that can fail.' }] } },
      { kind: 'literatureReview', title: 'Evidence base', x: 520, y: 0, data: { status: 'Not searched', databases: ['Scopus', 'PubMed'] } },
      { kind: 'hypothesis', title: 'Primary hypothesis', x: 1040, y: 0, data: { status: 'Untested', statement: 'State it directionally, so that it can be refuted.' } },
      { kind: 'ethicsApproval', title: 'Ethics submission', x: 0, y: 380, data: { status: 'Not submitted' } },
      { kind: 'preRegistration', title: 'Pre-registration', x: 520, y: 380, data: { status: 'Draft plan', timepoint: 'before-data-collection' } },
      { kind: 'protocol', title: 'Method', x: 1040, y: 380, data: { status: 'Draft method', version: '0.1' } },
      { kind: 'consentForm', title: 'Participant consent', x: 0, y: 760, data: { status: 'Draft form', language: 'en', readingLevel: 'Grade 8' } },
      { kind: 'participantPool', title: 'Recruitment', x: 520, y: 760, data: { status: 'Not recruiting' } },
      { kind: 'dataManagementPlan', title: 'Data management plan', x: 1040, y: 760, data: { status: 'Draft plan', retentionYears: 10 } },
      { kind: 'manuscript', title: 'Manuscript', x: 520, y: 1140, data: { status: 'Draft', citationStyle: 'apa' } },
      { kind: 'bibliography', title: 'References', x: 1040, y: 1140, data: { status: 'No entries', citationStyle: 'apa', sortOrder: 'author' } },
      { kind: 'peerReview', title: 'Reviews received', x: 0, y: 1140, data: { status: 'Not reviewed' } },
    ],
    connections: [
      { source: 1, target: 2, label: 'grounds' }, { source: 2, target: 5, label: 'specifies' },
      { source: 5, target: 3, label: 'is approved by' }, { source: 5, target: 4, label: 'is registered as' },
      { source: 3, target: 6, label: 'requires' }, { source: 6, target: 7, label: 'consents' },
      { source: 7, target: 8, label: 'governs' }, { source: 8, target: 9, label: 'evidences' },
      { source: 10, target: 9, label: 'cites' }, { source: 9, target: 11, label: 'is reviewed by' },
      { source: 0, target: 5, label: 'funds' },
    ],
  },
] as const;
