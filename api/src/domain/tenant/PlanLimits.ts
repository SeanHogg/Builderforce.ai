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
}

export const PLAN_LIMITS: Record<TenantPlan, PlanLimits> = {
  [TenantPlan.FREE]: {
    maxAgentHosts: 1,
    maxProjects: 5,
    maxSeats: 1,
    tokenDailyLimit: 10_000,
    imageCreditsDailyLimit: 10,
    maxTokensPerRequest: 4_096,
    approvalWorkflows: false,
    fleetMesh: false,
    fullTelemetry: false,
    customAgentRoles: false,
    psychometricPersona: false,
    teamApprovalInbox: false,
    seatCostControls: false,
  },
  [TenantPlan.PRO]: {
    maxAgentHosts: 3,
    maxProjects: -1,
    maxSeats: 1,
    tokenDailyLimit: 1_000_000,
    imageCreditsDailyLimit: 1_000,
    maxTokensPerRequest: 16_384,
    approvalWorkflows: true,
    fleetMesh: true,
    fullTelemetry: true,
    customAgentRoles: true,
    psychometricPersona: true,
    teamApprovalInbox: false,
    seatCostControls: false,
  },
  [TenantPlan.TEAMS]: {
    maxAgentHosts: -1,
    maxProjects: -1,
    maxSeats: -1,
    tokenDailyLimit: 5_000_000,
    imageCreditsDailyLimit: 5_000,
    maxTokensPerRequest: 64_000,
    approvalWorkflows: true,
    fleetMesh: true,
    fullTelemetry: true,
    customAgentRoles: true,
    psychometricPersona: true,
    teamApprovalInbox: true,
    seatCostControls: true,
  },
};

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
