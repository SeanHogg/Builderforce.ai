import { TenantPlan } from '../shared/types';

/**
 * Hard limits enforced per plan.
 *
 * These are the authoritative values — reference them everywhere limits are
 * checked (API guards, quota warnings, frontend display). Do not duplicate
 * these numbers inline.
 */
export interface PlanLimits {
  /** Active + archived durable Creation Sessions; -1 = unlimited. */
  maxCreationSessions: number;
  /** Members (including owner) allowed in one Creation Session. */
  maxCreationSessionCollaborators: number;
  /** Private/tenant reusable Creation Session templates. */
  maxCreationSessionTemplates: number;
  /** Retained revision snapshots per Creation Session. */
  maxCreationSessionHistory: number;
  /** Rows a Canvas Dataset may profile/process in one request. */
  maxCreationDatasetRows: number;
  /** Simultaneously present editors/runners/owners in a Creation Session. */
  maxCreationRealtimeEditors: number;
  /** Stored artifact bytes attributable to one Creation Session. */
  maxCreationArtifactBytes: number;
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
   * Monthly product-feedback allowance (COUNT of accepted feedback submissions),
   * surfaced by the consumption meter as "Feedback"; -1 = unlimited. Meters the
   * Feedback pillar's inbound volume across EVERY channel — the embeddable
   * snippet, the in-app panel and the Sentry/PostHog provider webhooks — because
   * each accepted request can open a backlog ticket, which costs storage, board
   * space and a human's triage attention. The per-collector rolling-24h
   * `daily_limit` is an ABUSE ceiling on one key; this is the plan-scoped,
   * month-to-date quota. Filled against feedback_submissions
   * (application/feedback/feedbackLedger.ts).
   */
  feedbackSubmissionsMonthly: number;
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
  /**
   * Monthly Stage Sandbox allowance (COUNT of dispatched disposable-container
   * runs), surfaced by the consumption meter as "Sandbox runs"; -1 = unlimited.
   * A run is dispatched at most once per Stage press per unique build (the
   * payload hash dedupes re-stages of an unchanged board), and only for
   * `runtime`/`media` listings — the two harnesses a container can drive.
   * Below `cloudRunsMonthly` on purpose: a container-second is dearer than an
   * LLM turn, and a Stage press is a check, not a product. Filled by counting
   * dispatched rows in `stage_sandbox_runs`
   * (application/marketplace/stageSandboxLedger.ts).
   */
  stageSandboxRunsMonthly: number;
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
  /** Whether the premium exec insight lenses (forecasting/anomalies + the
   *  CTO/CFO/PMO analytical lenses) are available. Any paid plan. */
  advancedInsights: boolean;
  /**
   * Whether the workspace may teach and run its OWN model — the `evermind` canvas kind
   * and the adapter studio behind it. Any paid plan.
   *
   * It is the first CANVAS OBJECT gated by a plan feature, and it exists because the
   * registry had already marked it as needing an entitlement and nothing asked: the
   * `capability` field was stamped onto six kinds, read by one function, and that
   * function was called by nothing but its own unit test. See
   * `CANVAS_CAPABILITY_FEATURES` below for the map the palette now resolves through.
   */
  evermindTraining: boolean;
  /**
   * Whether a run may hold a LIVE container preview — a dev server started inside the
   * run's container and served through the public preview ingress, so a phone can load
   * the work in progress by scanning a QR.
   *
   * Paid because it is the platform's most expensive consumption shape: unlike a run,
   * which starts, works and exits, a preview PINS a container instance open for as long
   * as an editor tab is open, against a fixed `max_instances` budget
   * (`application/runtime/previewSessions.ts` holds the numbers and the reasoning). Any
   * paid plan — the capacity guard, not the plan tier, is what bounds the spend.
   */
  livePreview: boolean;
}

export const PLAN_LIMITS: Record<TenantPlan, PlanLimits> = {
  [TenantPlan.FREE]: {
    maxCreationSessions: 10,
    maxCreationSessionCollaborators: 3,
    maxCreationSessionTemplates: 3,
    maxCreationSessionHistory: 50,
    maxCreationDatasetRows: 500,
    maxCreationRealtimeEditors: 3,
    maxCreationArtifactBytes: 100_000_000,
    maxAgentHosts: 1,
    maxProjects: 5,
    maxSeats: 1,
    tokenDailyLimit: 10_000,
    tokenMonthlyLimit: 50_000,
    ingestionMonthlyBytes: 50_000_000, // 50 MB/mo — a handful of repo imports
    errorEventsMonthly: 10_000, // 10K error events/mo
    feedbackSubmissionsMonthly: 200, // 200 requests/mo — a real pilot, not a firehose
    outboundFetchesMonthly: 500, // 500 Brain URL fetches/mo
    cloudRunsMonthly: 25, // 25 cloud-agent runs/mo — enough to try it, then upgrade
    stageSandboxRunsMonthly: 15, // 15 sandbox runs/mo
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
    advancedInsights: false,
    evermindTraining: false,
    livePreview: false,
  },
  [TenantPlan.PRO]: {
    maxCreationSessions: 500,
    maxCreationSessionCollaborators: 25,
    maxCreationSessionTemplates: 100,
    maxCreationSessionHistory: 500,
    maxCreationDatasetRows: 50_000,
    maxCreationRealtimeEditors: 25,
    maxCreationArtifactBytes: 10_000_000_000,
    maxAgentHosts: 3,
    maxProjects: -1,
    maxSeats: 1,
    tokenDailyLimit: 1_000_000,
    tokenMonthlyLimit: 5_000_000,
    ingestionMonthlyBytes: 5_000_000_000, // 5 GB/mo
    errorEventsMonthly: 1_000_000, // 1M error events/mo
    feedbackSubmissionsMonthly: 20_000, // 20K requests/mo
    outboundFetchesMonthly: 50_000, // 50K Brain URL fetches/mo
    cloudRunsMonthly: 2_000, // 2K cloud-agent runs/mo
    stageSandboxRunsMonthly: 500, // 500 sandbox runs/mo
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
    advancedInsights: true,
    evermindTraining: true,
    livePreview: true,
  },
  [TenantPlan.TEAMS]: {
    maxCreationSessions: -1,
    maxCreationSessionCollaborators: -1,
    maxCreationSessionTemplates: -1,
    maxCreationSessionHistory: 5_000,
    maxCreationDatasetRows: 1_000_000,
    maxCreationRealtimeEditors: 100,
    maxCreationArtifactBytes: -1,
    maxAgentHosts: -1,
    maxProjects: -1,
    maxSeats: -1,
    tokenDailyLimit: 5_000_000,
    tokenMonthlyLimit: -1,
    ingestionMonthlyBytes: -1, // unlimited
    errorEventsMonthly: -1, // unlimited
    feedbackSubmissionsMonthly: -1, // unlimited
    outboundFetchesMonthly: -1, // unlimited
    cloudRunsMonthly: -1, // unlimited
    stageSandboxRunsMonthly: -1, // unlimited
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
    advancedInsights: true,
    evermindTraining: true,
    livePreview: true,
  },
};

/**
 * Anonymous guest (logged-out) chat allowance — the "try the Brain before you
 * sign up" tier. Deliberately LIMITED: a logged-out visitor has no account we can
 * ban and their visitorId/IP are spoofable, so this is a taste, not a free ride.
 * Signing up unlocks the real FREE tier ({@link PLAN_LIMITS}.free — 10K
 * tokens/day). Metered per visitorId AND per source IP (the spoof backstop) —
 * see application/guest/GuestChatService. NOT part of the TenantPlan enum: a
 * guest has no tenant row, so this never flows through resolveTokenLimits.
 */
export const GUEST_CHAT_LIMITS = {
  /** Max assistant turns per visitorId per UTC day. */
  messagesDailyLimit: 10,
  /** Max assistant turns per source IP per UTC day — an abuser rotating
   *  visitorIds still hits this. Higher than the per-visitor cap so a shared
   *  office/NAT IP doesn't lock out honest visitors too soon. */
  ipMessagesDailyLimit: 50,
  /** Output-token ceiling per guest CHAT request (clamped down, never rejected).
   *  Sized for a conversational reply — a paragraph or two in a bubble. */
  maxTokensPerRequest: 700,
  /**
   * Output-token ceiling for a guest turn that carries TOOLS — a Creation Canvas
   * authoring turn rather than a chat reply.
   *
   * These are not the same budget and treating them as one is what made the canvas
   * look broken for a logged-out visitor. A canvas artifact is authored INSIDE the
   * tool call: `canvas_add_object` for a website carries its pages, sections, headings
   * and copy as JSON arguments, which is comfortably over a thousand tokens. Clamped to
   * 700 the model was cut off mid-argument — `finish_reason: "length"`, no parseable
   * tool call, and a turn that had generated for twenty seconds arrived as nothing.
   * Measured 2026-08-12 (ui 2026.7.213): one truncated completion, and the calls that
   * DID survive were the ones small enough to fit — `{x, y, kind, title}` — which is
   * why every object landed as an empty shell.
   *
   * Matches the canvas client's own `CANVAS_RESPONSE_TOKENS`, so the ceiling stops
   * being the thing that decides whether an artifact can be authored. The real guest
   * cost control is unchanged and is where it belongs: `messagesDailyLimit` (10 turns
   * per visitor per day) and `ipMessagesDailyLimit`.
   */
  maxToolTokensPerRequest: 3_200,
} as const;

/**
 * Guest RESEARCH — the server-side web search / page read / geocode a logged-out
 * canvas turn may perform.
 *
 * Metered SEPARATELY from `messagesDailyLimit` because the units differ: one guest
 * message can legitimately fan out into a whole research pipeline (search → read two
 * sources → geocode the rows), and charging that as several messages would make the
 * free canvas feel broken. The allowance is per CALL and generous enough for a few
 * complete pipelines, then stops — these are outbound requests from the platform's own
 * IP against third parties, so the cap is an abuse ceiling, not a paywall.
 *
 * Search itself is keyless by default (`webSearchVendors.ts`), so the marginal cost of
 * a guest research call is bandwidth, not vendor spend — unless the operator has funded
 * a wide-index key, in which case this cap is what bounds their bill.
 */
export const GUEST_RESEARCH_LIMITS = {
  /** Research tool calls per visitorId per UTC day. */
  callsDailyLimit: 40,
  /** Per source IP per UTC day — the spoof backstop, same reasoning as chat. */
  ipCallsDailyLimit: 200,
} as const;

/**
 * Office EXPORTS for a logged-out visitor.
 *
 * Deliberately generous, and deliberately its own ceiling rather than a share of
 * the chat allowance: a guest who has spent their free messages has a finished
 * document on their board and every reason to want the file. The renders are
 * stateless CPU over markdown the client already holds, so the numbers exist to
 * bound abuse of an open compute endpoint, not to ration the feature — a person
 * exporting the same deck twenty times is working, not attacking.
 */
export const GUEST_EXPORT_LIMITS = {
  /** Office renders per visitorId per UTC day. */
  exportsDailyLimit: 60,
  /** Per source IP per UTC day — the spoof backstop, same reasoning as chat. */
  ipExportsDailyLimit: 300,
} as const;

/**
 * Shared guest ROOMS — a logged-out visitor can invite others into their free
 * session (chat + camera). The room's turn allowance is exactly
 * `GUEST_CHAT_LIMITS.messagesDailyLimit`, spent COMBINED by everyone in it: five
 * people in one room still share ten free turns. That is deliberate — inviting
 * people must never be a way to multiply anonymous LLM spend. Each participant's
 * own per-visitor and per-IP counters keep running underneath, so joining a
 * second room cannot refill an individual's exhausted allowance either.
 */
export const GUEST_ROOM_LIMITS = {
  /** Simultaneous participants. Mesh WebRTC is ~N² bandwidth — keep it small. */
  maxParticipants: 8,
  /** Room lifetime from creation; afterwards the room is gone (with its transcript). */
  ttlMinutes: 240,
  /** Transcript messages retained in the room (oldest drop off). */
  maxMessages: 200,
  /** Characters retained per room message. */
  maxMessageChars: 8_000,
  /**
   * Serialized size of the shared Creation Canvas board. Comfortably above a
   * real free-session board and comfortably below the Durable Object per-value
   * storage ceiling; a board that exceeds it stops syncing LOUDLY (the writer is
   * told), because a silently-stale board is worse than a refused save.
   */
  maxCanvasChars: 512_000,
  /** Sockets one room will hold open across all channels (chat + media). */
  maxSockets: 24,
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
 * Resolve a tenant's effective monthly feedback-submission allowance (count); -1 =
 * unlimited. Mirrors {@link resolveErrorEventsMonthly} so the "Feedback" meter
 * display and the feedback ingest gate agree — the number a member SEES is the
 * number that gets ENFORCED. A superadmin-unlimited tenant is unlimited; a
 * positive *token* override does not lift this (different axis).
 */
export function resolveFeedbackSubmissionsMonthly(input: {
  effectivePlan: TenantPlan;
  tokenDailyLimitOverride: number | null;
  isSuperadmin?: boolean;
}): number {
  if (input.tokenDailyLimitOverride === -1 || input.isSuperadmin) return -1;
  return getLimits(input.effectivePlan).feedbackSubmissionsMonthly;
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
 * Resolve a tenant's effective monthly Stage Sandbox run allowance (count); -1
 * = unlimited. Mirrors {@link resolveCloudRunsMonthly} so the "Sandbox runs"
 * meter display and the dispatch gate agree. A superadmin-unlimited tenant is
 * unlimited; a positive *token* override does not lift this (different axis).
 */
export function resolveStageSandboxRunsMonthly(input: {
  effectivePlan: TenantPlan;
  tokenDailyLimitOverride: number | null;
  isSuperadmin?: boolean;
}): number {
  if (input.tokenDailyLimitOverride === -1 || input.isSuperadmin) return -1;
  return getLimits(input.effectivePlan).stageSandboxRunsMonthly;
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
