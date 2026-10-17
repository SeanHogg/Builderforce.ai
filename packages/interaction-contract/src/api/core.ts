/** Insights API contract — core (PRD 33). Re-exported by `../api.ts`; see its header. */
import type { ReplayMark } from '../chunk';
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
  /** The recorder sent the visit's final chunk — a followed recording has nothing more coming. */
  ended?: boolean;
}

/**
 * What a LIVE recording gains while it is followed — the light read the player
 * polls instead of the whole row (`GET …/recordings/:id/status`). Chunk seqs come
 * back only past the reader's `afterSeq`; marks come back only when the count the
 * reader holds (`marks`) is stale.
 */
export interface ReplayRecordingStatusDto {
  durationMs: number;
  activeMs: number;
  pageCount: number;
  exitPath: string;
  counts: ReplayCounts;
  chunkCount: number;
  /** Stored seqs above the request's `afterSeq`, ascending. */
  chunkSeqs: number[];
  markCount: number;
  /** The visit's final chunk has landed: the follower can stop asking. */
  ended: boolean;
  /** The whole timeline, present only when `markCount` differs from the reader's. */
  marks?: ReplayMark[];
}

export interface ReplayPage<T> {
  items: T[];
  nextCursor: string | null;
  /**
   * Set (true) by a read that answered a filter from the KEPT recordings weighted by
   * `sample_weight` rather than the exact rollups (D15/D18) — the UI prints ≈.
   * Absent on exact or plain lists.
   */
  estimated?: boolean;
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

/** Exact counts from the daily rollups over every session (D15, D18), or ≈ under a filter (`estimated`). */
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
  /**
   * True when a filter was applied: every number is then estimated from the kept
   * recordings matching it, weighted by `sample_weight` (≈), `newVisitors` is 0 and
   * `lcpP75` null (a kept row carries neither). Absent/false = exact rollups.
   */
  estimated?: boolean;
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

/** `tenants.settings` keys the operator controls (D8, D9) — `REPLAY_PATHS.opsTenantSettings`. */
export interface ReplayTenantSettings {
  replayExcluded: boolean;
  /** Null = the catalog's free allowance applies. */
  replayFreeAllowanceOverride: number | null;
}

/** POST body of `REPLAY_PATHS.opsGrants` — an audited credit grant (D17). */
export interface ReplayCreditGrantInput {
  tenantId: number;
  units: number;
  reason: string;
}

export interface ReplayCreditGrantResult {
  auditId: string;
  reference: string;
  units: number;
  /** The workspace's spendable credits after the grant. */
  credits: number;
}

/** `DELETE REPLAY_PATHS.visitor` — one visitor's kept recordings erased from one site (rows, summaries, bytes). */
export interface ReplayVisitorErasureDto {
  visitorId: string;
  /** Recordings removed. */
  erased: number;
}
