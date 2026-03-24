import { TenantPlan } from '../shared/types';

/**
 * Hard limits enforced per plan.
 *
 * These are the authoritative values — reference them everywhere limits are
 * checked (API guards, quota warnings, frontend display). Do not duplicate
 * these numbers inline.
 */
export interface PlanLimits {
  /** Maximum number of registered Claws (0 = blocked, -1 = unlimited) */
  maxClaws: number;
  /** Maximum number of projects */
  maxProjects: number;
  /** Maximum number of active seats (team members); -1 = unlimited */
  maxSeats: number;
  /** Token budget per calendar day (input + output combined) */
  tokenDailyLimit: number;
  /** Whether approval workflow gates are available */
  approvalWorkflows: boolean;
  /** Whether fleet mesh (claw-to-claw routing) is available */
  fleetMesh: boolean;
  /** Whether full telemetry + audit trail is available */
  fullTelemetry: boolean;
  /** Whether custom agent roles (.coderClaw/agents/) are synced from Builderforce */
  customAgentRoles: boolean;
  /** Whether the shared team approval inbox is available */
  teamApprovalInbox: boolean;
  /** Whether per-seat cost controls are available */
  seatCostControls: boolean;
}

export const PLAN_LIMITS: Record<TenantPlan, PlanLimits> = {
  [TenantPlan.FREE]: {
    maxClaws: 1,
    maxProjects: 5,
    maxSeats: 1,
    tokenDailyLimit: 10_000,
    approvalWorkflows: false,
    fleetMesh: false,
    fullTelemetry: false,
    customAgentRoles: false,
    teamApprovalInbox: false,
    seatCostControls: false,
  },
  [TenantPlan.PRO]: {
    maxClaws: 3,
    maxProjects: -1,
    maxSeats: 1,
    tokenDailyLimit: 1_000_000,
    approvalWorkflows: true,
    fleetMesh: true,
    fullTelemetry: true,
    customAgentRoles: true,
    teamApprovalInbox: false,
    seatCostControls: false,
  },
  [TenantPlan.TEAMS]: {
    maxClaws: -1,
    maxProjects: -1,
    maxSeats: -1,
    tokenDailyLimit: 5_000_000,
    approvalWorkflows: true,
    fleetMesh: true,
    fullTelemetry: true,
    customAgentRoles: true,
    teamApprovalInbox: true,
    seatCostControls: true,
  },
};

/** Returns the limits for the tenant's effective plan. */
export function getLimits(plan: TenantPlan): PlanLimits {
  return PLAN_LIMITS[plan];
}

/** Returns true if adding one more claw is within plan limits. */
export function canAddClaw(plan: TenantPlan, currentClawCount: number): boolean {
  const { maxClaws } = getLimits(plan);
  return maxClaws === -1 || currentClawCount < maxClaws;
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
