/**
 * THE prescriptive sales canvas — what a new associate's board IS.
 *
 * ── WHY IT IS PRESCRIPTIVE ───────────────────────────────────────────────────
 * The old seed was six objects with placeholder titles, and it handed somebody
 * who had just signed up to sell a product an empty pipeline and a blank campaign
 * card. That is a blank page with furniture. A person who has never sold this
 * product does not need a workspace, they need a MOTION — the stages in order,
 * the numbers that say whether the motion is working, the collateral to send, and
 * somebody to ask. So the board opens with all four already on it:
 *
 *   1. THE KANBAN — the pipeline as a real board, columns × swimlanes, seeded
 *      with the plays that actually convert this product rather than with lorem.
 *      Swimlanes are the segment (who you are selling to), because the same stage
 *      means different work for a founder and for an enterprise buyer.
 *   2. THE READ-OUT — a dashboard of the metrics the hub reports on, so the
 *      board and the Sales Hub answer with the same vocabulary.
 *   3. THE COLLATERAL — the deck and the media kit, as objects, so "send them
 *      something" is one drag rather than a hunt through a marketing page.
 *   4. THE COACH — the CRO, as an agent on the board with the seat and domain
 *      set, so it is the platform's own revenue seat and not a generic assistant.
 *
 * ── WHY IT LIVES HERE ────────────────────────────────────────────────────────
 * It was inline in `SalesCanvasLauncher`, which meant the one description of what
 * a sales board is could only be read by the component that redirects. Extracted
 * so the launcher seeds it, `CREATION_TEMPLATES` offers it as a pack, and a test
 * can assert its shape without mounting a page.
 */

import type { CreationGraphInput } from '@/lib/builderforceApi';
import { MEDIA_KIT } from '@/lib/content';

/** Pipeline stages, in order. The SAME seven the server validates (`salesRoutes`
 *  STAGES) — a board that offered an eighth would produce contacts the API
 *  rejects. */
export const SALES_PIPELINE_STAGES = ['new', 'contacted', 'qualified', 'meeting', 'proposal', 'won', 'lost'] as const;

/**
 * The swimlanes: WHO you are selling to.
 *
 * Segment rather than, say, owner — an associate's board has one owner, so lanes
 * by owner would be one lane. Segment is the axis along which the same stage
 * means genuinely different work, which is the only thing a swimlane earns its
 * horizontal space by showing.
 */
export const SALES_SWIMLANES = [
  { id: 'founder', title: 'Founders & solo builders', hint: 'Fast cycle, self-serve, buys on the demo.' },
  { id: 'agency', title: 'Agencies & consultancies', hint: 'Sells it on to their own clients — lead with margin.' },
  { id: 'smb', title: 'SMB teams', hint: 'Team plan, a champion plus a budget holder.' },
  { id: 'enterprise', title: 'Enterprise', hint: 'Security review, procurement, a pilot before a contract.' },
] as const;

/** The plays a new associate starts with — one per lane, at the stage the motion
 *  actually begins at, so the board opens with work on it rather than with an
 *  invitation to imagine some. */
const SEED_CARDS = [
  { lane: 'founder', stage: 'new', title: 'Post the referral link where builders already are', note: 'Indie Hackers, r/SaaS, your own network. Lead with the canvas, not the feature list.' },
  { lane: 'founder', stage: 'contacted', title: 'Send the deck + a 20-minute canvas walkthrough', note: 'The deck is on this board — attach it, do not link to a login wall.' },
  { lane: 'agency', stage: 'new', title: 'List 10 agencies who resell tooling', note: 'The pitch is margin: they bill their clients for what this builds.' },
  { lane: 'agency', stage: 'qualified', title: 'Offer a co-branded pilot for one client project', note: 'One project, one month, their logo on the canvas.' },
  { lane: 'smb', stage: 'contacted', title: 'Find the champion before the budget holder', note: 'A team plan closes when somebody inside wants it, not when you email the CFO.' },
  { lane: 'smb', stage: 'meeting', title: 'Run the pipeline review on their own data', note: 'Import one of their projects live. It is the whole demo.' },
  { lane: 'enterprise', stage: 'new', title: 'Identify the security reviewer early', note: 'SOC 2 evidence exists — send it before they ask, not after they stall.' },
  { lane: 'enterprise', stage: 'proposal', title: 'Scope a paid pilot with a named success metric', note: 'Enterprise does not buy a licence, it buys a proven outcome.' },
] as const;

/** The CRO's brief. Written as instructions rather than as a title, because a
 *  coach with no brief is a card that says "Agent". */
const CRO_INSTRUCTIONS = [
  'You are the CRO coaching a Builderforce sales associate.',
  'Read their live pipeline on this canvas before answering anything.',
  'Every week: name the ONE stage where deals are dying, say why, and give the next action for the two highest-value stalled cards.',
  'Hold them to the weekly activity goals on this board — outreach, new contacts, meetings booked.',
  'Never invent pipeline. If a number is not on this board, say it is missing and ask for it.',
].join(' ');

interface SpecObject {
  kind: string;
  title: string;
  status: string;
  x: number;
  y: number;
  extra?: Record<string, unknown>;
}

/**
 * Build the graph.
 *
 * `referralCode` / `salesCode` are threaded in so the board carries the links the
 * associate actually shares. They are the associate's own codes; if they have not
 * been minted yet the fields are null and the goal card simply has no link on it,
 * which is honest — an empty string there would render a broken URL.
 */
export function buildSalesHubGraph(input: {
  ownerUserId: string;
  referralCode: string | null;
  salesCode: string | null;
  origin?: string;
}): CreationGraphInput {
  const origin = input.origin ?? 'https://builderforce.ai';
  const link = (code: string | null) => (code ? `${origin}/register?ref=${code}` : null);

  const specs: SpecObject[] = [
    {
      kind: 'salesPipeline', title: 'Sales pipeline', status: 'Live', x: 0, y: 0,
      extra: {
        stages: [...SALES_PIPELINE_STAGES],
        swimlanes: SALES_SWIMLANES.map((lane) => ({ id: lane.id, title: lane.title, hint: lane.hint })),
        cards: SEED_CARDS.map((card) => ({ ...card })),
        ownerUserId: input.ownerUserId,
      },
    },
    {
      kind: 'dashboard', title: 'Pipeline read-out', status: 'Live', x: 1120, y: 0,
      extra: {
        // The SAME four numbers the Sales Hub's report headlines, so the board and
        // the hub cannot describe the week differently.
        widgets: [
          { id: 'signups', chart: 'kpi', title: 'Signups this month', span: 'half', value: '0', trend: '' },
          { id: 'conversions', chart: 'kpi', title: 'Conversions this month', span: 'half', value: '0', trend: '' },
          { id: 'funnel', chart: 'funnel', title: 'Pipeline by stage', span: 'half', labels: ['New', 'Contacted', 'Qualified', 'Meeting', 'Proposal', 'Won'], series: [{ id: 'count', name: '', values: [0, 0, 0, 0, 0, 0] }] },
          { id: 'commission', chart: 'gauge', title: 'Commission against goal', span: 'half', unit: 'USD', target: 100, series: [{ id: 'earned', name: '', values: [0] }] },
        ],
      },
    },
    {
      kind: 'targetMarket', title: 'Who I am selling to', status: 'Researching', x: 0, y: 560,
      extra: { segments: SALES_SWIMLANES.map((lane) => lane.title), ownerUserId: input.ownerUserId },
    },
    {
      kind: 'salesCampaign', title: 'Outreach campaign', status: 'Draft', x: 440, y: 560,
      extra: { ownerUserId: input.ownerUserId, subject: 'The canvas that ships the whole system' },
    },
    {
      kind: 'salesGoal', title: 'Weekly goals & my links', status: 'Active', x: 880, y: 560,
      extra: {
        outreachTarget: 50, contactsTarget: 20, meetingsTarget: 3, revenueGoalCents: 0,
        referralLink: link(input.referralCode), salesLink: link(input.salesCode),
        ownerUserId: input.ownerUserId,
      },
    },
    {
      kind: 'salesMeeting', title: 'Demos & coaching', status: 'Needs scheduling', x: 1320, y: 560,
      extra: { durationMinutes: 30, ownerUserId: input.ownerUserId },
    },
    {
      // The collateral, ON the board. `/media` is the single source for what the
      // assets ARE — this card just points at them, so a new asset does not need
      // a second edit here.
      kind: 'file', title: 'Sales deck & media kit', status: 'Ready to send', x: 0, y: 900,
      extra: {
        subtitle: 'The pitch deck as PDF and PowerPoint, plus every slide as a PNG.',
        files: MEDIA_KIT.assets.map((asset) => ({ name: asset.key, url: `${origin}${asset.href}`, format: asset.format, size: asset.size })),
        previewUrl: `${origin}${MEDIA_KIT.cover}`,
      },
    },
    {
      kind: 'agent', title: 'CRO — your sales coach', status: 'Ready', x: 560, y: 900,
      extra: {
        // The platform's OWN revenue seat, not a generic assistant: the seat and
        // domain are what make this the CRO everywhere else in the product means.
        agentSeat: 'CRO', agentDomain: 'revenue',
        model: 'auto', instructions: CRO_INSTRUCTIONS,
        subtitle: 'Reviews your pipeline, names the stage that is killing deals, and gives you the next action.',
      },
    },
    {
      kind: 'note', title: 'How this board works', status: 'Read me first', x: 1120, y: 900,
      extra: {
        content: [
          '1. Work the kanban left to right. A lane is a segment — the same stage is different work for a founder and for an enterprise buyer.',
          '2. Share the links on the goals card. Every signup through them is attributed to you.',
          '3. Ask the CRO for a weekly review. It reads THIS board, so keep it current.',
          '4. The Sales Hub (left menu) has your leads, reports, payouts and inbox.',
        ].join('\n\n'),
      },
    },
  ];

  const objects = specs.map((spec) => ({
    id: crypto.randomUUID(),
    kind: spec.kind,
    canvasData: { position: { x: spec.x, y: spec.y } },
    content: { kind: spec.kind, title: spec.title, status: spec.status, ownerUserId: input.ownerUserId, ...spec.extra },
  }));

  const edge = (source: number, target: number, label: string) => ({
    id: crypto.randomUUID(),
    sourceObjectId: objects[source]!.id,
    targetObjectId: objects[target]!.id,
    kind: 'reference',
    label,
    metadata: {},
  });

  return {
    objects,
    connections: SALES_HUB_EDGES.map((row) => edge(row.source, row.target, row.label)),
    viewport: { x: 60, y: 60, zoom: 0.55 },
  };
}

/** The graph's edges, by object index. Shared with the template projection below
 *  so the seeded board and the placeable pack wire up identically. */
const SALES_HUB_EDGES = [
  { source: 2, target: 3, label: 'targets' },
  { source: 3, target: 0, label: 'creates leads' },
  { source: 0, target: 1, label: 'measures' },
  { source: 0, target: 4, label: 'against goals' },
  { source: 6, target: 3, label: 'attaches to' },
  { source: 1, target: 7, label: 'coached by' },
  { source: 4, target: 5, label: 'books' },
] as const;

/**
 * The same board as a placeable TEMPLATE.
 *
 * Projected from the graph rather than retyped: a template that listed the eight
 * objects again is the second description of one thing that PRD 20 §3.1 names,
 * and it would be the copy that goes stale — the seeded board is the one people
 * see every day, so a divergence would be discovered only by a builder who
 * placed the pack and got a different product.
 *
 * The `ownerUserId` is empty here on purpose: a pack is placed by whoever places
 * it, and stamping the author's id onto somebody else's copy would attribute
 * their pipeline to a stranger.
 */
export function salesHubTemplate() {
  const graph = buildSalesHubGraph({ ownerUserId: '', referralCode: null, salesCode: null });
  return {
    id: 'sales-hub',
    name: 'Sales Hub',
    description: 'The prescriptive board for selling Builderforce: a kanban by segment, the read-out, the deck, and a CRO coach.',
    category: 'Marketplace template' as const,
    objects: graph.objects.map((object) => {
      const content = object.content as Record<string, unknown>;
      const { kind, title, ...data } = content;
      const position = (object.canvasData as { position: { x: number; y: number } }).position;
      return { kind: kind as string, title: title as string, x: position.x, y: position.y, data };
    }),
    connections: SALES_HUB_EDGES.map((row) => ({ ...row })),
  };
}
