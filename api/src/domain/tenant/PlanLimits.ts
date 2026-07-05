import { TenantPlan } from '../shared/types';

/**
 * Hard limits enforced per plan.
 *
 * These are the authoritative values — reference them everywhere limits are
 * checked (API guards, quota warnings, frontend display). Do not duplicate
 * these numbers inline.
 */
export interface PlanLimits {
  /** Maximum number of registered AgentHosts (0 = blocked, -1 = unlimited) */
  maxAgentHosts: number;
  /** Maximum number of projects */
  maxProjects: number;
  /** Maximum number of active seats (team members); -1 = unlimited */
  maxSeats: number;
  /** Token budget per calendar day (input + output combined). CHAT/text only —
   *  image generation is metered separately against {@link imageCreditsDailyLimit}
   *  so heavy image use can't starve the text budget (and vice-versa). */
  tokenDailyLimit: number;
  /**
   * Monthly AI-token allowance surfaced by the sidebar consumption meter
   * (`GET /api/consumption`). This is the "50K free / mo"-style number every
   * member sees; -1 = unlimited. The daily limit ({@link tokenDailyLimit}) is the
   * burst guard; this is the headline monthly quota the meter fills against.
   */
  tokenMonthlyLimit: number;
  /**
   * Monthly data-ingestion allowance in BYTES, surfaced by the consumption meter
   * as its second meter ("Data ingestion"); -1 = unlimited. Meters data PROCESSED
   * through system integrations (repo content imports) — the real cost driver of
   * "link 100 repos" — so free-vs-paid caps processing volume, NOT object count
   * or visibility. Filled against the ingestion ledger (ingestion_usage_log).
   */
  ingestionMonthlyBytes: number;
  /**
   * Monthly error-event allowance (COUNT of ingested error events), surfaced by the
   * consumption meter as "Error events"; -1 = unlimited. Meters the Quality pillar's
   * inbound volume (SDK / OTLP / Sentry-PostHog-LogRocket webhooks) so free-vs-paid
   * caps high-cardinality telemetry. Filled against error_events
   * (application/quality/errorEventsLedger.ts).
   */
  errorEventsMonthly: number;
  /**
   * Monthly outbound-fetch allowance (COUNT of Brain `/fetch-url` requests that
   * hit the wire), surfaced by the consumption meter as "Outbound fetches"; -1 =
   * unlimited. Meters the arbitrary-URL GET proxy so free-vs-paid caps sustained
   * outbound volume (the per-tenant rate limit caps burst). Filled against
   * outbound_fetch_log (application/web/outboundFetchLedger.ts).
   */
  outboundFetchesMonthly: number;
  /**
   * Monthly cloud-agent RUN allowance (COUNT of distinct cloud executions),
   * surfaced by the consumption meter as "Cloud runs"; -1 = unlimited. This is the
   * platform-COMPUTE meter: a cloud run executes on our infra even when the tenant
   * brings their own model (BYO tokens are $0 to us but the orchestration isn't),
   * so free-vs-paid caps cloud usage independently of token volume. On-prem / VSIX
   * runs execute on the user's machine and never consume this. Filled by counting
   * distinct `execution_id` on cloud-surface usage rows
   * (application/runtime/cloudRunLedger.ts).
   */
  cloudRunsMonthly: number;
  /** Image-generation credits per calendar day (1 credit = 1 returned image);
   *  -1 = unlimited. Independent of the text token budget. */
  imageCreditsDailyLimit: number;
  /**
   * Upper bound on a single request's `max_tokens` (output cap). Guards against
   * a misconfigured client requesting a huge generation that bills a full
   * 128K-token output in one shot. Requests above this are clamped down, not
   * rejected. -1 = no cap.
   */
  maxTokensPerRequest: number;
  /** Whether approval workflow gates are available */
  approvalWorkflows: boolean;
  /** Whether fleet mesh (agentHost-to-agentHost routing) is available */
  fleetMesh: boolean;
  /** Whether full telemetry + audit trail is available */
  fullTelemetry: boolean;
  /** Whether custom agent roles (.builderforce/agents/) are synced from Builderforce */
  customAgentRoles: boolean;
  /**
   * Whether personas can carry a psychometric profile (trait-vector personality
   * that changes how the agent reasons/executes). Pro feature.
   */
  psychometricPersona: boolean;
  /** Whether the shared team approval inbox is available */
  teamApprovalInbox: boolean;
  /** Whether per-seat cost controls are available */
  seatCostControls: boolean;
  /**
   * Whether voice cloning (enrol a cloned voice + synthesize with it) is available.
   * Any paid plan. Gated at the create/enrol path in studioVoiceCloneRoutes via the
   * shared feature gate.
   */
  voiceCloning: boolean;
}

export const PLAN_LIMITS: Record<TenantPlan, PlanLimits> = {
  [TenantPlan.FREE]: {
    maxAgentHosts: 1,
    maxProjects: 5,
    maxSeats: 1,
    tokenDailyLimit: 10_000,
    tokenMonthlyLimit: 50_000,
    ingestionMonthlyBytes: 50_000_000, // 50 MB/mo — a handful of repo imports
    errorEventsMonthly: 10_000, // 10K error events/mo
    outboundFetchesMonthly: 500, // 500 Brain URL fetches/mo
    cloudRunsMonthly: 25, // 25 cloud-agent runs/mo — enough to try it, then upgrade
    imageCreditsDailyLimit: 10,
    maxTokensPerRequest: 4_096,
    approvalWorkflows: false,
    fleetMesh: false,
    fullTelemetry: false,
    customAgentRoles: false,
    psychometricPersona: false,
    teamApprovalInbox: false,
    seatCostControls: false,
    voiceCloning: false,
  },
  [TenantPlan.PRO]: {
    maxAgentHosts: 3,
    maxProjects: -1,
    maxSeats: 1,
    tokenDailyLimit: 1_000_000,
    tokenMonthlyLimit: 5_000_000,
    ingestionMonthlyBytes: 5_000_000_000, // 5 GB/mo
    errorEventsMonthly: 1_000_000, // 1M error events/mo
    outboundFetchesMonthly: 50_000, // 50K Brain URL fetches/mo
    cloudRunsMonthly: 2_000, // 2K cloud-agent runs/mo
    imageCreditsDailyLimit: 1_000,
    maxTokensPerRequest: 16_384,
    approvalWorkflows: true,
    fleetMesh: true,
    fullTelemetry: true,
    customAgentRoles: true,
    psychometricPersona: true,
    teamApprovalInbox: false,
    seatCostControls: false,
    voiceCloning: true,
  },
  [TenantPlan.TEAMS]: {
    maxAgentHosts: -1,
    maxProjects: -1,
    maxSeats: -1,
    tokenDailyLimit: 5_000_000,
    tokenMonthlyLimit: -1,
    ingestionMonthlyBytes: -1, // unlimited
    errorEventsMonthly: -1, // unlimited
    outboundFetchesMonthly: -1, // unlimited
    cloudRunsMonthly: -1, // unlimited
    imageCreditsDailyLimit: 5_000,
    maxTokensPerRequest: 64_000,
    approvalWorkflows: true,
    fleetMesh: true,
    fullTelemetry: true,
    customAgentRoles: true,
    psychometricPersona: true,
    teamApprovalInbox: true,
    seatCostControls: true,
    voiceCloning: true,
  },
};

/**
 * Anonymous guest (logged-out) chat allowance — the "try the Brain before you
 * sign up" tier. Deliberately TINY: a logged-out visitor has no account we can
 * ban and their visitorId/IP are spoofable, so this is a taste, not a free ride.
 * Signing up unlocks the real FREE tier ({@link PLAN_LIMITS}.free — 10K
 * tokens/day). Metered per visitorId AND per source IP (the spoof backstop) —
 * see application/guest/GuestChatService. NOT part of the TenantPlan enum: a
 * guest has no tenant row, so this never flows through resolveTokenLimits.
 */
export const GUEST_CHAT_LIMITS = {
  /** Max assistant turns per visitorId per UTC day. */
  messagesDailyLimit: 5,
  /** Max assistant turns per source IP per UTC day — an abuser rotating
   *  visitorIds still hits this. Higher than the per-visitor cap so a shared
   *  office/NAT IP doesn't lock out honest visitors too soon. */
  ipMessagesDailyLimit: 25,
  /** Output-token ceiling per guest request (clamped down, never rejected). */
  maxTokensPerRequest: 700,
} as const;

/** Returns the limits for the tenant's effective plan. */
export function getLimits(plan: TenantPlan): PlanLimits {
  return PLAN_LIMITS[plan];
}

/** Returns true if adding one more agentHost is within plan limits. */
export function canAddAgentHost(plan: TenantPlan, currentAgentHostCount: number): boolean {
  const { maxAgentHosts } = getLimits(plan);
  return maxAgentHosts === -1 || currentAgentHostCount < maxAgentHosts;
}

/** Returns true if adding one more seat is within plan limits. */
export function canAddSeat(plan: TenantPlan, currentSeatCount: number): boolean {
  const { maxSeats } = getLimits(plan);
  return maxSeats === -1 || currentSeatCount < maxSeats;
}

/** Returns true if adding one more project is within plan limits. */
export function canAddProject(plan: TenantPlan, currentProjectCount: number): boolean {
  const { maxProjects } = getLimits(plan);
  return maxProjects === -1 || currentProjectCount < maxProjects;
}

/**
 * Resolve a tenant's effective text-token limits (daily + monthly) from its
 * superadmin override + plan defaults. THE single resolver — the gateway gate
 * (llmRoutes) and the consumption meter (consumptionRoutes) both call this, so
 * the cap shown equals the cap enforced. `-1` = unlimited (gate skipped).
 *
 * The override is a *daily* grant (`tokenDailyLimitOverride`); we deliberately
 * let it govern monthly too so the two never contradict:
 *   • override === -1 (or superadmin) → both unlimited.
 *   • override >= 0  → that explicit daily value, and monthly unlimited (an
 *     explicit per-tenant grant must not be undercut by the plan's monthly cap).
 *   • override null  → plan defaults for both (free monthly = the 50K meter cap;
 *     teams monthly = -1 unlimited).
 */
export interface ResolvedTokenLimits {
  /** Daily cap; -1 = unlimited. */
  dailyLimit: number;
  /** Monthly cap; -1 = unlimited. */
  monthlyLimit: number;
}

export function resolveTokenLimits(input: {
  effectivePlan: TenantPlan;
  tokenDailyLimitOverride: number | null;
  isSuperadmin?: boolean;
}): ResolvedTokenLimits {
  if (input.tokenDailyLimitOverride === -1 || input.isSuperadmin) {
    return { dailyLimit: -1, monthlyLimit: -1 };
  }
  const override = input.tokenDailyLimitOverride;
  if (override !== null && override >= 0) {
    return { dailyLimit: override, monthlyLimit: -1 };
  }
  const limits = getLimits(input.effectivePlan);
  return { dailyLimit: limits.tokenDailyLimit, monthlyLimit: limits.tokenMonthlyLimit };
}

/**
 * Resolve a tenant's effective monthly data-ingestion allowance (bytes); -1 =
 * unlimited. Mirrors {@link resolveTokenLimits} so the meter display and the
 * ingestion gate agree. A superadmin-unlimited tenant (override -1 / superadmin)
 * is unlimited across every meter; a positive *token* override does NOT lift the
 * ingestion cap (different axis), so only plan default applies otherwise.
 */
export function resolveIngestionMonthlyBytes(input: {
  effectivePlan: TenantPlan;
  tokenDailyLimitOverride: number | null;
  isSuperadmin?: boolean;
}): number {
  if (input.tokenDailyLimitOverride === -1 || input.isSuperadmin) return -1;
  return getLimits(input.effectivePlan).ingestionMonthlyBytes;
}

/**
 * Resolve a tenant's effective monthly error-event allowance (count); -1 =
 * unlimited. Mirrors {@link resolveIngestionMonthlyBytes} so the Quality meter
 * display and the error-ingest gate agree. A superadmin-unlimited tenant is
 * unlimited; a positive *token* override does not lift this (different axis).
 */
export function resolveErrorEventsMonthly(input: {
  effectivePlan: TenantPlan;
  tokenDailyLimitOverride: number | null;
  isSuperadmin?: boolean;
}): number {
  if (input.tokenDailyLimitOverride === -1 || input.isSuperadmin) return -1;
  return getLimits(input.effectivePlan).errorEventsMonthly;
}

/**
 * Resolve a tenant's effective monthly outbound-fetch allowance (count); -1 =
 * unlimited. Mirrors {@link resolveErrorEventsMonthly} so the meter display and
 * the fetch-url cap gate agree. A superadmin-unlimited tenant is unlimited; a
 * positive *token* override does not lift this (different axis).
 */
export function resolveOutboundFetchesMonthly(input: {
  effectivePlan: TenantPlan;
  tokenDailyLimitOverride: number | null;
  isSuperadmin?: boolean;
}): number {
  if (input.tokenDailyLimitOverride === -1 || input.isSuperadmin) return -1;
  return getLimits(input.effectivePlan).outboundFetchesMonthly;
}

/**
 * Resolve a tenant's effective monthly cloud-agent-run allowance (count); -1 =
 * unlimited. Mirrors {@link resolveOutboundFetchesMonthly} so the "Cloud runs"
 * meter display and the cloud-dispatch gate agree. A superadmin-unlimited tenant
 * is unlimited; a positive *token* override does not lift this (different axis —
 * compute, not tokens).
 */
export function resolveCloudRunsMonthly(input: {
  effectivePlan: TenantPlan;
  tokenDailyLimitOverride: number | null;
  isSuperadmin?: boolean;
}): number {
  if (input.tokenDailyLimitOverride === -1 || input.isSuperadmin) return -1;
  return getLimits(input.effectivePlan).cloudRunsMonthly;
}

/**
 * Resolve a tenant's effective daily image-credit limit from its per-tenant
 * override + plan default. Single source of truth so the gateway gate and any
 * display agree (mirrors `resolvePaidOverflowCapMillicents`):
 *   • override === -1   → -1 (unlimited)
 *   • override >= 0     → that explicit value
 *   • override null     → the plan default
 */
export function resolveImageCreditsDailyLimit(
  override: number | null | undefined,
  plan: TenantPlan,
): number {
  if (override === -1) return -1;
  if (override != null && override >= 0) return override;
  return getLimits(plan).imageCreditsDailyLimit;
}
