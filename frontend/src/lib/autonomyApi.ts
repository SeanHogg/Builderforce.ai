import { apiRequest } from './apiClient';

/**
 * "Autonomy Health" lens — client mirror of
 * api/src/application/activity/ticketLifecycleLedger.ts (`getAutonomySummary`,
 * served by `GET /api/insights/autonomy`).
 *
 * The fleet-scale answer to "are tickets created by the manager or by humans
 * ACTUALLY going through their full lifecycle autonomously?". Every lane move is
 * stamped with an actor kind, so the funnel below can say — per ORIGIN — how many
 * tickets got dispatched, how many autonomy moved, how many reached Done, and how
 * many reached Done with ZERO human hops.
 *
 * Manager-gated server-side (mirrored client-side by `insights.autonomy`).
 */

/**
 * How a ticket came into existence — the axis the whole lens compares on.
 *
 * Re-exported from `builderforceApi`, NOT redeclared: the per-ticket lifecycle panel
 * and this fleet lens are two views of ONE server module
 * (`ticketLifecycleLedger.ts`), so its origin vocabulary has a single client home. A
 * second copy here would silently drift the moment the server adds an origin.
 * `import type` is erased at compile time, so this costs nothing at runtime.
 */
export type { TicketOrigin } from './builderforceApi';
import type { TicketOrigin } from './builderforceApi';

/** Stable, ordered origin list — drives colour identity + a deterministic legend.
 *  Colour follows the ORIGIN (the entity), never its rank in the response. */
export const ORIGIN_ORDER: TicketOrigin[] = ['agent', 'manager_card', 'human', 'system', 'unknown'];

/**
 * Why autonomy did not dispatch a ticket (mirror of the API's `AutoRunReason`
 * plus `unrecorded` for tickets autonomy never even evaluated). Kept as a union
 * of the known gates with a string fallback so a newly-added server gate renders
 * (using the server's own `text`) instead of crashing the chart.
 */
export type AutonomyStallReason =
  | 'will_run' | 'no_board' | 'no_lane' | 'terminal_lane' | 'human_gate' | 'no_agent'
  | 'capability_mismatch' | 'already_running' | 'run_cap_exhausted' | 'cooldown_active'
  | 'not_executable' | 'pending_approval' | 'unrecorded';

/** One origin bucket's autonomy funnel. Field-for-field the server's shape. */
export interface AutonomyOriginStats {
  origin: TicketOrigin;
  /** Tickets OPENED in the window (the funnel's mouth). */
  tickets: number;
  /** Got at least one run dispatched. */
  everDispatched: number;
  /** Autonomy moved it at least one lane. */
  progressedAutonomously: number;
  /** Reached a terminal (Done-class) lane. */
  reachedTerminal: number;
  /** Reached terminal with ZERO human lane moves — autonomy did the whole thing. */
  fullyAutonomous: number;
  /** Short of terminal with nothing running. */
  stalled: number;
  /** No run AND no autonomous hop — inert from birth. */
  neverStarted: number;
  /** Lane moves made by agents / automation. */
  autonomousHops: number;
  /** Lane moves made by people. */
  humanHops: number;
}

export interface AutonomyStallGate {
  reason: AutonomyStallReason | string;
  /** The server's own human-readable sentence — the honest fallback when a gate
   *  has no localized copy yet (see `insights.autonomy.gate.*`). */
  text: string;
  tickets: number;
}

export interface AutonomySummary {
  windowDays: number;
  generatedAt: string;
  totals: AutonomyOriginStats;
  byOrigin: AutonomyOriginStats[];
  /** Stall gates ranked by how many tickets each holds — where autonomy dies. */
  stallReasons: AutonomyStallGate[];
  /** True when the audited ticket set hit the server ceiling and was CUT. Must be
   *  surfaced — the figures are then a sample, not full coverage. */
  truncated: boolean;
  ticketsScanned: number;
}

/** The five funnel stages, in order. Shared by the chart and the table view. */
export const AUTONOMY_STAGES = [
  'created', 'dispatched', 'progressed', 'terminal', 'fullyAutonomous',
] as const;
export type AutonomyStage = (typeof AUTONOMY_STAGES)[number];

/** Stage → the stat field it reads, so the funnel and the table can't drift. */
export const STAGE_FIELD: Record<AutonomyStage, keyof AutonomyOriginStats> = {
  created: 'tickets',
  dispatched: 'everDispatched',
  progressed: 'progressedAutonomously',
  terminal: 'reachedTerminal',
  fullyAutonomous: 'fullyAutonomous',
};

/** Share of `n` against the funnel mouth, as a 0–100 percentage (0 when empty). */
export function shareOfCreated(stats: AutonomyOriginStats, n: number): number {
  return stats.tickets > 0 ? (n / stats.tickets) * 100 : 0;
}

/** Share of all lane moves that autonomy made, 0–100 (null when nothing moved). */
export function autonomousHopShare(stats: AutonomyOriginStats): number | null {
  const total = stats.autonomousHops + stats.humanHops;
  return total > 0 ? (stats.autonomousHops / total) * 100 : null;
}

export const autonomyApi = {
  get: (days = 30, projectId?: number | null): Promise<AutonomySummary> => {
    const q = new URLSearchParams({ days: String(days) });
    if (projectId != null) q.set('projectId', String(projectId));
    return apiRequest<AutonomySummary>(`/api/insights/autonomy?${q.toString()}`);
  },
};
