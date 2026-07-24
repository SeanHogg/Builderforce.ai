/**
 * Client for the per-seat AI spend-limit API (Teams). Reads the owner overview
 * (default cap + each seat's cap & month-to-date spend) and writes the team-wide
 * default + per-seat caps. Server is the authority (requireRole OWNER on writes,
 * MANAGER on reads); this is a thin apiRequest wrapper. Amounts cross the wire in
 * DOLLARS; the server stores millicents. See api/application/consumption/memberSpend.ts.
 */

import { apiRequest } from './apiClient';

/** Millicents per USD — mirrors the server unit so the UI can format $ amounts. */
export const MILLICENTS_PER_USD = 100_000;
export function millicentsToUsd(mc: number): number { return mc / MILLICENTS_PER_USD; }

export interface SeatSpend {
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
  /** Stored per-seat value: null = inherit default, -1 = unlimited, >= 0 = explicit (millicents). */
  capMillicents: number | null;
  /** Resolved effective cap (millicents); null = unlimited. */
  effectiveCapMillicents: number | null;
  spentMillicents: number;
  /** 0–100 (0 when unlimited). */
  percentUsed: number;
}

export interface TeamSpendOverview {
  seatControlsEnabled: boolean;
  effectivePlan: 'free' | 'pro' | 'teams';
  /** Team-wide default per-seat cap (millicents); null = no default. */
  defaultCapMillicents: number | null;
  periodStart: string;
  periodResetsAt: string;
  seats: SeatSpend[];
}

/** How a seat's cap is expressed when the owner edits it. */
export type SeatCapMode = 'inherit' | 'unlimited' | 'custom';

/** Classify a stored per-seat cap value into its edit mode. */
export function seatCapMode(capMillicents: number | null): SeatCapMode {
  if (capMillicents == null) return 'inherit';
  if (capMillicents < 0) return 'unlimited';
  return 'custom';
}

export function getSpendLimits(tenantId: string | number): Promise<TeamSpendOverview> {
  return apiRequest<TeamSpendOverview>(`/api/tenants/${tenantId}/spend-limits`);
}

/** Set the team-wide default per-seat monthly cap. `amountUsd` null clears it. */
export function setDefaultSpendLimit(tenantId: string | number, amountUsd: number | null): Promise<TeamSpendOverview> {
  return apiRequest<TeamSpendOverview>(`/api/tenants/${tenantId}/spend-limits`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amountUsd }),
  });
}

/** Set one seat's cap. `custom` requires `amountUsd`. */
export function setSeatSpendLimit(
  tenantId: string | number,
  userId: string,
  mode: SeatCapMode,
  amountUsd?: number,
): Promise<TeamSpendOverview> {
  return apiRequest<TeamSpendOverview>(`/api/tenants/${tenantId}/members/${userId}/spend-limit`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode, ...(mode === 'custom' ? { amountUsd } : {}) }),
  });
}
