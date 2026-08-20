/**
 * Earnings, the platform fee, and where the money goes — the typed client.
 *
 * ── WHY THE WEB TOKEN, EVERYWHERE ────────────────────────────────────────────────
 * Every call here carries the PERSON-level web JWT rather than the workspace one, and
 * that is the whole reason this module exists beside `payoutsApi`-shaped surfaces: a
 * for-hire account belongs to no workspace, so a tenant-scoped request is not merely
 * narrower, it is a guaranteed 401 for exactly the people the page is for.
 *
 * ── WHY NOTHING IS CACHED HERE ───────────────────────────────────────────────────
 * The server caches the report behind a per-user version token that every money write
 * bumps, so a second cache in the browser would only add a window in which a release
 * has happened and the page still says it has not. A statement that lags the money is
 * the one number a person will not forgive being wrong.
 *
 * ── THE FEE IS READ, NEVER COMPUTED ──────────────────────────────────────────────
 * `PlatformFeeQuote` arrives fully resolved — rate, amount, reason and the distance to
 * the threshold. No component multiplies anything by a basis-point figure: the server
 * resolves the rate against the same books that price a real charge, and a second
 * calculation in the browser would be a second answer to "what does this cost", shown
 * to the person paying it.
 */
import { apiRequestStream } from './apiClient';
import { jsonOrThrow } from './apiEnvelope';

/** How the platform's cut is explained. Codes, translated by the surface. */
export type PlatformFeeReason = 'under_threshold' | 'standard_rate' | 'platform_listing';

/** Which kinds of money the take rate is charged on today. */
export type FeeSurface = 'catalogue_sale' | 'escrow_release';

export interface PlatformFeeSchedule {
  configuredBps: number;
  thresholdCents: number;
  appliesTo: FeeSurface[];
}

export interface PlatformFeeQuote {
  grossCents: number;
  feeBps: number;
  feeCents: number;
  netCents: number;
  reason: PlatformFeeReason;
  waived: boolean;
  lifetimeCents: number;
  thresholdCents: number;
  remainingToThresholdCents: number;
  configuredBps: number;
}

/** What a ledger row on a person's account MEANS — decided by the server, because
 *  `entry_kind` alone cannot say (an escrow release and a bank withdrawal are both
 *  `payout` on the same account). */
export type EarningKind = 'sale' | 'escrow_release' | 'refund' | 'withdrawal' | 'adjustment';

export interface EarningsTransaction {
  id: number;
  occurredAtISO: string;
  kind: EarningKind;
  amountCents: number;
  feeCents: number;
  grossCents: number;
  reference: string | null;
  memo: string | null;
  tenantId: number;
  workspaceName: string | null;
}

export interface EarningsBucket {
  period: string;
  grossCents: number;
  feeCents: number;
  netCents: number;
  count: number;
}

export interface EarningsSummary {
  grossCents: number;
  platformFeeCents: number;
  netCents: number;
  withdrawnCents: number;
  refundedCents: number;
  heldCents: number;
  availableCents: number;
  transactionCount: number;
}

export type EarningsPeriod = 'week' | 'month' | 'quarter' | 'year';
export const EARNINGS_PERIODS: EarningsPeriod[] = ['week', 'month', 'quarter', 'year'];

/** With no payout provider configured the ledger is still correct and an operator
 *  completes the transfer. `manual` is an operating mode, never an error. */
export type SettlementMode = 'provider' | 'manual';

export interface EarningsReport {
  scope: 'workspace' | 'everywhere';
  currency: string;
  fromISO: string;
  toISO: string;
  period: EarningsPeriod;
  summary: EarningsSummary;
  buckets: EarningsBucket[];
  transactions: EarningsTransaction[];
  transactionsTruncated: boolean;
  fee: PlatformFeeQuote;
  settlement: SettlementMode;
}

export async function getEarningsReport(options: {
  period?: EarningsPeriod;
  scope?: 'workspace' | 'everywhere';
  from?: string;
  to?: string;
  limit?: number;
} = {}): Promise<EarningsReport> {
  const params = new URLSearchParams();
  if (options.period) params.set('period', options.period);
  if (options.scope === 'workspace') params.set('scope', 'workspace');
  if (options.from) params.set('from', options.from);
  if (options.to) params.set('to', options.to);
  if (options.limit) params.set('limit', String(options.limit));
  const query = params.toString();
  const res = await apiRequestStream(`/api/earnings${query ? `?${query}` : ''}`, { auth: 'web' });
  const body = await jsonOrThrow<{ report: EarningsReport }>(res, 'Failed to load your earnings');
  return body.report;
}

export async function getPlatformFee(grossCents = 0): Promise<{ schedule: PlatformFeeSchedule; quote: PlatformFeeQuote }> {
  const res = await apiRequestStream(`/api/earnings/fee?grossCents=${Math.max(0, Math.floor(grossCents))}`, { auth: 'web' });
  return jsonOrThrow(res, 'Failed to load the fee schedule');
}

// ---------------------------------------------------------------------------
// Withdrawal methods
// ---------------------------------------------------------------------------

/** Whether money has been PROVED to move through a destination. Derived on the server
 *  from whether a payout has actually completed — never a stored badge. */
export type WithdrawalVerification = 'verified' | 'unverified' | 'failed';

export interface WithdrawalMethod {
  id: number;
  provider: string;
  /** The adapter's masked label (`•••• 4321`) — the only thing derived from the sealed
   *  credential that ever leaves the server. */
  label: string;
  currency: string | null;
  country: string | null;
  status: string;
  isDefault: boolean;
  lastError: string | null;
  lastPayoutAtISO: string | null;
  connectedAtISO: string;
  verification: WithdrawalVerification;
  verifiedAtISO: string | null;
  verificationDetail: string | null;
}

export type WithdrawalBlocker = 'no_method' | 'no_default' | 'default_failed' | 'no_route';

export interface WithdrawalReadiness {
  ready: boolean;
  blockers: WithdrawalBlocker[];
  methodCount: number;
  defaultMethod: WithdrawalMethod | null;
  verificationBlocked: boolean;
  settlement: SettlementMode;
}

/** One field a provider's form asks for. `secret: true` is WRITE-ONLY — the value never
 *  comes back, which is why the declaration and the masked label are separate facts. */
export interface WithdrawalProviderField {
  key: string;
  label: string;
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
}

export interface WithdrawalProvider {
  name: string;
  label: string;
  connect: 'fields' | 'oauth';
  configured?: boolean;
  fields?: WithdrawalProviderField[];
}

export interface WithdrawalMethodsView {
  methods: WithdrawalMethod[];
  readiness: WithdrawalReadiness;
  providers: WithdrawalProvider[];
}

export async function listWithdrawalMethods(): Promise<WithdrawalMethodsView> {
  const res = await apiRequestStream('/api/withdrawal-methods', { auth: 'web' });
  return jsonOrThrow<WithdrawalMethodsView>(res, 'Failed to load your withdrawal methods');
}

export async function addWithdrawalMethod(input: {
  provider: string;
  fields: Record<string, string>;
  makeDefault?: boolean;
}): Promise<WithdrawalMethod> {
  const res = await apiRequestStream('/api/withdrawal-methods', {
    method: 'POST', auth: 'web', body: JSON.stringify(input),
  });
  const body = await jsonOrThrow<{ method: WithdrawalMethod }>(res, 'Failed to save that withdrawal method');
  return body.method;
}

export async function makeWithdrawalMethodDefault(id: number): Promise<WithdrawalMethod> {
  const res = await apiRequestStream(`/api/withdrawal-methods/${id}/default`, { method: 'PUT', auth: 'web' });
  const body = await jsonOrThrow<{ method: WithdrawalMethod }>(res, 'Failed to change your default');
  return body.method;
}

export async function removeWithdrawalMethod(id: number): Promise<void> {
  const res = await apiRequestStream(`/api/withdrawal-methods/${id}`, { method: 'DELETE', auth: 'web' });
  await jsonOrThrow(res, 'Failed to remove that withdrawal method');
}
