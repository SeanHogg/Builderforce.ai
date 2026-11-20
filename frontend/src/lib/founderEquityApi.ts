/**
 * THE client for ownership — the cap table, grants, share classes, convertibles,
 * priced rounds and the exit waterfall (FO-D1..FO-D4, PRD 25 §6.3).
 *
 * Split out of `founderOpsApi.ts`: the equity ledger is its own concern with its own
 * reader (`canvasEquityTools.ts`), and the founder-ops client is the file every
 * founder surface edits. Same transport — `apiRequest`, whose header contract is
 * load-bearing.
 *
 * Every number below is FOLDED on the server from `equity_events` and computed
 * on read; nothing here is a stored total, which is why there is no "save cap
 * table" call and never will be. The write calls append EVENTS — a grant
 * with its issuance, and a ledger row — and the read re-folds.
 */

import { apiRequest } from '@/lib/apiClient';

export interface CapTableHolder {
  holderRef: string;
  holderName: string;
  shareClassRef: string;
  shareClassName: string;
  instrument: string;
  shares: number;
  vested: number;
  unvested: number;
  percentFullyDiluted: number;
}

export interface CapTableConvertible {
  id: number;
  reference: string;
  kind: string;
  holderRef: string;
  holderName: string;
  principal: number;
  currency: string;
  valuationCap: number | null;
  discountPercent: number | null;
  postMoney: boolean;
  maturesAt: string | null;
}

export interface CapTable {
  companyRef: string;
  asOf: string;
  classes: Array<{
    id: number;
    classRef: string;
    name: string;
    kind: string;
    authorized: number;
    pricePerShare: number | null;
    seniority: number;
    liquidationMultiple: number | null;
    participating: boolean;
  }>;
  holders: CapTableHolder[];
  issued: number;
  fullyDiluted: number;
  poolAuthorized: number;
  poolGranted: number;
  poolUnallocated: number;
  poolOverAllocated: boolean;
  convertibles: CapTableConvertible[];
  convertiblePrincipal: number;
  eventCount: number;
}

/** One company's cap table, folded as of an instant. `asOf` in the past is a real
 *  answer — the same ledger with an earlier cutoff — not a stale read. */
export const capTable = (companyRef: string, asOf?: string) => {
  const params = new URLSearchParams({ companyRef, ...(asOf ? { asOf } : {}) });
  return apiRequest<CapTable>(`/api/equity/cap-table?${params}`);
};

export interface ExitWaterfallResult {
  byClass: Array<{ classRef: string; preference: number; participation: number; converted: boolean; payout: number }>;
  byHolder: Array<{ partyRef: string; payout: number; multiple: number | null }>;
  breakpoints: Array<{ exitValue: number; classRef: string; event: 'preference_satisfied' | 'converts' }>;
  netExit: number;
}

/** Who gets what at an exit — computed from the real cap table on every call and never
 *  stored. Cached server-side under the company's equity version token. */
export const exitWaterfall = (body: {
  companyRef?: string | null;
  exitValue: number;
  debt?: number | null;
  vesting?: 'normal' | 'accelerated';
  asOf?: string | null;
}) => apiRequest<ExitWaterfallResult>('/api/equity/waterfall', { method: 'POST', body: JSON.stringify(body) });

export interface RecordGrantBody {
  companyRef?: string | null;
  reference: string;
  shareClassRef: string;
  holderName: string;
  holderRef?: string | null;
  instrument?: string;
  quantity: number;
  pricePerShare?: number | null;
  fmvPerShare?: number | null;
  currency?: string;
  grantedAt?: string | null;
  vestingStartAt?: string | null;
  vestingMonths?: number | null;
  cliffMonths?: number | null;
  vestingFrequency?: string;
  acceleration?: string;
  objectId?: string | null;
  notes?: string | null;
}

/** The grant AND its issuance event, in one call — the two are not separable, so
 *  there is no way to create a certificate the cap table cannot see. */
export const recordEquityGrant = (body: RecordGrantBody) =>
  apiRequest<{ grantId: number; eventId: number; cliffAt: string | null }>(
    '/api/equity/grants',
    { method: 'POST', body: JSON.stringify(body) },
  );

export const upsertShareClass = (body: {
  companyRef?: string | null;
  name: string;
  kind?: string;
  authorized?: number;
  pricePerShare?: number | null;
  currency?: string;
  seniority?: number;
}) => apiRequest<{ id: number; classRef: string }>('/api/equity/share-classes', { method: 'POST', body: JSON.stringify(body) });

export const recordEquityEvent = (body: {
  companyRef?: string | null;
  eventKind: string;
  shareClassRef?: string | null;
  toShareClassRef?: string | null;
  fromHolderRef?: string | null;
  toHolderRef?: string | null;
  quantity: number;
  pricePerShare?: number | null;
  effectiveAt?: string | null;
  reason?: string | null;
}) => apiRequest<{ id: number }>('/api/equity/events', { method: 'POST', body: JSON.stringify(body) });

export const recordConvertible = (body: {
  companyRef?: string | null;
  reference: string;
  kind?: string;
  holderName: string;
  holderRef?: string | null;
  principal: number;
  currency?: string;
  valuationCap?: number | null;
  discountPercent?: number | null;
  postMoney?: boolean;
  interestRate?: number | null;
  issuedAt?: string | null;
  maturesAt?: string | null;
  objectId?: string | null;
}) => apiRequest<{ id: number }>('/api/equity/convertibles', { method: 'POST', body: JSON.stringify(body) });

export interface RoundModel {
  companyRef: string;
  preMoney: number;
  raiseAmount: number;
  postMoney: number;
  pricePerShare: number;
  newInvestorShares: number;
  poolIncrease: number;
  conversions: Array<{
    instrumentId: number;
    reference: string;
    holderRef: string;
    holderName: string;
    kind: string;
    convertedAmount: number;
    conversionPrice: number;
    shares: number;
    basis: 'cap' | 'discount' | 'round-price';
  }>;
  postRoundFullyDiluted: number;
  dilution: Array<{ holderRef: string; holderName: string; before: number; after: number; shares: number }>;
  caveats: string[];
}

/** Model a priced round against the REAL cap table, SAFEs and notes converted on
 *  their own terms. Writes nothing — see `applyRound` for the act that does. */
export const modelRound = (body: {
  companyRef?: string | null;
  preMoney: number;
  raiseAmount: number;
  targetPoolPercent?: number | null;
  asOf?: string | null;
}) => apiRequest<{ model: RoundModel }>('/api/equity/rounds/model', { method: 'POST', body: JSON.stringify(body) })
  .then((r) => r.model);

/** APPLY a modelled round. Re-models server-side at write time rather than
 *  trusting the plan the caller was shown, because the table may have moved. */
export const applyRound = (body: {
  companyRef?: string | null;
  preMoney: number;
  raiseAmount: number;
  targetPoolPercent?: number | null;
  shareClassName: string;
}) => apiRequest<{ model: RoundModel; eventsRecorded: number }>(
  '/api/equity/rounds/apply',
  { method: 'POST', body: JSON.stringify(body) },
);
