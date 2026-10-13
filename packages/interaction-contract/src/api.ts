/**
 * The Insights read/write API contract (PRD 33 §3, §4).
 *
 * ONE set of DTOs shared by the API routes (which produce them) and
 * `frontend/src/lib/replayApi.ts` (which consumes them), so the two sides
 * cannot drift. Types only plus the path table; no runtime dependencies.
 *
 * Scope (D17) is always `{ tenantId, siteId }`. The tenant comes from the
 * caller's membership; the site is the `site` query parameter and must
 * belong to that tenant (403 otherwise). A project's hosted site is
 * resolved once through `REPLAY_PATHS.projectSite` and then read like any
 * other site.
 */

import type { ReplayMark } from './chunk';
import type { ReplayFilter } from './filters';

export type ReplaySiteKind = 'hosted' | 'external';
export type ReplayDeviceClass = 'desktop' | 'tablet' | 'phone';
export type ReplayKeepReason = 'sample' | 'frustration' | 'error' | 'goal' | 'tag' | 'manual';

/** Site settings (`replay_sites.settings`). Every field is optional on write. */
export interface ReplaySiteSettings {
  /** Mask every text node, not only `[data-bf-mask]` regions. */
  maskAllText: boolean;
  /** Wait for `BFReplay.consent(true)` before recording. */
  consentRequired: boolean;
  /** Head-sample probability for keeping a full recording (0..1). */
  keepRate: number;
  /** Capture canvas/WebGL frames (D10). */
  recordCanvas: boolean;
  /** Honour `BFReplay.identify(id, traits)`. */
  identify: boolean;
  /** Recording retention in days (D3): 30 by default, at most 90. */
  retentionDays: number;
  /** Optional recorder channel / pinned version. */
  recorderChannel?: string | null;
}

export const DEFAULT_REPLAY_SITE_SETTINGS: ReplaySiteSettings = {
  maskAllText: false,
  consentRequired: false,
  keepRate: 1,
  recordCanvas: false,
  identify: false,
  retentionDays: 30,
  recorderChannel: null,
};

export interface ReplaySiteDto {
  id: string;
  kind: ReplaySiteKind;
  projectId: number | null;
  label: string;
  status: 'active' | 'disabled';
  settings: ReplaySiteSettings;
  /** Origins the site key accepts (external sites). */
  allowedOrigins: string[];
  /** The public `bfr_` key (not a secret: its only power is ingest from its origins). */
  publicKey: string | null;
  createdAt: string;
}

/** `GET /api/replay-ingest/v1/config` answer the loader reads. */
export interface ReplayClientConfig {
  enabled: boolean;
  recorderUrl?: string;
  recorderVersion?: string;
  keepRate?: number;
  maskAllText?: boolean;
  consentRequired?: boolean;
  recordCanvas?: boolean;
  identify?: boolean;
  releaseHint?: string | null;
}

export interface ReplayCounts {
  clicks: number;
  rage: number;
  dead: number;
  errors: number;
  quickbacks: number;
  excessiveScrolls: number;
}

export interface ReplayRecordingSummaryDto {
  id: string;
  visitId: string;
  visitorId: string;
  startedAt: string;
  durationMs: number;
  activeMs: number;
  entryPath: string;
  exitPath: string;
  pageCount: number;
  releaseKey: string;
  deviceClass: ReplayDeviceClass;
  browser: string | null;
  os: string | null;
  country: string | null;
  referrerHost: string | null;
  counts: ReplayCounts;
  converted: boolean;
  keepReason: ReplayKeepReason;
  sampleWeight: number;
  identifiedId: string | null;
  tags: Record<string, string>;
}

export interface ReplayRecordingDto extends ReplayRecordingSummaryDto {
  recorderVersion: string;
  viewport: { w: number; h: number };
  variant: string | null;
  traits: Record<string, string> | null;
  chunkCount: number;
  /**
   * The stored chunk `seq`s, ascending. A recording kept by a trigger starts
   * mid-visit, so its first seq is often above 0 — the player iterates these,
   * never `0..chunkCount-1`.
   */
  chunkSeqs: number[];
  /** Timeline marks from `marks.json`, ordered by `atMs`. */
  marks: ReplayMark[];
}

export interface ReplayPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ReplayReleaseDto {
  releaseKey: string;
  /** Operator label, else `R<ordinal>`. */
  label: string | null;
  ordinal: number;
  source: 'explicit' | 'hosted' | 'fingerprint';
  firstSeenAt: string;
  lastSeenAt: string;
}

/** Exact counts from the daily rollups over every session (D15, D18). */
export interface ReplayKpisDto {
  days: number;
  sessions: number;
  pageviews: number;
  newVisitors: number;
  conversions: number;
  conversionRate: number;
  frustratedSessions: number;
  frustratedRate: number;
  errorsPer1k: number;
  /** p75 LCP in ms from the vitals histogram, null when no samples. */
  lcpP75: number | null;
  trend: Array<{ day: string; sessions: number; frustrated: number; conversions: number }>;
}

export type ReplayIssueStatus =
  | 'new' | 'ongoing' | 'regressed' | 'proposed' | 'preview' | 'measuring' | 'verified' | 'ignored';

export interface ReplayIssueDto {
  id: string;
  fingerprint: string;
  kind: string;
  route: string;
  subject: string;
  title: string;
  status: ReplayIssueStatus;
  /** Sessions affected in the window (exact). */
  sessions: number;
  /** Share of the route's sessions in the window, 0..1. */
  share: number;
  /** Daily sessions over the window, oldest first. */
  sparkline: number[];
  firstRelease: string | null;
  lastRelease: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  prescriptionId: string | null;
}

export interface ReplayIssueDetailDto extends ReplayIssueDto {
  representatives: Array<{ rank: number; recordingId: string; share: number; label: string | null }>;
  byRelease: Array<{ releaseKey: string; sessions: number }>;
  byDevice: Array<{ deviceClass: ReplayDeviceClass; sessions: number }>;
}

export interface ReplayLiveDto {
  active: number;
  byRoute: Array<{ route: string; n: number }>;
  visitors: Array<{
    visitId: string;
    route: string;
    deviceClass: ReplayDeviceClass;
    x: number | null;
    y: number | null;
    lastSeenAt: string;
    recordingId: string | null;
  }>;
}

export interface ReplayUsageDto {
  /** `yyyy-mm`. */
  period: string;
  freeAllowance: number;
  freeUsed: number;
  credits: number;
  /** Units consumed this period (free + paid). */
  used: number;
  /** freeAllowance + credits. */
  limit: number;
}

export interface ReplaySiteVerifyDto {
  scriptSeen: boolean;
  originOk: boolean;
  firstEventAt: string | null;
  firstRecordingId: string | null;
}

export interface CapabilityStateDto {
  slug: string;
  installed: boolean;
  entitled: boolean;
  siteCount: number;
  usage: ReplayUsageDto | null;
}

export interface ReplayPackDto {
  id: string;
  units: number;
  amountCents: number;
}

/** `POST REPLAY_PATHS.sites` body: an external site (§4.2 step 4). */
export interface ReplaySiteCreateInput {
  label: string;
  /** Origins (`https://shop.example.com`) the site's `bfr_` key accepts. */
  allowedOrigins: string[];
  settings?: Partial<ReplaySiteSettings>;
}

/** `PATCH REPLAY_PATHS.site` body. Every field optional. */
export interface ReplaySiteUpdateInput {
  label?: string;
  allowedOrigins?: string[];
  settings?: Partial<ReplaySiteSettings>;
  status?: 'active' | 'disabled';
}

/** `POST REPLAY_PATHS.capabilityPackCheckout` body and answer. */
export interface CapabilityPackCheckoutInput {
  /** Absolute URL the processor returns to; may carry `{CHECKOUT_SESSION_ID}`. */
  returnUrl: string;
}

export interface CapabilityPackCheckoutDto {
  checkoutUrl: string;
}

export interface ReplayOpsSummaryDto {
  sites: number;
  tenants: number;
  sessions7d: number;
  keptRecordings7d: number;
  bytes7d: number;
  packRevenueCents30d: number;
}

// ── Heatmaps, element tracking and release compare (S4) ─────────────────────
// Query parameters for every heatmap read: `site`, `route`, `release`, `compare`
// (a second release), `device`, `kind`, `days`. Counts are exact over every session
// (D15/D18) — they come from the `replay_heat_daily` / `replay_route_daily` rollups.

export type ReplayHeatKind = 'click' | 'rage' | 'dead' | 'scroll';

export const REPLAY_HEAT_KINDS: readonly ReplayHeatKind[] = ['click', 'rage', 'dead', 'scroll'];

/** One heat layer on the `GRID` lattice. For `scroll`, `gx` is 0 and `gy` is the depth decile. */
export interface ReplayHeatGridDto {
  route: string;
  releaseKey: string | null;
  deviceClass: ReplayDeviceClass | null;
  kind: ReplayHeatKind;
  cells: Array<{ gx: number; gy: number; n: number }>;
  total: number;
}

/** One element on a route, ranked by the recency-weighted heat rule (`rankHeatZones`). */
export interface ReplayElementRowDto {
  selector: string;
  label: string | null;
  clicks: number;
  rage: number;
  dead: number;
  /** Clicks in the `compare` release; null without one. */
  compareClicks: number | null;
  /** Relative change of clicks vs the compare release (0.25 = +25 %); null when not comparable. */
  delta: number | null;
  score: number;
}

export interface ReplayScrollDepthDto {
  route: string;
  /** Page views that reported a scroll depth. */
  sessions: number;
  /** 10 entries: share of those page views reaching depth decile i, 0..1. */
  reach: number[];
}

export interface ReplayRouteStatDto {
  route: string;
  /** Sessions that ENTERED on this route. */
  sessions: number;
  pageviews: number;
}

/** A finding from `HEATMAP_INSIGHT_RULES`; the title is `replay.heatInsight.<ruleId>` over `params`. */
export interface ReplayHeatInsightDto {
  ruleId: string;
  route: string;
  selector: string | null;
  params: Record<string, number | string>;
  action: 'watch' | 'ticket';
}

/**
 * The heatmap background: the newest kept recording on that route/release/device,
 * and the stored chunk `seq` that holds its first full snapshot. `recordingId` is
 * null when no kept recording visited the route in the window.
 */
export interface ReplayHeatSnapshotDto {
  recordingId: string | null;
  seq: number;
}

export type ReplayExportStatus = 'queued' | 'running' | 'done' | 'failed' | 'unavailable';

/** An MP4 (or WebM) render of one recording (S4b, D10). */
export interface ReplayExportDto {
  id: string;
  recordingId: string;
  status: ReplayExportStatus;
  format: 'mp4' | 'webm' | null;
  /** `REPLAY_PATHS.exportDownload` filled in, once `done`. */
  downloadUrl: string | null;
  error: string | null;
  createdAt: string;
}

// ── S4c analysis parity (PRD 33 §2.1, §8 S4c) ─────────────────────────────

/** A saved `ReplayFilter` (`replay_segments`). Names are unique per site. */
export interface ReplaySegmentDto {
  id: string;
  name: string;
  filter: ReplayFilter;
  createdAt: string;
}

/** `POST REPLAY_PATHS.segments` body; `PATCH REPLAY_PATHS.segment` takes either field. */
export interface ReplaySegmentInput {
  name: string;
  filter: ReplayFilter;
}

/** Distinct values one filter field takes on the site's kept recordings (≤ 50, most sessions first). */
export interface ReplayFilterOptionsDto {
  field: string;
  values: Array<{ value: string; count: number }>;
}

export type ReplayOverviewTopKey =
  | 'pages' | 'entryPages' | 'exitPages' | 'referrers' | 'countries' | 'devices' | 'browsers' | 'os';

/**
 * The Overview dashboard. Unfiltered it is read from the exact rollups; a filter
 * forces a read of the kept recordings weighted by `sample_weight` and sets
 * `estimated` (the UI prints ≈). A number the weighted read cannot know
 * (new visitors, scroll depth) is `null` there rather than invented.
 */
export interface ReplayOverviewDto {
  days: number;
  sessions: number;
  newVisitors: number | null;
  pagesPerSession: number;
  avgActiveMs: number;
  avgScrollDepthPct: number | null;
  /** Share of sessions (0..1) with at least one mark of the kind. */
  frustration: { rage: number; dead: number; quickback: number; excessiveScroll: number; error: number };
  trend: Array<{ day: string; sessions: number; frustratedPct: number }>;
  /** Top 10 per list. Exact `pages` count pageviews (the rollup counts a session once, at its entry). */
  top: Record<ReplayOverviewTopKey, Array<{ value: string; sessions: number }>>;
  /** True when a filter forced a kept-recording read weighted by `sample_weight`. */
  estimated: boolean;
}

export type ReplaySmartEventRuleKind = 'page' | 'click' | 'custom';
export type ReplayMatchMode = 'equals' | 'prefix' | 'contains';

/** A smart event: a built-in (`id: null`, code data) or one of the site's own rules. */
export interface ReplaySmartEventDto {
  id: string | null;
  name: string;
  ruleKind: ReplaySmartEventRuleKind;
  match: string;
  matchMode: ReplayMatchMode;
  builtin: boolean;
  /** Kept recordings in the window that hit it (≈, weighted by `sample_weight`). */
  count: number;
}

/** `POST REPLAY_PATHS.smartEvents` and `REPLAY_PATHS.smartEventPreview` body. */
export interface ReplaySmartEventInput {
  name: string;
  ruleKind: ReplaySmartEventRuleKind;
  match: string;
  matchMode: ReplayMatchMode;
}

export type ReplayFunnelStepKind = 'page' | 'click' | 'event';

export interface ReplayFunnelStepDto {
  ord: number;
  stepKind: ReplayFunnelStepKind;
  match: string;
  matchMode: ReplayMatchMode;
  label: string;
}

export interface ReplayFunnelDto {
  id: string;
  name: string;
  windowMinutes: number;
  steps: ReplayFunnelStepDto[];
}

/** `POST REPLAY_PATHS.funnels` / `PUT REPLAY_PATHS.funnel` body (2..10 steps, in order). */
export interface ReplayFunnelInput {
  name: string;
  windowMinutes?: number;
  steps: Array<{ stepKind: ReplayFunnelStepKind; match: string; matchMode: ReplayMatchMode }>;
}

/**
 * A funnel over kept recordings (always ≈). `droppedRecordingIds`: recordings that
 * reached the previous step but not this one (≤ 20; empty for the first step).
 * Rows keep step ORDER, not time, so step times are placed along each recording's
 * duration — `medianTimeFromPrevMs` is an estimate like the counts.
 */
export interface ReplayFunnelEvalDto {
  funnelId: string;
  steps: Array<{
    ord: number;
    label: string;
    visits: number;
    conversionFromPrevPct: number | null;
    medianTimeFromPrevMs: number | null;
    droppedRecordingIds: string[];
  }>;
  /** The scan hit its 20,000-recording ceiling. */
  truncated: boolean;
  estimated: true;
}

/** Structurally identical to `buildVisitorFlowGraph`'s output (api `domain/marketing/visitorFlowGraph.ts`). */
export interface ReplayFlowDto {
  nodes: Array<{
    id: string;
    kind: 'prompt' | 'page' | 'error' | 'exit' | 'converted';
    label: string;
    visitors: number;
    events: number;
    exits: number;
    medianStepIndex: number;
  }>;
  edges: Array<{ from: string; to: string; visitors: number; events: number }>;
  totals: {
    visitors: number;
    visits: number;
    returningVisitors: number;
    visitsWithPrompt: number;
    visitsWithError: number;
    convertedVisitors: number;
  };
}

/** A cited summary of one recording; every sentence ends `#<ord>` of a mark on its timeline. */
export interface ReplaySummaryDto {
  recordingId: string;
  summary: string;
  citations: Array<{ atMs: number; ord: number }>;
  model: string | null;
  generatedAt: string;
}

/** Patterns across a sample of a segment's recordings, each with deep-linkable examples. */
export interface ReplaySegmentSummaryDto {
  patterns: Array<{ text: string; examples: Array<{ recordingId: string; atMs: number }> }>;
  sampled: number;
  generatedAt: string;
}

/** The AI budget answer: HTTP 429 with this body. */
export interface ReplayAiLimitErrorDto {
  error: 'limit';
}

/**
 * Path table. API routers mount these; `replayApi.ts` calls them. `:x`
 * segments are filled by the client. All `/api/replay/*` reads take
 * `?site=<siteId>`.
 */
export const REPLAY_PATHS = {
  ingestConfig: '/api/replay-ingest/v1/config',
  ingestChunks: '/api/replay-ingest/v1/chunks',
  sites: '/api/replay/sites',
  site: '/api/replay/sites/:siteId',
  siteVerify: '/api/replay/sites/:siteId/verify',
  recordings: '/api/replay/recordings',
  recording: '/api/replay/recordings/:recordingId',
  recordingChunk: '/api/replay/recordings/:recordingId/chunks/:seq',
  releases: '/api/replay/releases',
  release: '/api/replay/releases/:releaseKey',
  kpis: '/api/replay/kpis',
  issues: '/api/replay/issues',
  issue: '/api/replay/issues/:issueId',
  live: '/api/replay/live',
  usage: '/api/replay/usage',
  heatGrid: '/api/replay/heatmap/grid',
  heatElements: '/api/replay/heatmap/elements',
  heatScroll: '/api/replay/heatmap/scroll',
  heatRoutes: '/api/replay/heatmap/routes',
  heatInsights: '/api/replay/heatmap/insights',
  heatSnapshot: '/api/replay/heatmap/snapshot',
  recordingExport: '/api/replay/recordings/:recordingId/export',
  exportStatus: '/api/replay/exports/:exportId',
  exportDownload: '/api/replay/exports/:exportId/download',
  projectSite: '/api/projects/:projectId/replay/site',
  capabilityState: '/api/capabilities/:slug/state',
  capabilityPacks: '/api/capabilities/session-replay/packs',
  capabilityPackCheckout: '/api/capabilities/session-replay/packs/:packId/checkout',
  opsSummary: '/api/admin/replay-ops/summary',
  // S4c analysis parity
  segments: '/api/replay/segments',
  segment: '/api/replay/segments/:segmentId',
  filterOptions: '/api/replay/filter-options',
  overview: '/api/replay/overview',
  smartEvents: '/api/replay/smart-events',
  smartEvent: '/api/replay/smart-events/:eventId',
  smartEventPreview: '/api/replay/smart-events/preview',
  funnels: '/api/replay/funnels',
  funnel: '/api/replay/funnels/:funnelId',
  funnelEvaluate: '/api/replay/funnels/:funnelId/evaluate',
  flow: '/api/replay/flow',
  /** POST. */
  recordingSummary: '/api/replay/recordings/:recordingId/summary',
  /** POST. */
  segmentSummary: '/api/replay/summary',
  // S4d method link
  /** GET — `ReplayTicketEffectDto` for a ticket raised from a replay moment. */
  ticketEffect: '/api/replay/ticket-effect/:taskId',
  /** POST, superadmin — seeds "The method" funnel + its four smart events on a site. */
  opsSeedMethodFunnel: '/api/admin/replay-ops/sites/:siteId/seed-method-funnel',
  // S4e prescriptions
  /** GET `?site&area&status&f.*` — `ReplayPrescriptionDto[]`, ranked. */
  prescriptions: '/api/replay/prescriptions',
  /** GET — one `ReplayPrescriptionDto`. */
  prescription: '/api/replay/prescriptions/:prescriptionId',
  /** POST — `:action` ∈ `REPLAY_PRESCRIPTION_ROUTE_ACTIONS`; body `ReplayPrescriptionActionInput`. */
  prescriptionAction: '/api/replay/prescriptions/:prescriptionId/:action',
  /** POST — "Find fixes now" (once an hour per site); `ReplayPrescriptionSweepResultDto`. */
  prescriptionSweep: '/api/replay/prescriptions/sweep',
  /** GET — `ReplayReleaseReportDto`. */
  releaseReport: '/api/replay/releases/:releaseKey/report',
} as const;

/**
 * The measured effect of a ticket raised from a replay moment (PRD 33 §5.3.4).
 * Computed on read from the route rollups, never stored. `waiting` until a release
 * newer than the moment's has `minVisits` sessions on the moment's route.
 */
export interface ReplayTicketEffectDto {
  taskId: number;
  status: 'waiting' | 'measured';
  metric: 'frustrated' | 'errors' | 'conversions';
  route: string;
  before: { releaseKey: string; sessions: number; rate: number | null };
  /** The newest release past the moment's; null when none has shipped yet. */
  after: { releaseKey: string; sessions: number; rate: number | null } | null;
  /** `after.rate − before.rate` once measured; null while waiting. */
  delta: number | null;
  minVisits: number;
}

/** `POST opsSeedMethodFunnel` — what the seed created (idempotent: a re-run creates nothing). */
export interface ReplayMethodFunnelSeedDto {
  siteId: string;
  funnelId: string;
  createdSmartEvents: string[];
  createdFunnel: boolean;
}

// ── S4e prescriptions (PRD 33 §5.1, D13) ─────────────────────────────────────

export type ReplayPrescriptionArea =
  | 'funnel' | 'ux' | 'site' | 'sales' | 'seo' | 'content' | 'performance' | 'accessibility';

export const REPLAY_PRESCRIPTION_AREAS: readonly ReplayPrescriptionArea[] = [
  'funnel', 'ux', 'site', 'sales', 'seo', 'content', 'performance', 'accessibility',
];

/** `replay_prescriptions.status` (§3.2). The last four are terminal. */
export type ReplayPrescriptionStatus =
  | 'proposed' | 'applied' | 'measuring' | 'worked' | 'no_effect' | 'worse' | 'dismissed';

/** What a prescription card offers (Fix it / Test it / Follow up / Ticket / Dismiss + the §5.2 page-review actions). */
export type ReplayPrescriptionActionKind =
  | 'fix' | 'test' | 'follow_up' | 'ticket' | 'dismiss' | 'apply_in_composer' | 'copy_prompt' | 'apply_page';

/** The `:action` segment of `REPLAY_PATHS.prescriptionAction`. */
export type ReplayPrescriptionRouteAction =
  | 'fix' | 'test' | 'start-test' | 'follow-up' | 'ticket' | 'dismiss' | 'publish-preview' | 'revert';

export const REPLAY_PRESCRIPTION_ROUTE_ACTIONS: readonly ReplayPrescriptionRouteAction[] = [
  'fix', 'test', 'start-test', 'follow-up', 'ticket', 'dismiss', 'publish-preview', 'revert',
];

/**
 * A 30-day impact range from the site's own data: affected × (conversion without −
 * with), Wilson interval on both cohorts. `estimate` is null (and `confidence` low)
 * below 100 visits in either cohort, or when the finding has no cohort to compare.
 */
export interface ReplayImpactDto {
  estimate: number | null;
  low: number | null;
  high: number | null;
  /** What the numbers count, e.g. `conversions`. */
  unit: string;
  confidence: 'low' | 'medium' | 'high';
  /** The projection horizon (30). */
  horizonDays: number;
  /** True when the cohorts are weighted kept recordings (the UI prints ≈). */
  estimated: boolean;
}

/** The deterministic finding: title params (rendered by the client from `ruleId`) and its evidence. */
export interface ReplayPrescriptionFindingDto {
  params: Record<string, string | number>;
  evidence: Array<{ recordingId: string; atMs: number }>;
  selector: string | null;
  label: string | null;
  /** The issue group's fingerprint (filter `issue` eq), when the finding is about one. */
  fingerprint: string | null;
  /** Visits the finding touched in the window. */
  affected: number;
}

export interface ReplayPrescriptionAcceptanceDto {
  metric: string;
  direction: 'up' | 'down';
  minVisits: number;
}

export interface ReplayPrescriptionMeasuredDto {
  before: number | null;
  after: number | null;
  delta: number | null;
  verdict: 'worked' | 'no_effect' | 'worse';
  /** Which verifier measured it. */
  source: 'ticket_effect' | 'ab_test' | 'follow_up';
  /** The release the verdict was measured on (the shipped fix), when there is one. */
  releaseKey: string | null;
  measuredAt: string;
}

export interface ReplayPrescriptionDto {
  id: string;
  ruleId: string;
  area: ReplayPrescriptionArea;
  source: 'rule' | 'observed';
  subjectKey: string;
  pagePath: string | null;
  status: ReplayPrescriptionStatus;
  finding: ReplayPrescriptionFindingDto;
  /** The AI's cited phrasing; null until drafted (top 5 a day per site). */
  prescription: string | null;
  /** The drafted change (`{ kind, description, target? }`), or a §5.2 `VisualPatch`. */
  change: unknown | null;
  visual: unknown | null;
  impact: ReplayImpactDto;
  /** The card's actions for this rule. */
  actions: ReplayPrescriptionActionKind[];
  /** What `REPLAY_PATHS.prescriptionAction` accepts right now (e.g. `revert` only on `worse` after a publish). */
  next: ReplayPrescriptionRouteAction[];
  actionKind: ReplayPrescriptionActionKind | null;
  /** Encoded refs of what the action created (`t=<taskId>;x=<testId>;p=<preview>;l=<live>;s=<sequence>`). */
  actionRef: string | null;
  /** Parsed `actionRef`. */
  refs: { taskId: number | null; testId: number | null; previewRelease: string | null; liveRelease: string | null; sequenceObjectId: string | null };
  acceptance: ReplayPrescriptionAcceptanceDto | null;
  measured: ReplayPrescriptionMeasuredDto | null;
  dismissReason: string | null;
  issueId: string | null;
  /** Rank within the list (1 = do first). */
  rank: number;
  createdAt: string;
  updatedAt: string;
}

/** `POST REPLAY_PATHS.prescriptionAction` body. Each action reads only its own fields. */
export interface ReplayPrescriptionActionInput {
  /** `dismiss`: required. */
  reason?: string;
  /** `fix`: the coding agent (`ide_agents.id`) to run it — a hosted site only. */
  agentRef?: string | null;
  /** `fix` / `ticket` on an external site: the project the ticket belongs to. */
  projectId?: number | null;
  /** `follow-up`: the `sequence` canvas object to enrol into. */
  sequenceObjectId?: string | null;
  /** `follow-up`: which matched contacts to enrol (default: all matched). */
  contactIds?: string[];
  /** `follow-up`: false (default) answers the preview; true enrols. */
  confirm?: boolean;
}

/** `follow-up` without `confirm`: what WOULD happen, shown before a person enrols anyone. */
export interface ReplayFollowUpPreviewDto {
  matched: Array<{ contactId: string; name: string; email: string }>;
  /** Identifiable visitors with no matching contact — counted, never listed. */
  unmatched: number;
  /** The drafted first touch, from the finding (never sent from here). */
  draft: { subject: string; body: string };
  /** Builderforce's own site, superadmin only: matched `sales_leads` ids for the broadcast composer. */
  platformLeadIds: string[];
  enrolled: number;
}

export interface ReplayPrescriptionActionResultDto {
  prescription: ReplayPrescriptionDto;
  taskId?: number | null;
  executionId?: number | null;
  /** Why a fix created a ticket but no run (no agent, external site, dispatcher refusal). */
  refusal?: string | null;
  testId?: number | null;
  followUp?: ReplayFollowUpPreviewDto | null;
}

export interface ReplayPrescriptionSweepResultDto {
  found: number;
  created: number;
  refreshed: number;
  prescribed: number;
}

/** The improvement ledger for one release: the fixes it shipped and their verdicts. */
export interface ReplayReleaseReportDto {
  releaseKey: string;
  label: string | null;
  firstSeenAt: string | null;
  prescriptions: Array<{
    id: string;
    ruleId: string;
    area: ReplayPrescriptionArea;
    status: ReplayPrescriptionStatus;
    actionKind: ReplayPrescriptionActionKind | null;
    measured: ReplayPrescriptionMeasuredDto | null;
  }>;
}
