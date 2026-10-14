/** Insights API contract — analysis (PRD 33). Re-exported by `../api.ts`; see its header. */
import type { ReplayFilter } from '../filters';
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
