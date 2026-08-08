/**
 * Admin (superadmin) API client for api.builderforce.ai.
 * All requests use the Web JWT (not tenant token). Requires user.isSuperadmin and WebJWT with sa: true.
 */

import { apiRequest, apiRequestText, type RequestOptions } from './apiClient';
import { getStoredWebToken } from './auth';
import type { LlmModelStatus, VendorId } from './builderforceApi';
import type { PsychometricProfile } from './psychometric';
import type { FeedbackQueue, FeedbackStatus } from './feedbackApi';

export type { LlmModelStatus, VendorId };

// ---------------------------------------------------------------------------
// Types (mirror api/admin routes)
// ---------------------------------------------------------------------------

export interface AdminUser {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
  isSuperadmin: boolean;
  createdAt: string;
  tenantCount: number;
}

export interface AdminTenant {
  id: number;
  name: string;
  slug: string;
  status: string;
  plan: 'free' | 'pro' | 'teams';
  effectivePlan: 'free' | 'pro' | 'teams';
  billingStatus: string;
  billingEmail: string | null;
  billingUpdatedAt: string | null;
  isPaid: boolean;
  createdAt: string;
  memberCount: number;
  agentHostCount: number;
  /**
   * Superadmin override for the daily token cap.
   *   null → use plan default
   *   -1   → unlimited
   *   >= 0 → use this value
   */
  tokenDailyLimitOverride: number | null;
  /**
   * Per-tenant daily ceiling on FUNDED paid-overflow spend (millicents, 1/100000 USD).
   *   null → plan default (free = $0.50/day; pro/teams = unlimited)
   *   -1   → unlimited (gate skipped)
   *   >= 0 → explicit millicents/day ceiling
   * See migration 0130 + the gateway overflow gate.
   */
  paidOverflowDailyCap: number | null;
  /**
   * Per-tenant daily image-generation credit override (1 credit = 1 image).
   *   null → plan default (free 10 / pro 1000 / teams 5000)
   *   -1   → unlimited
   *   >= 0 → explicit images/day
   * Metered independently of the text token budget (migration 0131).
   */
  imageCreditsDailyLimit: number | null;
  /** Superadmin grant of premium routing — when true the LLM proxy uses the
   *  premium model pool (top PREMIUM-tier models) and the extended per-vendor
   *  timeout regardless of plan/billingStatus. */
  premiumOverride: boolean;
  discountCode: string | null;
  discountPercentOff: number | null;
  discountDurationYears: number | null;
  discountStatus: 'pending' | 'redeemed' | null;
  discountAppliedAt: string | null;
}

export interface AdminDiscountCode {
  id: string;
  code: string;
  percentOff: number;
  applicablePlan: 'pro' | 'teams';
  billingCycle: 'monthly' | 'yearly';
  durationYears: number;
  isActive: boolean;
  redemptionCount: number;
  redeemedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminHealth {
  status: string;
  db: { ok: boolean; latencyMs: number };
  platform: {
    userCount: number;
    tenantCount: number;
    agentHostCount: number;
    executionCount: number;
    errorCount: number;
    paidTenantCount: number;
  };
  llm: {
    pool: number;
    models: LlmModelStatus[];
    free: LlmModelStatus[];
    pro: LlmModelStatus[];
    /** Always-on premium-fallback tail appended to every chain [1430]. */
    premiumFallback?: LlmModelStatus[];
  };
  timestamp: string;
}

export interface AdminGuestSession {
  id: string;
  visitorId: string;
  guestChatCount: number;
  guestChatTokens: number;
  toolRuns: number;
  landingPath: string | null;
  referrer: string | null;
  converted: boolean;
  convertedUserId: string | null;
  convertedEmail: string | null;
  convertedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  isPaid: boolean;
  /** What they asked for. Derived server-side from `marketing_session_prompts` —
   *  never a column on the lead row, so it cannot drift from the prompts. */
  promptCount: number;
  firstPrompt: string | null;
  lastPrompt: string | null;
  lastPromptAt: string | null;
  lastSurface: string | null;
}

/** The funnel in five numbers, above the leads list. */
export interface AdminGuestFunnelSummary {
  sessions: number;
  sessionsWithPrompt: number;
  prompts: number;
  registered: number;
  paid: number;
  conversionPct: number;
}

export interface AdminGuestSessionsPage {
  summary: AdminGuestFunnelSummary;
  sessions: AdminGuestSession[];
}

/** One prompt in a visitor's history — the drill-in. */
export interface AdminGuestPrompt {
  id: string;
  prompt: string;
  surface: string;
  sessionRef: string | null;
  mode: string | null;
  createdAt: string;
}

/** A superadmin message to visitors, and how it performed. */
export interface AdminBroadcast {
  id: number;
  key: string;
  message: string;
  tone: 'info' | 'success' | 'warning' | 'critical';
  ctaLabel: string | null;
  ctaHref: string | null;
  dismissible: boolean;
  status: 'draft' | 'live' | 'archived';
  audience: { scope: 'all' | 'guest' | 'registered' | 'paid'; visitorIds: string[]; minPrompts: number };
  startsAt: string | null;
  endsAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  impressions: number;
  clicks: number;
  dismissals: number;
  reach: number;
  clickThroughPct: number;
}

/** The vocabulary the server offers, so the composer never hard-codes a second copy. */
export interface AdminBroadcastVocabulary {
  tones: readonly AdminBroadcast['tone'][];
  statuses: readonly AdminBroadcast['status'][];
  scopes: readonly AdminBroadcast['audience']['scope'][];
  maxVisitorIds: number;
}

export interface AdminBroadcastPage {
  broadcasts: AdminBroadcast[];
  vocabulary: AdminBroadcastVocabulary;
}

/** The writable half of a broadcast. */
export type AdminBroadcastInput = Partial<Pick<AdminBroadcast,
  'message' | 'tone' | 'ctaLabel' | 'ctaHref' | 'dismissible' | 'status' | 'audience' | 'startsAt' | 'endsAt'>>;

export interface AdminCreationSessionInvitation {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

export interface AdminCreationSession {
  id: string;
  tenantId: number;
  tenantName: string;
  segmentId: string | null;
  title: string;
  status: string;
  revision: number | string;
  creatorEmail: string | null;
  objectCount: number;
  memberCount: number;
  createdAt: string;
  lastActivityAt: string;
  invitations: AdminCreationSessionInvitation[];
}

export interface AdminOutcomeMetric {
  key: string;
  label: string;
  unit: 'seconds' | 'percent' | 'agents' | 'count' | 'usd';
  direction: 'higher' | 'lower';
  current: number | null;
  baseline: number | null;
}

export interface AdminOutcomeRollup {
  scope: 'platform' | 'tenant' | 'project';
  filters: { days: number; tenantId?: number; projectId?: number };
  period: { start: string; end: string; days: number };
  previousPeriod: { start: string; end: string };
  sampleSize: number;
  deliveredSessions: number;
  metrics: AdminOutcomeMetric[];
  trends: Array<{ day: string; sessions: number; deliveries: number }>;
  tenants: Array<{ tenantId: number; tenantName: string; sessions: number; deliveries: number }>;
  projects: Array<{ projectId: number; projectName: string; tenantId: number; tenantName: string; sessions: number; deliveries: number }>;
  generatedAt: string;
  privacy: { contentFree: true; minimumExternalCohort: number; externalClaimsEligible: boolean };
}

// Sales-cycle demo accounts (migration 0360).
export interface AdminDemoFunnelRow {
  persona: string | null;
  kind: string;
  count: number;
  visitors: number;
}
export interface AdminDemoRecentEvent {
  persona: string | null;
  kind: string;
  path: string | null;
  visitorId: string;
  occurredAt: string;
}
export interface AdminDemoFunnel {
  byKind: AdminDemoFunnelRow[];
  recent: AdminDemoRecentEvent[];
}
export type SalesLeadStatus = 'new' | 'contacted' | 'qualified' | 'closed';
export interface AdminSalesLead {
  id: string;
  name: string;
  email: string;
  company: string | null;
  interest: string | null;
  message: string | null;
  source: string | null;
  locale: string | null;
  visitorId: string | null;
  status: SalesLeadStatus;
  createdAt: string;
}

export interface AdminSystemTable {
  name: string;
  totalBytes: number;
  estimatedRows: number;
  insertsSinceStatsReset: number;
  updatesSinceStatsReset: number;
  deletesSinceStatsReset: number;
  lastAutovacuum: string | null;
  lastAnalyze: string | null;
}

export interface AdminSystemDatabase {
  name: 'primary' | 'transactional';
  ok: boolean;
  latencyMs: number;
  databaseName: string | null;
  totalBytes: number;
  tables: AdminSystemTable[];
  error?: string;
}

export interface AdminSystemHealth {
  timestamp: string;
  worker: {
    version: string;
    environment: string;
    bindings: Record<string, boolean>;
  };
  runtime: {
    agentHosts: number;
    onlineAgentHosts: number;
    activeExecutions: number;
    failedExecutions24h: number;
  };
  databases: AdminSystemDatabase[];
}

// ---------------------------------------------------------------------------
// Scheduled sweeps (GET/POST /api/admin/cron) — mirrors application/runtime/
// cronSweepRunner.ts. Cloudflare delivers crons to scheduled(), never to a URL,
// so this is the only in-product way to see the work-gate's state and to force a
// tick instead of waiting out the floor interval.
// ---------------------------------------------------------------------------

export type AdminCronCadence = 'frequent' | 'daily' | 'weekly-mon' | 'weekly-fri';

export interface AdminCronSweep {
  key: string;
  cadence: AdminCronCadence;
  description: string;
  /** Can start billable agent runs — confirm before forcing. */
  dispatches: boolean;
  /** False when an env flag disables it (e.g. the demo reseed). */
  available: boolean;
  /** Persisted operator switch; false skips scheduled and forced runs. */
  enabled: boolean;
}

export interface AdminCronState {
  now: string;
  gate: {
    /** What the next frequent tick would do if it fired right now. */
    wouldRun: boolean;
    reason: 'signal' | 'floor' | 'idle' | 'kv-unavailable';
    floorDue: boolean;
    floorIntervalMs: number;
    floorIntervalOverridden: boolean;
    lastFloorSweepAt: string | null;
    nextFloorDueAt: string | null;
    kvBound: boolean;
  };
  cadences: Array<{ cadence: AdminCronCadence; cron: string | null; sweeps: number }>;
  sweeps: AdminCronSweep[];
  /** False when KV is unbound, so switches cannot safely survive a deploy. */
  controlsPersisted: boolean;
}

export interface AdminCronOutcome {
  key: string;
  cadence: AdminCronCadence;
  ok: boolean;
  ms: number;
  summary: string | null;
  error?: string;
  /** Outlived the response deadline — still running, NOT cancelled. */
  timedOut?: boolean;
  /** Skipped because the sweep is unavailable in this environment. */
  skipped?: boolean;
}

export interface AdminCronRunResult {
  target: string;
  kind: 'sweep' | 'cadence' | 'all';
  ranAt: string;
  totalMs: number;
  dispatchesReserved: number;
  results: AdminCronOutcome[];
}

/** One zero-filled daily point (matches the API MetricPoint). */
export interface AdminMetricPoint { day: string; value: number; }

export interface AdminPlatformRollup {
  windowDays: number;
  totals: { newUsers: number; newTenants: number; tokens: number; spendUsd: number; errorEvents: number };
  series: {
    newUsers: AdminMetricPoint[];
    newTenants: AdminMetricPoint[];
    tokens: AdminMetricPoint[];
    spendUsd: AdminMetricPoint[];
    errorEvents: AdminMetricPoint[];
  };
}

export interface AdminError {
  id: number;
  /** Scope hint written by the reporter — not an enforced foreign key. */
  tenantId: number | null;
  method: string | null;
  path: string | null;
  /** Reporting module, e.g. `application/llm/builtinMcpService.ts`. */
  source: string | null;
  /** Reporting function within that module. */
  operation: string | null;
  /** true = intentionally caught, false = surfaced as an HTTP 500. */
  handled: boolean;
  /** Sanitized, secret-redacted context supplied at the call site. */
  context: Record<string, unknown>;
  message: string | null;
  stack: string | null;
  createdAt: string;
}

/** One source+operation fault in the error-log rollup. */
export interface AdminErrorGroup {
  source: string | null;
  operation: string | null;
  sampleMessage: string | null;
  sampleId: number;
  count: number;
  handledCount: number;
  unhandledCount: number;
  tenantCount: number;
  firstSeen: string;
  lastSeen: string;
}

export interface AdminErrorSummary {
  total: number;
  unhandled: number;
  handled: number;
  distinctFaults: number;
  windowHours: number | null;
  groups: AdminErrorGroup[];
}

export interface AdminErrorFilters {
  q?: string;
  source?: string;
  operation?: string;
  path?: string;
  handled?: boolean;
  tenantId?: number;
  sinceHours?: number;
  limit?: number;
  offset?: number;
}

export interface AdminErrorPage {
  errors: AdminError[];
  total: number;
  returned: number;
  offset: number;
  hasMore: boolean;
  summary: AdminErrorSummary;
  /** Distinct sources in the window — powers the source filter. */
  sources: string[];
}

export interface AdminEmailDeliveryFailure {
  id: number;
  recipient: string;
  deliveryType: string;
  provider: string;
  providerStatus: number | null;
  errorMessage: string;
  createdAt: string;
}

export interface AdminEmailDeliveryFailurePage {
  failures: AdminEmailDeliveryFailure[];
  total: number;
  returned: number;
  offset: number;
  hasMore: boolean;
  summary: {
    total: number;
    last24Hours: number;
    affectedRecipients: number;
    latestAt: string | null;
  };
  deliveryTypes: string[];
}

/** One row in the superadmin LLM trace list (summary columns only). */
export interface AdminLlmTraceSummary {
  traceId: string;
  createdAt: string | null;
  tenantId: number | null;
  userId: string | null;
  surface: string;
  llmProduct: string | null;
  resolvedModel: string | null;
  resolvedVendor: string | null;
  status: number | null;
  success: boolean;
  outcome: string | null;
  classification: string | null;
  attemptCount: number;
  retries: number;
  schemaRetries: number;
  durationMs: number;
  totalTokens: number;
  useCase: string | null;
  consumerRequestId: string | null;
  streamed: boolean;
  errorMessage: string | null;
}

export interface AdminLlmTraceAttempt {
  model: string;
  vendor: string;
  status: number;
  error?: string;
  durationMs?: number;
  kind?: string;
}

/** Full single LLM trace (builder-side only) — every detail of one call. */
export interface AdminLlmTraceDetail extends AdminLlmTraceSummary {
  effectivePlan: string | null;
  premiumOverride: boolean;
  agentHostId: number | null;
  tenantApiKeyId: string | null;
  promptTokens: number;
  completionTokens: number;
  idempotencyKey: string | null;
  requestIp: string | null;
  origin: string | null;
  userAgent: string | null;
  requestShape: unknown;
  candidateChain: unknown;
  attempts: AdminLlmTraceAttempt[] | null;
  requestBody: unknown;
  responseBody: unknown;
  callerMetadata: unknown;
}

export interface LlmModelStat {
  model: string;
  vendor: VendorId;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  retries: number;
  streamed_requests: number;
}

export interface LlmDailyStat {
  day: string;
  requests: number;
  total_tokens: number;
}

export interface LlmFailoverStat {
  model: string;
  vendor: VendorId;
  errorCode: number;
  count: number;
}

export interface LlmUsageStats {
  days: number;
  totals: {
    requests: number;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    modelCount: number;
  };
  byModel: LlmModelStat[];
  daily: LlmDailyStat[];
  failovers: LlmFailoverStat[];
}

export type VendorHealthStatus = 'ok' | 'degraded' | 'down' | 'unconfigured';

export interface VendorHealthModel {
  model: string;
  ok: boolean;
  status: number;
  latencyMs: number;
  error?: string;
}

export interface VendorHealthSnapshot {
  vendor: VendorId;
  status: VendorHealthStatus;
  probedCount: number;
  okCount: number;
  failedCount: number;
  latencyMs: number;
  models: VendorHealthModel[];
}

export interface VendorHealthRow extends VendorHealthSnapshot {
  trigger: 'manual' | 'cron';
  createdAt: string;
}

export interface LegalDocument {
  documentType: 'terms' | 'privacy';
  version: string;
  title: string;
  content: string;
  publishedAt: string;
}

export interface AdminLegalCurrent {
  terms: LegalDocument;
  privacy: LegalDocument;
}

export interface LegalDocVersion {
  id: number;
  documentType: 'terms' | 'privacy';
  version: string;
  title: string;
  content: string;
  changeKind: 'publish' | 'amend';
  changedBy: string | null;
  createdAt: string;
}

export interface AdminNewsletterSubscriber {
  id: number;
  userId: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  source: string;
  status: 'subscribed' | 'unsubscribed' | 'suppressed';
  subscribedAt: string | null;
  unsubscribedAt: string | null;
  unsubscribeReason: string | null;
  lastCommunicationAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  userDisplayName?: string | null;
  userUsername?: string | null;
}

export interface AdminNewsletterTemplate {
  id: number;
  name: string;
  slug: string;
  subject: string;
  preheader: string | null;
  bodyMarkdown: string;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export type AdminReleaseNoteCategory = 'new' | 'improvement' | 'fix';

export interface AdminReleaseNote {
  id: string;
  version: string;
  title: string;
  body: string | null;
  category: string;
  publishedAt: string | null;
  emailedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminReleaseNoteInput {
  version: string;
  title: string;
  body?: string | null;
  category?: AdminReleaseNoteCategory;
  publish?: boolean;
}

export interface ReleaseDigestResult {
  notes: number;
  recipients: number;
  sent: number;
  suppressed: number;
  failed: number;
}

export interface AdminNewsletterEvent {
  id: number;
  eventType: string;
  metadata: string | null;
  createdAt: string | null;
  subscriberId: number;
  email: string;
  templateId: number | null;
  templateName: string | null;
  templateSlug: string | null;
}

export interface AdminPrivacyRequest {
  id: number;
  userId: string | null;
  email: string;
  requestType: 'ccpa' | 'gdpr';
  status: 'pending' | 'completed' | 'closed';
  details: string | null;
  resolution: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  closedAt: string | null;
}

export interface AdminSecurityUser {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
  mfaEnabled: boolean;
  mfaEnabledAt: string | null;
  activeSessions: number;
  activeTokens: number;
}

export interface AdminSecurityDetails {
  user: { id: string; email: string; username: string | null; displayName: string | null };
  mfa: {
    enabled: boolean;
    setupPending: boolean;
    enabledAt: string | null;
    recoveryGeneratedAt: string | null;
  };
  sessions: Array<{
    id: string;
    sessionName?: string | null;
    userAgent?: string | null;
    ipAddress?: string | null;
    isActive: boolean;
    revokedAt?: string | null;
    createdAt: string;
    lastSeenAt: string;
    activeTokens: number;
  }>;
  tokens: Array<{
    jti: string;
    tokenType: 'web' | 'tenant' | 'api' | 'host';
    tenantId?: number | null;
    sessionId?: string | null;
    issuedAt: string;
    expiresAt: string;
    revokedAt?: string | null;
    userAgent?: string | null;
    ipAddress?: string | null;
    lastSeenAt: string;
    isActive: boolean;
  }>;
}

export interface AdminPlatformPersona {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  voice: string | null;
  perspective: string | null;
  decisionStyle: string | null;
  outputPrefix: string | null;
  capabilities: string[];
  tags: string[];
  source: string;
  author: string | null;
  active: boolean;
  /** JSON PsychometricProfile (Pro trait vector) compiled into behaviour at run time; null = none. */
  psychometric: PsychometricProfile | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AdminProjectGovernance {
  id: number;
  name: string;
  tenantId: number;
  tenantName: string | null;
  governance: string | null;
  updatedAt: string | null;
}

export interface ImpersonationSession {
  id: string;
  adminUserId: string;
  targetUserId: string;
  targetEmail: string;
  targetDisplayName: string | null;
  tenantId: number;
  tenantName: string;
  roleOverride: string;
  reason: string;
  tokenJti: string | null;
  startedAt: string;
  endedAt: string | null;
  expiresAt: string;
  endReason: string | null;
  pagesVisited: string[];
  writeBlockCount: number;
  debuggerEnabled: boolean;
}

export interface ImpersonationStartResult {
  session: ImpersonationSession;
  emulationToken: string;
}

export interface ImpersonationRoleSwitch {
  id: string;
  sessionId: string;
  fromRole: string;
  toRole: string;
  switchedAt: string;
}

export interface AuditLogEntry {
  id: string;
  event: string;
  actorId: string | null;
  actorEmail: string | null;
  targetUserId: string | null;
  targetEmail: string | null;
  tenantId: number | null;
  tenantName: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
}

export interface PermissionRegistryEntry {
  permission: string;
  description?: string | null;
}

export interface PermissionMatrix {
  roles: string[];
  permissions: string[];
  matrix: Record<string, string[]>;
  /**
   * Permissions backed by a real request-time gate (`requirePermission`).
   * Anything not listed is still gated by the ROLE ladder alone, so editing its
   * row changes what this screen shows and nothing else — the table labels the
   * difference rather than implying uniform control.
   *
   * Optional so an older API that predates the field degrades to "unknown"
   * instead of rendering every row as advisory.
   */
  enforced?: string[];
  overrides: Array<{
    tenantId: number | null;
    role: string;
    permission: string;
    granted: boolean;
  }>;
}

export interface PlatformModule {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  defaultEnabled: boolean;
  permissions: string[];
  createdAt: string;
}

export interface UserWorkspace {
  tenantId: number;
  name: string;
  slug: string;
  role: string;
  joinedAt: string | null;
}

export interface TenantMember {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
  role: string;
  isActive: boolean;
  joinedAt: string;
}

export interface EffectivePermissions {
  userId: string;
  tenantId: number;
  role: string;
  permissions: string[];
  rolePermissions: string[];
  modulePermissions: string[];
  userGrants: string[];
  userRevocations: string[];
}

// ---------------------------------------------------------------------------
// Request helper — uses Web token only
// ---------------------------------------------------------------------------

/**
 * Superadmin endpoints run on the WEB token (a platform operator is not acting
 * inside any one workspace), so this is `apiRequest` in `web` auth mode — not a
 * separate transport. The only extra behaviour is the friendlier "sign in with a
 * superadmin account" message when no token is stored at all.
 */
async function adminRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  if (!getStoredWebToken()) throw new Error('Not authenticated. Sign in with a superadmin account.');
  return apiRequest<T>(path, { ...opts, auth: 'web' });
}

// ---------------------------------------------------------------------------
// Admin API
// ---------------------------------------------------------------------------

export const adminApi = {
  /**
   * Cross-tenant product feedback — the dogfooding inbox. Returns the SAME row
   * shape as the tenant-side queue (`feedbackApi.queue`), so both render through
   * one <FeedbackTriage> component.
   */
  async feedback(params: { tenantId?: number | null; status?: FeedbackStatus | null; limit?: number } = {}): Promise<FeedbackQueue> {
    const q = new URLSearchParams();
    if (params.tenantId != null) q.set('tenantId', String(params.tenantId));
    if (params.status) q.set('status', params.status);
    if (params.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return adminRequest<FeedbackQueue>(`/api/admin/feedback${qs ? `?${qs}` : ''}`);
  },

  /** Superadmin review — runs through the same engine as tenant-side triage. */
  async reviewFeedback(id: string, tenantId: number, decision: 'approved' | 'declined'): Promise<{ ok: true; taskId: number | null }> {
    return adminRequest(`/api/admin/feedback/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ tenantId, decision }),
    });
  },

  async users(): Promise<AdminUser[]> {
    const res = await adminRequest<{ users: AdminUser[] }>('/api/admin/users');
    return res.users;
  },

  async guestSessions(): Promise<AdminGuestSessionsPage> {
    return adminRequest<AdminGuestSessionsPage>('/api/admin/guest-sessions');
  },

  /** One visitor's prompts, newest first. */
  async guestPrompts(visitorId: string): Promise<AdminGuestPrompt[]> {
    const res = await adminRequest<{ prompts: AdminGuestPrompt[] }>(
      `/api/admin/guest-sessions/${encodeURIComponent(visitorId)}`,
    );
    return res.prompts;
  },

  /** Erase everything a visitor typed. Personal data keyed by an opaque visitor
   *  id, which no account deletion would ever reach — so this is the actioning
   *  half of a privacy request that names one. Returns how many rows went. */
  async forgetGuestPrompts(visitorId: string): Promise<number> {
    const res = await adminRequest<{ erased: number }>(
      `/api/admin/guest-sessions/${encodeURIComponent(visitorId)}/prompts`,
      { method: 'DELETE' },
    );
    return res.erased;
  },

  // ── Platform broadcasts ──────────────────────────────────────────────────
  //
  // The channel to visitors who have no workspace to reach them through. Writes
  // publish immediately: the server drops its delivery caches and pushes one
  // frame to the shared relay room, so an open tab shows the banner rather than
  // waiting for the next page load.

  async broadcasts(): Promise<AdminBroadcastPage> {
    return adminRequest<AdminBroadcastPage>('/api/admin/broadcasts');
  },

  async createBroadcast(input: AdminBroadcastInput): Promise<AdminBroadcast> {
    const res = await adminRequest<{ broadcast: AdminBroadcast }>('/api/admin/broadcasts', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return res.broadcast;
  },

  async updateBroadcast(id: number, patch: AdminBroadcastInput): Promise<void> {
    await adminRequest(`/api/admin/broadcasts/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  },

  async deleteBroadcast(id: number): Promise<void> {
    await adminRequest(`/api/admin/broadcasts/${id}`, { method: 'DELETE' });
  },

  async creationSessions(): Promise<AdminCreationSession[]> {
    const res = await adminRequest<{ sessions: AdminCreationSession[] }>('/api/admin/creation-sessions');
    return res.sessions;
  },

  async outcomeMetrics(filters: { days?: number; tenantId?: number; projectId?: number } = {}): Promise<AdminOutcomeRollup> {
    const params = new URLSearchParams();
    if (filters.days) params.set('days', String(filters.days));
    if (filters.tenantId) params.set('tenantId', String(filters.tenantId));
    if (filters.projectId) params.set('projectId', String(filters.projectId));
    const query = params.toString();
    return adminRequest<AdminOutcomeRollup>(`/api/admin/outcome-metrics${query ? `?${query}` : ''}`);
  },

  // Demo-account conversion funnel + book-a-demo pipeline (migration 0360).
  async demoFunnel(): Promise<AdminDemoFunnel> {
    return adminRequest<AdminDemoFunnel>('/api/admin/demo/funnel');
  },
  async salesLeads(status?: SalesLeadStatus): Promise<AdminSalesLead[]> {
    const qs = status ? `?status=${status}` : '';
    const res = await adminRequest<{ leads: AdminSalesLead[] }>(`/api/admin/sales-leads${qs}`);
    return res.leads;
  },
  async updateSalesLead(id: string, status: SalesLeadStatus): Promise<void> {
    await adminRequest(`/api/admin/sales-leads/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
  },

  async tenants(): Promise<AdminTenant[]> {
    const res = await adminRequest<{ tenants: AdminTenant[] }>('/api/admin/tenants');
    return res.tenants ?? [];
  },

  async tenantMembers(tenantId: number): Promise<TenantMember[]> {
    const res = await adminRequest<{ members: TenantMember[] }>(`/api/admin/tenants/${tenantId}/members`);
    return res.members;
  },

  /**
   * Set / clear the superadmin override on the daily token cap.
   *   null → revert to plan default
   *   -1   → unlimited
   *   >= 0 → use this value as the daily token cap
   */
  async setTenantTokenLimitOverride(
    tenantId: number,
    tokenDailyLimitOverride: number | null,
  ): Promise<{ id: number; tokenDailyLimitOverride: number | null }> {
    return adminRequest<{ id: number; tokenDailyLimitOverride: number | null }>(
      `/api/admin/tenants/${tenantId}/token-limit-override`,
      {
        method: 'PATCH',
        body: JSON.stringify({ tokenDailyLimitOverride }),
      },
    );
  },

  /**
   * Set / clear the per-tenant funded paid-overflow daily cap (millicents).
   *   null → revert to plan default (free $0.50/day; pro/teams unlimited)
   *   -1   → unlimited
   *   >= 0 → explicit millicents/day ceiling
   */
  async setTenantPaidOverflowCap(
    tenantId: number,
    paidOverflowDailyCap: number | null,
  ): Promise<{ id: number; paidOverflowDailyCap: number | null }> {
    return adminRequest<{ id: number; paidOverflowDailyCap: number | null }>(
      `/api/admin/tenants/${tenantId}/paid-overflow-cap`,
      {
        method: 'PATCH',
        body: JSON.stringify({ paidOverflowDailyCap }),
      },
    );
  },

  /**
   * Set / clear the per-tenant daily image-generation credit limit.
   *   null → revert to plan default · -1 → unlimited · >= 0 → explicit images/day
   */
  async setTenantImageCreditsLimit(
    tenantId: number,
    imageCreditsDailyLimit: number | null,
  ): Promise<{ id: number; imageCreditsDailyLimit: number | null }> {
    return adminRequest<{ id: number; imageCreditsDailyLimit: number | null }>(
      `/api/admin/tenants/${tenantId}/image-credits-limit`,
      {
        method: 'PATCH',
        body: JSON.stringify({ imageCreditsDailyLimit }),
      },
    );
  },

  /**
   * Set / clear the superadmin premium-routing override.
   *   true  → tenant routes through PREMIUM-tier models + extended vendor timeout
   *   false → tenant routes through their plan default
   */
  async setTenantPremiumOverride(
    tenantId: number,
    premiumOverride: boolean,
  ): Promise<{ id: number; premiumOverride: boolean }> {
    return adminRequest<{ id: number; premiumOverride: boolean }>(
      `/api/admin/tenants/${tenantId}/premium-override`,
      {
        method: 'PATCH',
        body: JSON.stringify({ premiumOverride }),
      },
    );
  },

  async health(): Promise<AdminHealth> {
    return adminRequest<AdminHealth>('/api/admin/health');
  },

  async systemHealth(): Promise<AdminSystemHealth> {
    return adminRequest<AdminSystemHealth>('/api/admin/system-health');
  },

  async systemMaintenance(input: {
    action: 'purge_expired' | 'vacuum_analyze';
    target?: 'primary' | 'transactional';
    table?: string;
  }): Promise<{ ok: boolean }> {
    return adminRequest('/api/admin/system-health/maintenance', {
      method: 'POST', body: JSON.stringify(input),
    });
  },

  /** Scheduled sweeps + the live KV work-gate decision. */
  async cronState(): Promise<AdminCronState> {
    return adminRequest<AdminCronState>('/api/admin/cron');
  },

  async discountCodes(): Promise<AdminDiscountCode[]> {
    const res = await adminRequest<{ discountCodes: AdminDiscountCode[] }>('/api/admin/discount-codes');
    return res.discountCodes ?? [];
  },

  async createDiscountCode(input: Omit<AdminDiscountCode, 'id' | 'redemptionCount' | 'redeemedCount' | 'createdAt' | 'updatedAt'>): Promise<AdminDiscountCode> {
    const res = await adminRequest<{ discountCode: AdminDiscountCode }>('/api/admin/discount-codes', {
      method: 'POST', body: JSON.stringify(input),
    });
    return res.discountCode;
  },

  async updateDiscountCode(id: string, input: Partial<Pick<AdminDiscountCode, 'code' | 'percentOff' | 'applicablePlan' | 'billingCycle' | 'durationYears' | 'isActive'>>): Promise<AdminDiscountCode> {
    const res = await adminRequest<{ discountCode: AdminDiscountCode }>(`/api/admin/discount-codes/${id}`, {
      method: 'PATCH', body: JSON.stringify(input),
    });
    return res.discountCode;
  },

  /** Enable or pause one registered sweep platform-wide. */
  async cronSetEnabled(key: string, enabled: boolean): Promise<{ key: string; enabled: boolean }> {
    return adminRequest(`/api/admin/cron/${encodeURIComponent(key)}`, {
      method: 'PATCH', body: JSON.stringify({ enabled }),
    });
  },

  /**
   * Force-run scheduled work now. `target` is a sweep key, a cadence group, or
   * 'all'. `timeoutMs` bounds how long the RESPONSE waits per sweep — a slower
   * sweep keeps running server-side and is reported `timedOut`, never cancelled.
   */
  async cronRun(target: string, timeoutMs?: number): Promise<AdminCronRunResult> {
    return adminRequest<AdminCronRunResult>(`/api/admin/cron/${encodeURIComponent(target)}`, {
      method: 'POST',
      body: JSON.stringify(timeoutMs ? { timeoutMs } : {}),
    });
  },

  /** Set the KV pending-work flag so the NEXT real cron tick runs the fan-out. */
  async cronSignal(): Promise<{ ok: boolean; gate: { wouldRun: boolean; reason: string } }> {
    return adminRequest('/api/admin/cron/signal', { method: 'POST', body: JSON.stringify({}) });
  },

  /** Filtered page of the platform error log, plus its answer-first rollup. */
  async errors(filters: AdminErrorFilters = {}): Promise<AdminErrorPage> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    const query = params.toString();
    return adminRequest<AdminErrorPage>(`/api/admin/errors${query ? `?${query}` : ''}`);
  },

  /** One error-log entry with its full stack trace. */
  async errorDetail(id: number): Promise<AdminError> {
    const res = await adminRequest<{ error: AdminError }>(`/api/admin/errors/${id}`);
    return res.error;
  },

  /** Provider-rejected outbound mail, newest first. */
  async emailDeliveryFailures(params: { q?: string; deliveryType?: string; limit?: number; offset?: number } = {}): Promise<AdminEmailDeliveryFailurePage> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') query.set(key, String(value));
    }
    const suffix = query.toString();
    return adminRequest<AdminEmailDeliveryFailurePage>(`/api/admin/email-delivery-failures${suffix ? `?${suffix}` : ''}`);
  },

  /** Platform-wide historical trends (growth / LLM usage / errors) for the
   *  superadmin Health/Usage charts. */
  async platformRollup(days = 30): Promise<AdminPlatformRollup> {
    return adminRequest<AdminPlatformRollup>(`/api/admin/platform-rollup?days=${days}`);
  },

  async listLlmTraces(params: {
    q?: string; tenantId?: number; model?: string; success?: boolean;
    outcome?: string; days?: number; limit?: number; page?: number;
  } = {}): Promise<{ traces: AdminLlmTraceSummary[]; page: number; limit: number; days: number }> {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.tenantId != null) qs.set('tenantId', String(params.tenantId));
    if (params.model) qs.set('model', params.model);
    if (params.success != null) qs.set('success', String(params.success));
    if (params.outcome) qs.set('outcome', params.outcome);
    if (params.days != null) qs.set('days', String(params.days));
    if (params.limit != null) qs.set('limit', String(params.limit));
    if (params.page != null) qs.set('page', String(params.page));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return adminRequest(`/api/admin/llm/traces${suffix}`);
  },

  async getLlmTrace(traceId: string): Promise<{ trace: AdminLlmTraceDetail }> {
    return adminRequest(`/api/admin/llm/traces/${encodeURIComponent(traceId)}`);
  },

  async impersonate(userId: string, tenantId: number): Promise<{
    token: string;
    email: string;
    tenantId: number;
    role: string;
    expiresIn?: number;
  }> {
    return adminRequest('/api/admin/impersonate', {
      method: 'POST',
      body: JSON.stringify({ userId, tenantId }),
    });
  },

  async llmUsage(days = 30): Promise<LlmUsageStats> {
    return adminRequest<LlmUsageStats>(`/api/admin/llm-usage?days=${days}`);
  },

  async llmHealthLatest(): Promise<VendorHealthRow[]> {
    const res = await adminRequest<{ vendors: VendorHealthRow[] }>('/api/admin/llm-health');
    return res.vendors;
  },

  async probeVendorHealth(vendor: VendorId): Promise<VendorHealthSnapshot> {
    return adminRequest<VendorHealthSnapshot>(`/api/admin/llm-health/${vendor}`, {
      method: 'POST',
    });
  },

  // Legal
  async legalCurrent(): Promise<AdminLegalCurrent> {
    return adminRequest<AdminLegalCurrent>('/api/admin/legal/current');
  },
  /** Full publish + amend audit trail (newest first); scope with docType. */
  async legalHistory(docType?: 'terms' | 'privacy'): Promise<LegalDocVersion[]> {
    const qs = docType ? `?docType=${docType}` : '';
    const res = await adminRequest<{ versions: LegalDocVersion[] }>(`/api/admin/legal/history${qs}`);
    return res.versions;
  },
  async publishLegal(
    docType: 'terms' | 'privacy',
    data: { version: string; title?: string; content: string },
  ): Promise<{ document: LegalDocument }> {
    return adminRequest(`/api/admin/legal/${docType}/publish`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  async amendLegal(
    docType: 'terms' | 'privacy',
    data: { version?: string; title?: string; content: string },
  ): Promise<{ document: LegalDocument }> {
    return adminRequest(`/api/admin/legal/${docType}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },
  /** AI-draft or improve a legal document; returns clean Markdown (nothing is saved). */
  async enhanceLegal(
    docType: 'terms' | 'privacy',
    data: { content: string; instruction?: string; title?: string },
  ): Promise<{ content: string }> {
    return adminRequest(`/api/admin/legal/${docType}/enhance`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Newsletter
  async newsletterSubscribers(params?: {
    status?: 'subscribed' | 'unsubscribed' | 'suppressed';
    q?: string;
    limit?: number;
  }): Promise<AdminNewsletterSubscriber[]> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.q) query.set('q', params.q);
    if (params?.limit) query.set('limit', String(params.limit));
    const suffix = query.toString();
    const res = await adminRequest<{ subscribers: AdminNewsletterSubscriber[] }>(
      `/api/admin/newsletter/subscribers${suffix ? `?${suffix}` : ''}`
    );
    return res.subscribers;
  },
  async newsletterTemplates(): Promise<AdminNewsletterTemplate[]> {
    const res = await adminRequest<{ templates: AdminNewsletterTemplate[] }>('/api/admin/newsletter/templates');
    return res.templates;
  },
  async createNewsletterTemplate(data: {
    name: string;
    slug?: string;
    subject: string;
    preheader?: string;
    bodyMarkdown: string;
    isActive?: boolean;
  }): Promise<{ template: AdminNewsletterTemplate }> {
    return adminRequest('/api/admin/newsletter/templates', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  async updateNewsletterTemplate(
    id: number,
    data: Partial<Pick<AdminNewsletterTemplate, 'name' | 'slug' | 'subject' | 'preheader' | 'bodyMarkdown' | 'isActive'>>
  ): Promise<{ template: AdminNewsletterTemplate }> {
    return adminRequest(`/api/admin/newsletter/templates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },
  async newsletterEvents(limit = 300): Promise<AdminNewsletterEvent[]> {
    const res = await adminRequest<{ events: AdminNewsletterEvent[] }>(
      `/api/admin/newsletter/events?limit=${Math.min(limit, 1000)}`
    );
    return res.events;
  },
  async trackNewsletterEvent(data: {
    subscriberEmail: string;
    templateId?: number | null;
    eventType: 'template_sent' | 'email_opened' | 'email_clicked';
    metadata?: string;
  }): Promise<{ ok: boolean }> {
    return adminRequest('/api/admin/newsletter/events', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Release notes — the platform changelog marketed to users (footer "What's new"
  // panel + weekly digest). Authoring is superadmin-only; the public GET is separate.
  async releaseNotes(): Promise<AdminReleaseNote[]> {
    const res = await adminRequest<{ releaseNotes: AdminReleaseNote[] }>('/api/release-notes/admin');
    return res.releaseNotes;
  },
  async createReleaseNote(data: AdminReleaseNoteInput): Promise<{ releaseNote: AdminReleaseNote }> {
    return adminRequest('/api/release-notes', { method: 'POST', body: JSON.stringify(data) });
  },
  async updateReleaseNote(id: string, data: Partial<AdminReleaseNoteInput>): Promise<{ releaseNote: AdminReleaseNote }> {
    return adminRequest(`/api/release-notes/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  async deleteReleaseNote(id: string): Promise<{ ok: boolean }> {
    return adminRequest(`/api/release-notes/${id}`, { method: 'DELETE' });
  },
  async sendReleaseDigest(): Promise<{ result: ReleaseDigestResult }> {
    return adminRequest('/api/release-notes/send-digest', { method: 'POST' });
  },
  /** Manually email ONE published note now; it then drops out of the weekly digest. */
  async sendReleaseNote(id: string): Promise<{ result: ReleaseDigestResult }> {
    return adminRequest(`/api/release-notes/${id}/send`, { method: 'POST' });
  },

  // Privacy
  async privacyRequests(params?: {
    status?: string;
    type?: string;
    q?: string;
    limit?: number;
  }): Promise<AdminPrivacyRequest[]> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.type) query.set('type', params.type);
    if (params?.q) query.set('q', params.q);
    if (params?.limit) query.set('limit', String(params.limit));
    const suffix = query.toString();
    const res = await adminRequest<{ requests: AdminPrivacyRequest[] }>(
      `/api/admin/privacy-requests${suffix ? `?${suffix}` : ''}`
    );
    return res.requests;
  },
  async updatePrivacyRequest(
    id: number,
    data: { status?: string; resolution?: string | null }
  ): Promise<{ request: AdminPrivacyRequest }> {
    return adminRequest(`/api/admin/privacy-requests/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  // Security
  async securityUsers(tenantId: number): Promise<AdminSecurityUser[]> {
    const res = await adminRequest<{ users: AdminSecurityUser[] }>(
      `/api/admin/security/users?tenantId=${tenantId}`
    );
    return res.users;
  },
  async securityDetails(tenantId: number, userId: string): Promise<AdminSecurityDetails> {
    return adminRequest<AdminSecurityDetails>(
      `/api/admin/security/users/${encodeURIComponent(userId)}?tenantId=${tenantId}`
    );
  },
  async securityMfaSetup(tenantId: number, userId: string): Promise<{
    otpauthUrl: string;
    manualEntryKey: string;
    expiresIn: number;
  }> {
    return adminRequest(`/api/admin/security/users/${encodeURIComponent(userId)}/mfa/setup?tenantId=${tenantId}`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },
  async securityMfaEnable(
    tenantId: number,
    userId: string,
    code: string
  ): Promise<{ enabled: boolean; recoveryCodes: string[] }> {
    return adminRequest(
      `/api/admin/security/users/${encodeURIComponent(userId)}/mfa/enable?tenantId=${tenantId}`,
      { method: 'POST', body: JSON.stringify({ code }) }
    );
  },
  async securityMfaDisable(
    tenantId: number,
    userId: string,
    data: { code?: string; recoveryCode?: string }
  ): Promise<{ enabled: boolean }> {
    return adminRequest(
      `/api/admin/security/users/${encodeURIComponent(userId)}/mfa/disable?tenantId=${tenantId}`,
      { method: 'POST', body: JSON.stringify(data) }
    );
  },
  async securityRegenerateRecoveryCodes(
    tenantId: number,
    userId: string,
    data: { code?: string; recoveryCode?: string }
  ): Promise<{ recoveryCodes: string[] }> {
    return adminRequest(
      `/api/admin/security/users/${encodeURIComponent(userId)}/mfa/recovery-codes/regenerate?tenantId=${tenantId}`,
      { method: 'POST', body: JSON.stringify(data) }
    );
  },
  async securityRevokeSession(
    tenantId: number,
    userId: string,
    sessionId: string
  ): Promise<void> {
    return adminRequest(
      `/api/admin/security/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}/revoke?tenantId=${tenantId}`,
      { method: 'POST', body: JSON.stringify({}) }
    );
  },
  async securityRevokeAllSessions(tenantId: number, userId: string): Promise<void> {
    return adminRequest(
      `/api/admin/security/users/${encodeURIComponent(userId)}/sessions/revoke-all?tenantId=${tenantId}`,
      { method: 'POST', body: JSON.stringify({}) }
    );
  },
  async securityRevokeToken(
    tenantId: number,
    userId: string,
    jti: string
  ): Promise<void> {
    return adminRequest(
      `/api/admin/security/users/${encodeURIComponent(userId)}/tokens/${encodeURIComponent(jti)}/revoke?tenantId=${tenantId}`,
      { method: 'POST', body: JSON.stringify({}) }
    );
  },

  // Platform personas (admin CRUD)
  async personas(): Promise<AdminPlatformPersona[]> {
    const res = await adminRequest<{ personas: AdminPlatformPersona[] }>('/api/admin/personas');
    return res.personas;
  },
  async createPersona(data: {
    name: string;
    slug?: string;
    description?: string | null;
    voice?: string | null;
    perspective?: string | null;
    decisionStyle?: string | null;
    outputPrefix?: string | null;
    capabilities?: string[];
    tags?: string[];
    source?: string;
    author?: string | null;
    active?: boolean;
    psychometric?: PsychometricProfile | null;
  }): Promise<{ persona: AdminPlatformPersona }> {
    return adminRequest('/api/admin/personas', { method: 'POST', body: JSON.stringify(data) });
  },
  async updatePersona(
    id: number,
    data: Partial<{
      name: string;
      slug: string;
      description: string | null;
      voice: string | null;
      perspective: string | null;
      decisionStyle: string | null;
      outputPrefix: string | null;
      capabilities: string[];
      tags: string[];
      source: string;
      author: string | null;
      active: boolean;
      psychometric: PsychometricProfile | null;
    }>
  ): Promise<{ persona: AdminPlatformPersona }> {
    return adminRequest(`/api/admin/personas/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },
  async deletePersona(id: number): Promise<void> {
    await adminRequest(`/api/admin/personas/${id}`, { method: 'DELETE' });
  },

  // Admin projects (Governance tab — list all, update governance)
  async adminProjects(): Promise<AdminProjectGovernance[]> {
    const res = await adminRequest<{ projects: AdminProjectGovernance[] }>('/api/admin/projects');
    return res.projects;
  },
  async updateProjectGovernance(projectId: number, governance: string | null): Promise<{ project: { id: number; name: string; governance: string | null } }> {
    return adminRequest(`/api/admin/projects/${projectId}/governance`, {
      method: 'PATCH',
      body: JSON.stringify({ governance }),
    });
  },

  async userWorkspaces(userId: string): Promise<UserWorkspace[]> {
    const res = await adminRequest<{ workspaces: UserWorkspace[] }>(`/api/admin/users/${encodeURIComponent(userId)}/workspaces`);
    return res.workspaces;
  },

  // Impersonation
  async impersonationStart(
    userId: string,
    tenantId: number,
    reason: string,
    debuggerEnabled = false,
  ): Promise<ImpersonationStartResult> {
    return adminRequest('/api/admin/impersonation/start', {
      method: 'POST',
      body: JSON.stringify({ userId, tenantId, reason, debuggerEnabled }),
    });
  },

  async impersonationEnd(sessionId: string): Promise<void> {
    return adminRequest(`/api/admin/impersonation/${encodeURIComponent(sessionId)}/end`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  async impersonationSwitchRole(
    sessionId: string,
    newRole: string,
  ): Promise<{ emulationToken: string; session: ImpersonationSession }> {
    return adminRequest(`/api/admin/impersonation/${encodeURIComponent(sessionId)}/switch-role`, {
      method: 'POST',
      body: JSON.stringify({ newRole }),
    });
  },

  async impersonationActive(): Promise<ImpersonationSession | null> {
    const res = await adminRequest<{ session: ImpersonationSession | null }>('/api/admin/impersonation/active');
    return res.session;
  },

  async impersonationList(params?: {
    limit?: number;
    offset?: number;
  }): Promise<{ sessions: ImpersonationSession[]; total: number }> {
    const q = new URLSearchParams();
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.offset) q.set('offset', String(params.offset));
    const suffix = q.toString();
    return adminRequest(`/api/admin/impersonation${suffix ? `?${suffix}` : ''}`);
  },

  async impersonationDetail(sessionId: string): Promise<{
    session: ImpersonationSession;
    roleSwitches: ImpersonationRoleSwitch[];
  }> {
    return adminRequest(`/api/admin/impersonation/${encodeURIComponent(sessionId)}`);
  },

  // Permissions
  async permissionsRegistry(): Promise<PermissionRegistryEntry[]> {
    const res = await adminRequest<{ permissions: PermissionRegistryEntry[] }>('/api/admin/permissions');
    return res.permissions;
  },

  async permissionsMatrix(): Promise<PermissionMatrix> {
    return adminRequest<PermissionMatrix>('/api/admin/permissions/matrix');
  },

  async updateRolePermissions(
    role: string,
    overrides: Array<{ permission: string; granted: boolean }>,
    tenantId?: number,
  ): Promise<void> {
    await adminRequest(`/api/admin/permissions/roles/${encodeURIComponent(role)}`, {
      method: 'PUT',
      body: JSON.stringify({ overrides, tenantId }),
    });
  },

  async permissionsMatrixExport(): Promise<string> {
    if (!getStoredWebToken()) throw new Error('Not authenticated.');
    return apiRequestText('/api/admin/permissions/matrix/export', { auth: 'web' });
  },

  // Modules
  async modules(): Promise<PlatformModule[]> {
    const res = await adminRequest<{ modules: PlatformModule[] }>('/api/admin/modules');
    return res.modules;
  },

  async createModule(data: {
    name: string;
    slug?: string;
    description?: string | null;
    defaultEnabled?: boolean;
    permissions?: string[];
  }): Promise<{ module: PlatformModule }> {
    return adminRequest('/api/admin/modules', { method: 'POST', body: JSON.stringify(data) });
  },

  async updateModule(
    id: number,
    data: Partial<Pick<PlatformModule, 'name' | 'description' | 'defaultEnabled' | 'permissions'>>,
  ): Promise<{ module: PlatformModule }> {
    return adminRequest(`/api/admin/modules/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },

  async deleteModule(id: number): Promise<void> {
    await adminRequest(`/api/admin/modules/${id}`, { method: 'DELETE' });
  },

  async assignMemberModule(tenantId: number, userId: string, moduleId: number): Promise<void> {
    await adminRequest(
      `/api/admin/tenants/${tenantId}/members/${encodeURIComponent(userId)}/modules`,
      { method: 'POST', body: JSON.stringify({ moduleId }) },
    );
  },

  async removeMemberModule(tenantId: number, userId: string, moduleId: number): Promise<void> {
    await adminRequest(
      `/api/admin/tenants/${tenantId}/members/${encodeURIComponent(userId)}/modules/${moduleId}`,
      { method: 'DELETE' },
    );
  },

  // User management
  async forceLogout(userId: string): Promise<void> {
    await adminRequest(`/api/admin/users/${encodeURIComponent(userId)}/force-logout`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  async resetPassword(userId: string): Promise<void> {
    await adminRequest(`/api/admin/users/${encodeURIComponent(userId)}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  async setUserStatus(userId: string, suspended: boolean): Promise<void> {
    await adminRequest(`/api/admin/users/${encodeURIComponent(userId)}/status`, {
      method: 'PUT',
      body: JSON.stringify({ suspended }),
    });
  },

  async updateUserPermissions(
    userId: string,
    data: { grants: string[]; revocations: string[]; tenantId?: number },
  ): Promise<void> {
    await adminRequest(`/api/admin/users/${encodeURIComponent(userId)}/permissions`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async overrideMemberRole(tenantId: number, userId: string, role: string): Promise<void> {
    await adminRequest(
      `/api/admin/tenants/${tenantId}/members/${encodeURIComponent(userId)}/role`,
      { method: 'PATCH', body: JSON.stringify({ role }) },
    );
  },

  async effectivePermissions(userId: string, tenantId: number): Promise<EffectivePermissions> {
    const res = await adminRequest<Partial<EffectivePermissions> & { effectivePermissions?: unknown }>(
      `/api/admin/users/${encodeURIComponent(userId)}/effective-permissions?tenantId=${tenantId}`,
    );
    const strings = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

    return {
      userId: typeof res.userId === 'string' ? res.userId : userId,
      tenantId: typeof res.tenantId === 'number' ? res.tenantId : tenantId,
      role: typeof res.role === 'string' ? res.role : '',
      // The API historically named this field `effectivePermissions`. Accept it
      // so a new frontend remains compatible while API workers roll forward.
      permissions: strings(res.permissions ?? res.effectivePermissions),
      rolePermissions: strings(res.rolePermissions),
      modulePermissions: strings(res.modulePermissions),
      userGrants: strings(res.userGrants),
      userRevocations: strings(res.userRevocations),
    };
  },

  async userAdminAccess(userId: string): Promise<{ sessions: ImpersonationSession[] }> {
    return adminRequest(`/api/admin/users/${encodeURIComponent(userId)}/admin-access`);
  },

  async auditLog(params?: {
    event?: string;
    actorId?: string;
    targetUserId?: string;
    tenantId?: number;
    limit?: number;
    offset?: number;
  }): Promise<{ entries: AuditLogEntry[]; total: number }> {
    const q = new URLSearchParams();
    if (params?.event) q.set('event', params.event);
    if (params?.actorId) q.set('actorId', params.actorId);
    if (params?.targetUserId) q.set('targetUserId', params.targetUserId);
    if (params?.tenantId) q.set('tenantId', String(params.tenantId));
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.offset) q.set('offset', String(params.offset));
    const suffix = q.toString();
    return adminRequest(`/api/admin/audit-log${suffix ? `?${suffix}` : ''}`);
  },

  async auditLogExport(params?: {
    event?: string;
    actorId?: string;
    targetUserId?: string;
    tenantId?: number;
  }): Promise<string> {
    const webToken = getStoredWebToken();
    if (!webToken) throw new Error('Not authenticated.');
    const q = new URLSearchParams();
    if (params?.event) q.set('event', params.event);
    if (params?.actorId) q.set('actorId', params.actorId);
    if (params?.targetUserId) q.set('targetUserId', params.targetUserId);
    if (params?.tenantId) q.set('tenantId', String(params.tenantId));
    const suffix = q.toString();
    return apiRequestText(
      `/api/admin/audit-log/export${suffix ? `?${suffix}` : ''}`,
      { auth: 'web' },
    );
  },

  // ─── Tenant API keys (bfk_*) — superadmin mint-on-behalf ─────────────────

  async listTenantApiKeys(tenantId: number): Promise<AdminTenantApiKey[]> {
    const res = await adminRequest<{ keys: AdminTenantApiKey[] }>(`/api/admin/tenants/${tenantId}/api-keys`);
    return res.keys ?? [];
  },

  async mintTenantApiKey(tenantId: number, input: { name: string; allowedOrigins?: string[] | null }): Promise<AdminMintedTenantApiKey> {
    return adminRequest<AdminMintedTenantApiKey>(`/api/admin/tenants/${tenantId}/api-keys`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async updateTenantApiKey(
    tenantId: number,
    keyId: string,
    patch: { name?: string; allowedOrigins?: string[] | null },
  ): Promise<AdminTenantApiKey> {
    const res = await adminRequest<{ key: AdminTenantApiKey }>(`/api/admin/tenants/${tenantId}/api-keys/${keyId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    return res.key;
  },

  async revokeTenantApiKey(tenantId: number, keyId: string): Promise<void> {
    await adminRequest(`/api/admin/tenants/${tenantId}/api-keys/${keyId}`, { method: 'DELETE' });
  },

  async tenantApiKeyUsage(
    tenantId: number,
    keyId: string,
    params?: { days?: number; page?: number; limit?: number },
  ): Promise<AdminTenantApiKeyUsageResult> {
    const q = new URLSearchParams();
    if (params?.days  != null) q.set('days',  String(params.days));
    if (params?.page  != null) q.set('page',  String(params.page));
    if (params?.limit != null) q.set('limit', String(params.limit));
    const suffix = q.toString();
    return adminRequest<AdminTenantApiKeyUsageResult>(
      `/api/admin/tenants/${tenantId}/api-keys/${keyId}/usage${suffix ? `?${suffix}` : ''}`,
    );
  },
};

export interface AdminTenantApiKeyUsageRow {
  id: number;
  createdAt: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  retries: number;
  streamed: boolean;
  useCase: string | null;
  metadata: Record<string, unknown> | null;
  idempotencyKey: string | null;
  userId: string | null;
}

export interface AdminTenantApiKeyUsageResult {
  summary: { total: number; totalTokens: number; modelCount: number };
  rows: AdminTenantApiKeyUsageRow[];
  days: number;
  page: number;
  limit: number;
}

export interface AdminTenantApiKey {
  id: string;
  name: string;
  createdByUserId: string | null;
  allowedOrigins: string[] | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface AdminMintedTenantApiKey {
  key: string;
  id: string;
  name: string;
  allowedOrigins: string[] | null;
  createdAt: string;
}
