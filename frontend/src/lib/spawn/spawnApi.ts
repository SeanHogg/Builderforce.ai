/**
 * The typed client for `/api/spawn` — Spawn, the Roblox game builder. Components
 * call these, never `apiRequest` with a path of their own.
 *
 * Refusals arrive as `ApiRequestError` carrying the server's stable `code`
 * (`age_required`, `membership_required`, `insufficient_tokens`, …), which the
 * account page translates through `spawn.errors.<code>`. They are declared
 * expected, so a refusal is not filed as a fault.
 */
import { apiRequest } from '@/lib/apiClient';

export interface SpawnPack {
  id: string;
  cents: number;
  tokens: number;
  estimatedBuilds: number;
}

export interface SpawnPrices {
  minAge: number;
  monthlyCents: number;
  packs: SpawnPack[];
}

export type SpawnAgeStatus = 'unknown' | 'ok' | 'too_young';
export type SpawnMembershipStatus = 'none' | 'active' | 'past_due' | 'cancelled';

export interface SpawnActivityRow {
  id: number;
  amount: number;
  kind: string;
  memo: string | null;
  occurredAt: string;
}

export interface SpawnAccount extends SpawnPrices {
  age: SpawnAgeStatus;
  membership: SpawnMembershipStatus;
  balance: number;
  canBuild: boolean;
  activity: SpawnActivityRow[];
}

/** The refusals a Spawn call may answer with — every one is a sentence in `spawn.errors`. */
const EXPECTED = [400, 402, 403, 404];

let prices: Promise<SpawnPrices> | null = null;

/** Public; one request per page load, retried after a failure. */
export function fetchSpawnPrices(): Promise<SpawnPrices> {
  if (!prices) {
    prices = apiRequest<SpawnPrices>('/api/spawn/prices', { auth: 'none' })
      .catch((error) => { prices = null; throw error; });
  }
  return prices;
}

export function fetchSpawnAccount(): Promise<SpawnAccount> {
  return apiRequest<SpawnAccount>('/api/spawn/account', { auth: 'tenant', expectedErrors: EXPECTED });
}

export async function confirmSpawnAge(year: number, month: number): Promise<SpawnAgeStatus> {
  const res = await apiRequest<{ age: SpawnAgeStatus }>('/api/spawn/age', {
    method: 'POST', auth: 'tenant', body: JSON.stringify({ year, month }), expectedErrors: EXPECTED,
  });
  return res.age;
}

/** Opens hosted checkout and returns its URL; the caller navigates. */
export async function startSpawnMembership(): Promise<string> {
  const res = await apiRequest<{ checkoutUrl: string }>('/api/spawn/membership', {
    method: 'POST', auth: 'tenant', body: '{}', expectedErrors: EXPECTED,
  });
  return res.checkoutUrl;
}

/** Settles the session the processor redirected back with. Idempotent server-side. */
export function completeSpawnMembership(sessionId: string): Promise<{ membership: SpawnMembershipStatus }> {
  return apiRequest('/api/spawn/membership/complete', {
    method: 'POST', auth: 'tenant', body: JSON.stringify({ sessionId }), expectedErrors: EXPECTED,
  });
}

export async function startSpawnTokens(packId: string): Promise<string> {
  const res = await apiRequest<{ checkoutUrl: string }>('/api/spawn/tokens', {
    method: 'POST', auth: 'tenant', body: JSON.stringify({ packId }), expectedErrors: EXPECTED,
  });
  return res.checkoutUrl;
}

export function completeSpawnTokens(sessionId: string): Promise<{ applied: boolean; creditedTokens: number; balance: number }> {
  return apiRequest('/api/spawn/tokens/complete', {
    method: 'POST', auth: 'tenant', body: JSON.stringify({ sessionId }), expectedErrors: EXPECTED,
  });
}
