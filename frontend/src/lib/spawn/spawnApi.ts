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
  /** The free trial: its length and its tokens (Builderforce's free-plan allowance). */
  trialDays: number;
  trialTokens: number;
}

export type SpawnAgeStatus = 'unknown' | 'ok' | 'too_young';
export type SpawnMembershipStatus = 'none' | 'trial' | 'trial_ended' | 'active' | 'past_due' | 'cancelled';

export interface SpawnTrialView {
  /** May this player start their free trial now? */
  available: boolean;
  live: boolean;
  endsAt: string | null;
  daysLeft: number | null;
  parentEmail: string | null;
  days: number;
  tokens: number;
  builds: number;
}

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
  /** Does the membership open the builder (paid, or a live trial)? Decided server-side. */
  membershipOpen: boolean;
  trial: SpawnTrialView;
  activity: SpawnActivityRow[];
}

/** What the grown-up's page shows: one player's Spawn, reached by the emailed link. */
export interface SpawnParentView extends SpawnPrices {
  player: string;
  membership: SpawnMembershipStatus;
  trialDaysLeft: number | null;
  balance: number;
}

/** The refusals a Spawn call may answer with — every one is a sentence in `spawn.errors`. */
const EXPECTED = [400, 402, 403, 404, 409];

/** Where the newest installers are; a null platform has no installer yet. */
export interface SpawnInstallers {
  version: string | null;
  releaseUrl: string | null;
  windows: string | null;
  macArm: string | null;
  macIntel: string | null;
}

/** A public read made once per page load (every button shares it) and retried after a failure. */
function oncePerPage<T>(path: string): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= apiRequest<T>(path, { auth: 'none' }).catch((error) => { pending = null; throw error; });
    return pending;
  };
}

export const fetchSpawnPrices = oncePerPage<SpawnPrices>('/api/spawn/prices');
export const fetchSpawnInstallers = oncePerPage<SpawnInstallers>('/api/spawn/downloads');

export function fetchSpawnAccount(): Promise<SpawnAccount> {
  return apiRequest<SpawnAccount>('/api/spawn/account', { auth: 'tenant', expectedErrors: EXPECTED });
}

export async function confirmSpawnAge(year: number, month: number): Promise<SpawnAgeStatus> {
  const res = await apiRequest<{ age: SpawnAgeStatus }>('/api/spawn/age', {
    method: 'POST', auth: 'tenant', body: JSON.stringify({ year, month }), expectedErrors: EXPECTED,
  });
  return res.age;
}

/** Starts the player's one free week; a grown-up's email is required. */
export async function startSpawnTrial(parentEmail: string): Promise<SpawnTrialView> {
  const res = await apiRequest<{ trial: SpawnTrialView }>('/api/spawn/trial', {
    method: 'POST', auth: 'tenant', body: JSON.stringify({ parentEmail }), expectedErrors: EXPECTED,
  });
  return res.trial;
}

// ── The grown-up's page: the signed link `t` is the whole credential ──────────────

export function fetchSpawnParent(t: string): Promise<SpawnParentView> {
  return apiRequest<SpawnParentView>(`/api/spawn/parent?t=${encodeURIComponent(t)}`, { auth: 'none', expectedErrors: EXPECTED });
}

export async function startSpawnParentMembership(t: string): Promise<string> {
  const res = await apiRequest<{ checkoutUrl: string }>('/api/spawn/parent/membership', {
    method: 'POST', auth: 'none', body: JSON.stringify({ t }), expectedErrors: EXPECTED,
  });
  return res.checkoutUrl;
}

export function completeSpawnParentMembership(t: string, sessionId: string): Promise<{ membership: SpawnMembershipStatus }> {
  return apiRequest('/api/spawn/parent/membership/complete', {
    method: 'POST', auth: 'none', body: JSON.stringify({ t, sessionId }), expectedErrors: EXPECTED,
  });
}

export async function startSpawnParentTokens(t: string, packId: string): Promise<string> {
  const res = await apiRequest<{ checkoutUrl: string }>('/api/spawn/parent/tokens', {
    method: 'POST', auth: 'none', body: JSON.stringify({ t, packId }), expectedErrors: EXPECTED,
  });
  return res.checkoutUrl;
}

export function completeSpawnParentTokens(t: string, sessionId: string): Promise<{ applied: boolean; creditedTokens: number; balance: number }> {
  return apiRequest('/api/spawn/parent/tokens/complete', {
    method: 'POST', auth: 'none', body: JSON.stringify({ t, sessionId }), expectedErrors: EXPECTED,
  });
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
