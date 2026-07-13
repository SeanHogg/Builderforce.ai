/**
 * API client for the persona / cadence / workforce-planning surfaces:
 *   • /api/member-personas    the lateral lens-persona dimension of the 2D RBAC
 *   • /api/insights/snapshots  annual-calendar cadence (lens review snapshots)
 *   • /api/workforce/plan      blended human + agent capacity-vs-WIP plan
 *
 * Reuses the shared tenant-JWT auth primitives from `./auth` (same contract as
 * builderforceApi's request()) so the token / 401 / 402 handling never drifts.
 */

import {
  AUTH_API_URL,
  checkUnauthorizedAndRedirect,
  getStoredTenantToken,
} from './auth';
import { planLimitErrorFromResponse } from './planLimitError';
import type { Persona, Lens } from './lensPersona';

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getStoredTenantToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${AUTH_API_URL}${path}`, {
    ...opts,
    headers: { ...headers, ...(opts.headers as Record<string, string>) },
  });
  checkUnauthorizedAndRedirect(res, !!token);
  if (res.status === 402) throw await planLimitErrorFromResponse(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || res.statusText || `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Member personas ─────────────────────────────────────────────────────────

export interface PersonaShape {
  personas: Persona[];
  primary: Persona;
  lenses: Lens[];
  homeLens: Lens;
}
export interface RosterPersona extends PersonaShape {
  userId: string;
  displayName: string | null;
}
export interface MyPersonasResponse extends PersonaShape {
  available: Persona[];
  roster?: RosterPersona[];
}

export const memberPersonasApi = {
  /** My personas + defaults; managers also receive the tenant roster. */
  get: (): Promise<MyPersonasResponse> => request<MyPersonasResponse>('/api/member-personas'),

  /** Self-set my personas + which is primary. */
  set: (personas: Persona[], primary?: Persona): Promise<PersonaShape> =>
    request<PersonaShape>('/api/member-personas', {
      method: 'PUT',
      body: JSON.stringify({ personas, primary }),
    }),

  /** Manager assigns another user's personas. */
  assign: (userId: string, personas: Persona[], primary?: Persona): Promise<RosterPersona> =>
    request<RosterPersona>('/api/member-personas/assign', {
      method: 'POST',
      body: JSON.stringify({ userId, personas, primary }),
    }),
};

// ── Lens snapshots (annual-calendar cadence) ─────────────────────────────────

export type SnapshotCadence = 'monthly' | 'quarterly' | 'annual';

export interface LensSnapshotMeta {
  id: string;
  lens: string;
  period: string;
  generatedAt: string;
  cadence: SnapshotCadence | null;
}
export interface LensSnapshotList {
  snapshotableLenses: string[];
  cadences: SnapshotCadence[];
  snapshots: LensSnapshotMeta[];
}
export interface LensSnapshotFull {
  snapshot: LensSnapshotMeta & { payload: Record<string, unknown> };
}

export const lensSnapshotsApi = {
  list: (opts: { lens?: string; period?: string } = {}): Promise<LensSnapshotList> => {
    const qs = new URLSearchParams();
    if (opts.lens) qs.set('lens', opts.lens);
    if (opts.period) qs.set('period', opts.period);
    const q = qs.toString();
    return request<LensSnapshotList>(`/api/insights/snapshots${q ? `?${q}` : ''}`);
  },
  get: (id: string): Promise<LensSnapshotFull> =>
    request<LensSnapshotFull>(`/api/insights/snapshots/${encodeURIComponent(id)}`),
  capture: (lens: string, cadence: SnapshotCadence, period?: string): Promise<{ captured: boolean; lens: string; period: string }> =>
    request('/api/insights/snapshots/capture', {
      method: 'POST',
      body: JSON.stringify({ lens, cadence, period }),
    }),
};

// ── Workforce plan (blended human + agent) ───────────────────────────────────

export type WorkforcePopulation = 'human' | 'agent';

export interface WorkforcePlanMember {
  memberKind: 'human' | 'cloud_agent' | 'host_agent';
  memberRef: string;
  memberName: string;
  population: WorkforcePopulation;
  discipline: string | null;
  weeklyCapacityHours: number | null;
  dailyCapacityPoints: number | null;
  maxConcurrentWip: number | null;
  costRateUsdHours: number | null;
  openWip: number;
  spareWip: number | null;
  overAllocated: boolean;
  weeklyCostUsd: number | null;
}
export interface WorkforcePopulationRollup {
  population: WorkforcePopulation;
  memberCount: number;
  totalWeeklyCapacityHours: number;
  totalMaxWip: number;
  totalOpenWip: number;
  capacityGapWip: number;
  totalWeeklyCostUsd: number;
}
export interface WorkforcePlan {
  generatedAt: string;
  members: WorkforcePlanMember[];
  byPopulation: WorkforcePopulationRollup[];
  totals: {
    memberCount: number;
    totalWeeklyCapacityHours: number;
    totalMaxWip: number;
    totalOpenWip: number;
    capacityGapWip: number;
    totalWeeklyCostUsd: number;
    humanWeeklyCostUsd: number;
    agentWeeklyCostUsd: number;
    agentWipShare: number;
  };
}

export const workforcePlanApi = {
  get: (): Promise<WorkforcePlan> => request<WorkforcePlan>('/api/workforce/plan'),
};
