/**
 * THE client for the founder-operations surfaces (migration 0469).
 *
 * Collection, signature, payables, the pipeline projection, co-founder matching
 * and the investor update. One module rather than six, for the same reason
 * `kernelApi.ts` is one module: they differ only in path and shape, and a client
 * per feature is the duplication the consolidation exists to delete, one layer up.
 *
 * Goes through `apiRequest`, which is THE transport — the header contract
 * (emulation token, locale, error dispatch) is load-bearing, and a second fetch
 * wrapper is how three of those headers silently stopped being sent.
 *
 * ── THE PUBLIC HALVES ARE HERE TOO, DELIBERATELY ─────────────────────────────
 * `publicForm*` and `signer*` reach endpoints that carry no session. They are in
 * this module rather than a "public" one because they are the OTHER END of the
 * calls directly above them, and splitting them by authentication is how the
 * request shape and the response shape come to be maintained in two files.
 */

import { apiRequest, getApiBaseUrl } from '@/lib/apiClient';
import type { FormAudience, FormQuestion, FormStatus, PublishedForm, SignatureIntent, SignaturePartyStatus } from '@builderforce/creation-canvas-contract';

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export interface PublishFormBody {
  questionSetId?: string;
  title: string;
  description?: string | null;
  questions: FormQuestion[];
  anonymous?: boolean;
  audience?: FormAudience;
  closesAt?: string | null;
  confirmationMessage?: string | null;
  objectId?: string | null;
  recipients?: Array<{ email: string; name?: string }>;
}

export interface PublishFormResult {
  questionSetId: string;
  slug: string;
  status: FormStatus;
  /** The plaintext tokens, returned EXACTLY once because only their hashes are
   *  stored. A caller that drops this has to re-publish to reissue. */
  invitations: Array<{ email: string; name: string | null; token: string }>;
}

export const publishForm = (body: PublishFormBody) =>
  apiRequest<PublishFormResult>('/api/forms/publish', { method: 'POST', body: JSON.stringify(body) });

export const closeForm = (questionSetId: string) =>
  apiRequest<{ ok: true }>(`/api/forms/${questionSetId}/close`, { method: 'POST' });

export interface FormSummary {
  questionSetId: string;
  slug: string | null;
  title: string;
  status: FormStatus;
  anonymous: boolean;
  audience: FormAudience;
  submissionCount: number;
  invitedCount: number;
  respondedCount: number;
}

export const formSummary = (questionSetId: string) =>
  apiRequest<{ summary: FormSummary }>(`/api/forms/${questionSetId}/summary`).then((r) => r.summary);

export interface PublicFormView {
  form: PublishedForm;
  recipient: { name: string | null; email: string; answered: boolean } | null;
}

/** The responder's read. No session — the slug is the credential. */
export const publicForm = (slug: string, token?: string) =>
  apiRequest<PublicFormView>(`/api/public/forms/${encodeURIComponent(slug)}${token ? `?t=${encodeURIComponent(token)}` : ''}`);

export const submitPublicForm = (slug: string, answers: Record<string, unknown>, token?: string) =>
  apiRequest<{ submissionId: string; confirmationMessage: string | null }>(
    `/api/public/forms/${encodeURIComponent(slug)}${token ? `?t=${encodeURIComponent(token)}` : ''}`,
    { method: 'POST', body: JSON.stringify({ answers }) },
  );

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

export interface CreateSignatureBody {
  subject: string;
  intent?: SignatureIntent;
  documentTitle: string;
  documentBody: string;
  documentRef?: string | null;
  objectId?: string | null;
  expiresAt?: string | null;
  remindAfterDays?: number;
  parties: Array<{ name: string; email: string; partyRef?: string | null }>;
}

export const createSignatureRequest = (body: CreateSignatureBody) =>
  apiRequest<{ requestId: number; status: string; invitations: Array<{ partyId: number; name: string; email: string; token: string }> }>(
    '/api/signatures',
    { method: 'POST', body: JSON.stringify(body) },
  );

export interface SignatureProgress {
  requestId: number;
  subject: string;
  intent: SignatureIntent;
  status: string;
  total: number;
  agreed: number;
  settled: number;
  parties: Array<{ name: string; email: string; status: SignaturePartyStatus; decidedAt: string | null }>;
}

export const signatureProgress = (requestId: number) =>
  apiRequest<{ request: SignatureProgress }>(`/api/signatures/${requestId}`).then((r) => r.request);

export const cancelSignatureRequest = (requestId: number) =>
  apiRequest<{ ok: true }>(`/api/signatures/${requestId}/cancel`, { method: 'POST' });

export interface SignerView {
  requestId: number;
  partyId: number;
  subject: string;
  intent: SignatureIntent;
  documentTitle: string;
  documentBody: string;
  signerName: string;
  status: SignaturePartyStatus;
  requestStatus: string;
  waitingOnOthers: boolean;
  expiresAt: string | null;
}

/** The signer's read. No session — the token is the credential. */
export const signerView = (token: string) =>
  apiRequest<{ request: SignerView }>(`/api/public/signatures/${encodeURIComponent(token)}`).then((r) => r.request);

export const signAsParty = (token: string, body: { decision: 'agree' | 'decline'; signedName?: string; declineReason?: string }) =>
  apiRequest<{ status: SignaturePartyStatus; requestStatus: string }>(
    `/api/public/signatures/${encodeURIComponent(token)}`,
    { method: 'POST', body: JSON.stringify(body) },
  );

// ---------------------------------------------------------------------------
// Payables
// ---------------------------------------------------------------------------

export interface RecordBillBody {
  reference: string;
  vendorName: string;
  vendorRef?: string | null;
  amount: number;
  taxAmount?: number | null;
  currency?: string;
  dueAt?: string | null;
  category?: string | null;
  recurring?: string;
  notes?: string | null;
  objectId?: string | null;
  lines?: Array<{ description: string; quantity?: number; unitAmount: number; amount?: number }>;
}

export const recordBill = (body: RecordBillBody) =>
  apiRequest<{ id: number }>('/api/payables/bills', { method: 'POST', body: JSON.stringify(body) });

/** The approver is taken from the SESSION on the server and is never sent — a
 *  body-supplied approver would make separation of duties a suggestion. */
export const approveBill = (billId: number) =>
  apiRequest<{ ok: true }>(`/api/payables/bills/${billId}/approve`, { method: 'POST' });

export const scheduleBillPayment = (billId: number, scheduledFor: string) =>
  apiRequest<{ ok: true }>(`/api/payables/bills/${billId}/schedule-payment`, {
    method: 'POST',
    body: JSON.stringify({ scheduledFor }),
  });

export const disputeBill = (billId: number, reason: string) =>
  apiRequest<{ ok: true }>(`/api/payables/bills/${billId}/dispute`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

// ---------------------------------------------------------------------------
// Receivables — the three acts (FO-C2), the ladder (FO-C5), the merchant (FO-C4)
// ---------------------------------------------------------------------------

export interface DraftInvoiceBody {
  reference: string;
  customerName: string;
  customerRef?: string | null;
  amount: number;
  taxAmount?: number | null;
  currency?: string;
  dueAt?: string | null;
  notes?: string | null;
  objectId?: string | null;
  collectionMode?: string;
  lines?: Array<{ description: string; quantity?: number; unitAmount: number; amount?: number }>;
}

/** Draft or re-draft a receivable. Refuses anything already issued — an issued
 *  invoice is a record of what the customer was actually sent. */
export const draftInvoice = (body: DraftInvoiceBody) =>
  apiRequest<{ id: number; reference: string; status: string }>('/api/payables/invoices', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export interface IssuedInvoice {
  reference: string;
  status: string;
  issuedAtISO: string;
  dueAtISO: string | null;
  documentUrl: string;
  paymentLinkUrl: string | null;
  deliveredTo: string | null;
  lineTotalMismatch: number | null;
}

/** The issuer comes from the SESSION on the server and is never sent — the same
 *  rule the bill approver follows, on the other side of the ledger. */
export const issueInvoice = (reference: string, body: { deliverTo?: string | null; dueAt?: string | null; message?: string | null } = {}) =>
  apiRequest<IssuedInvoice>(`/api/payables/invoices/${encodeURIComponent(reference)}/issue`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export interface RecordedPayment {
  reference: string;
  status: string;
  paidAmount: number;
  outstanding: number;
  /** False when this exact payment had already been recorded. */
  applied: boolean;
}

/** `externalRef` is the idempotency key — a bank reference, a processor's intent
 *  id, or anything stable. The same one twice is one payment. */
export const recordInvoicePayment = (
  reference: string,
  body: { amount: number; externalRef: string; method?: string; paidAt?: string | null; memo?: string | null },
) =>
  apiRequest<RecordedPayment>(`/api/payables/invoices/${encodeURIComponent(reference)}/payments`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export interface ChaseResult {
  reference: string;
  step: number;
  stepLabel: string;
  outcome: string;
  recorded: boolean;
  deliveredTo: string | null;
}

export const chaseInvoice = (
  reference: string,
  body: { step?: number; stepLabel?: string; channel?: 'email' | 'internal'; deliverTo?: string | null; subject?: string | null; body?: string | null } = {},
) =>
  apiRequest<ChaseResult>(`/api/payables/invoices/${encodeURIComponent(reference)}/chase`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export interface CollectionEntry {
  step: number;
  stepLabel: string;
  channel: string;
  outcome: string;
  detail: string | null;
  actorRef: string;
  actedAt: string;
}

export const invoiceCollectionLog = (reference: string) =>
  apiRequest<{ log: CollectionEntry[] }>(`/api/payables/invoices/${encodeURIComponent(reference)}/collection`).then((r) => r.log);

export interface OpenReceivable {
  reference: string;
  customerName: string;
  customerRef: string | null;
  amount: number;
  paidAmount: number;
  outstanding: number;
  currency: string;
  status: string;
  issuedAtISO: string | null;
  dueAtISO: string | null;
  ageingDays: number;
  collectionMode: string;
  hasPaymentLink: boolean;
  sentTo: string | null;
}

export const openReceivables = () =>
  apiRequest<{ receivables: OpenReceivable[] }>('/api/payables/receivables').then((r) => r.receivables);

export interface LadderRung { step: number; label: string; atDays: number; channel: string }

/** What will be sent, and when. A tenant delegating the chase is entitled to see
 *  the whole ladder before they turn it on. */
export const collectionLadder = () =>
  apiRequest<{ ladder: LadderRung[] }>('/api/payables/collections/ladder').then((r) => r.ladder);

export interface WorklistEntry {
  invoiceRef: string;
  step: number;
  stepLabel: string;
  channel: string;
  actedAt: string;
  customerName: string;
  amount: string;
  paidAmount: string;
  currency: string;
  dueAt: string | null;
}

export const collectionWorklist = () =>
  apiRequest<{ worklist: WorklistEntry[] }>('/api/payables/collections/worklist').then((r) => r.worklist);

export interface MerchantAccountView {
  connected: boolean;
  accountId: string | null;
  status: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  country: string | null;
  defaultCurrency: string | null;
  requirements: string[];
  connectedAtISO: string | null;
}

export const merchantAccount = () =>
  apiRequest<{ merchant: MerchantAccountView }>('/api/payables/merchant').then((r) => r.merchant);

/** Start or RESUME onboarding. Resuming is the normal case: a person who abandons
 *  the processor's form half way through must not get a second account. */
export const startMerchantOnboarding = (body: { email?: string | null; country?: string | null; returnTo?: string } = {}) =>
  apiRequest<{ onboardingUrl: string; accountId: string }>('/api/payables/merchant/onboarding', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const disconnectMerchant = () =>
  apiRequest<{ removed: boolean }>('/api/payables/merchant', { method: 'DELETE' });

// ---------------------------------------------------------------------------
// Pay runs — what payroll actually cost
// ---------------------------------------------------------------------------

export interface PayRunSummary {
  reference: string;
  source: string;
  externalRef: string;
  currency: string;
  status: string;
  periodStartISO: string | null;
  periodEndISO: string | null;
  paidAtISO: string | null;
  grossAmount: number | null;
  employerTaxes: number | null;
  totalCost: number;
  employeeCount: number;
  syncedAtISO: string;
}

export const listPayRuns = () =>
  apiRequest<{ payRuns: PayRunSummary[] }>('/api/payables/pay-runs').then((r) => r.payRuns);

export interface PayRunLine { description: string; quantity: number; unitAmount: number; amount: number; taxAmount: number | null }

export const payRunLines = (reference: string) =>
  apiRequest<{ lines: PayRunLine[] }>(`/api/payables/pay-runs/${encodeURIComponent(reference)}/lines`).then((r) => r.lines);

export interface PayRunHydration {
  source: string | null;
  imported: number;
  created: number;
  /** Which payroll connectors the workspace has. Present even on a miss, so a
   *  surface can say "connect Gusto" rather than "no data". */
  connectedSources: string[];
  error: string | null;
}

export const syncPayRuns = (body: { since?: string | null; connectorKey?: string | null; limit?: number } = {}) =>
  apiRequest<PayRunHydration>('/api/payables/pay-runs/sync', { method: 'POST', body: JSON.stringify(body) });

export interface AgeingReport {
  currency: string;
  outstanding: number;
  overdue: number;
  buckets: Array<{ label: string; count: number; amount: number }>;
}

export const ageing = (direction: 'invoice' | 'bill') =>
  apiRequest<{ ageing: AgeingReport }>(`/api/payables/ageing/${direction}`).then((r) => r.ageing);

// ---------------------------------------------------------------------------
// One account's history (FO-A3)
// ---------------------------------------------------------------------------

export interface AccountLedgerDoc {
  kind: 'invoice' | 'bill';
  reference: string;
  amount: number;
  currency: string;
  due: string | null;
  status: string;
}

export interface AccountHistory {
  accountPartyRef: string;
  openInvoices: AccountLedgerDoc[];
  openInvoicesTotal: number;
  openBills: AccountLedgerDoc[];
  openBillsTotal: number;
}

/** One `account`'s real open invoices and bills — what `canvas_sync_account`
 *  projects onto its `history` field. Always resolves, even to an empty
 *  history: an account can be real and simply have no open documents yet. */
export const accountHistory = (partyRef: string) =>
  apiRequest<AccountHistory>(`/api/payables/accounts/${encodeURIComponent(partyRef)}/history`);

// ---------------------------------------------------------------------------
// Ownership — the cap table is a PROJECTION (FO-D1..FO-D4)
// ---------------------------------------------------------------------------
//
// Every number below is FOLDED on the server from `equity_events` and computed
// on read; nothing here is a stored total, which is why there is no "save cap
// table" call and never will be. The two write calls append EVENTS — a grant
// with its issuance, and a ledger row — and the read re-folds.

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

// ---------------------------------------------------------------------------
// The pipeline projection
// ---------------------------------------------------------------------------

/**
 * WHICH board. `sales` is `deals.kind` in {sales, renewal, expansion, partner};
 * `raise` is `kind = 'investment'` — the SAME engine, read through a different
 * family, which is what FO-E1 turned `fundingRound.investors` into.
 */
export const PIPELINE_FAMILIES = ['sales', 'raise'] as const;
export type PipelineFamily = typeof PIPELINE_FAMILIES[number];

export interface ProjectedPipelineCard {
  id: string;
  /** The canonical deal id — what makes a card a HANDLE on a row rather than a
   *  copy of one, and what a drag reads back to move it. */
  dealId: number;
  lane: string;
  stage: string;
  title: string;
  note: string;
  valueCents: number | null;
  /** The counterparty's `party_roles.party_ref`: the customer on a sales deal, the
   *  FIRM on an allocation. */
  partyRef: string | null;
  warmIntro: string | null;
  probabilityPercent: number | null;
  touchCount: number;
}

export interface ProjectedPipeline {
  family: PipelineFamily;
  pipelineRef: string | null;
  stages: string[];
  lanes: Array<{ id: string; title: string; hint: string }>;
  cards: ProjectedPipelineCard[];
  syncedAt: string;
  totals: { open: number; openValueCents: number; won: number; wonValueCents: number };
}

type PipelineQuery = { family?: PipelineFamily; pipelineRef?: string; laneBy?: 'source' | 'owner' | 'none' };

const pipelineQuery = (opts: PipelineQuery): string => {
  const params = new URLSearchParams(Object.entries(opts).filter(([, v]) => v) as [string, string][]);
  return params.size ? `?${params}` : '';
};

export const readPipeline = (opts: PipelineQuery = {}) =>
  apiRequest<{ pipeline: ProjectedPipeline }>(`/api/pipeline${pipelineQuery(opts)}`).then((r) => r.pipeline);

/** Moves the DEAL and returns the board. One call, because the failure this
 *  replaces is the second write somebody forgets. Which board comes back is read
 *  off the deal's own kind — the caller never names it. */
export const moveDeal = (dealId: number, stage: string, opts: { laneBy?: 'source' | 'owner' | 'none' } = {}) =>
  apiRequest<{ pipeline: ProjectedPipeline }>(
    `/api/pipeline/deals/${dealId}/stage${pipelineQuery(opts)}`,
    { method: 'POST', body: JSON.stringify({ stage }) },
  ).then((r) => r.pipeline);

export interface OpenDealBody {
  family?: PipelineFamily;
  /** The firm or company, by name. The `party_ref` is derived server-side by the
   *  one shared slug function — never invented per caller. */
  counterparty: string;
  name?: string;
  amount?: number | null;
  currency?: string;
  stage?: string;
  pipelineRef?: string;
  ownerRef?: string;
  source?: string;
  /** Who can make the introduction. Recorded on the deal AND logged as an `intro`
   *  touch, so the warm path is an event rather than a field nobody reads. */
  introVia?: string;
  expectedCloseAt?: string;
}

/** Opens a deal against a counterparty, creating the `party_roles` row when the
 *  counterparty is new — which is what makes an investor an OBJECT (FO-E1). */
export const openDeal = (body: OpenDealBody) =>
  apiRequest<{ dealId: number; partyRef: string; created: boolean; pipeline: ProjectedPipeline }>(
    '/api/pipeline/deals',
    { method: 'POST', body: JSON.stringify(body) },
  );

export interface DealThreadEntry {
  id: number;
  dealId: number;
  channel: string;
  direction: string;
  summary: string;
  contactRef: string | null;
  occurredAt: string;
}

/** One deal's conversation, newest first — the per-investor thread a rows table
 *  could never hold. */
export const dealThread = (dealId: number) =>
  apiRequest<{ thread: DealThreadEntry[] }>(`/api/pipeline/deals/${dealId}/touchpoints`).then((r) => r.thread);

export const logDealTouch = (dealId: number, body: { summary: string; channel?: string; direction?: string; contactRef?: string; occurredAt?: string }) =>
  apiRequest<{ thread: DealThreadEntry[] }>(
    `/api/pipeline/deals/${dealId}/touchpoints`,
    { method: 'POST', body: JSON.stringify(body) },
  ).then((r) => r.thread);

// ---------------------------------------------------------------------------
// Co-founder matching
// ---------------------------------------------------------------------------

export const COFOUNDER_STRENGTHS = ['technical', 'commercial', 'product', 'operations'] as const;
export type CofounderStrength = typeof COFOUNDER_STRENGTHS[number];

export const COFOUNDER_COMMITMENTS = ['full-time', 'part-time', 'nights-weekends', 'advisory'] as const;
export type CofounderCommitment = typeof COFOUNDER_COMMITMENTS[number];

export interface CofounderProfile {
  id: number;
  headline: string;
  bio: string | null;
  strength: CofounderStrength;
  seeking: CofounderStrength;
  brings: string[] | null;
  needs: string[] | null;
  commitment: CofounderCommitment;
  equityExpectation: string | null;
  location: string | null;
  remoteOk: boolean;
  sectors: string[] | null;
  stage: string | null;
  status: string;
  visibility: string;
}

export interface MatchReason {
  dimension: 'complementarity' | 'skills' | 'commitment' | 'equity' | 'location' | 'sector';
  points: number;
  detail: string;
}

export interface CofounderMatch {
  profileId: number;
  headline: string;
  bio: string | null;
  strength: CofounderStrength;
  seeking: CofounderStrength;
  commitment: CofounderCommitment;
  location: string | null;
  remoteOk: boolean;
  stage: string | null;
  brings: string[];
  score: number;
  reasons: MatchReason[];
  introduction: { id: number; status: string; outbound: boolean } | null;
}

export const myCofounderProfile = () =>
  apiRequest<{ profile: CofounderProfile | null }>('/api/cofounder/profile').then((r) => r.profile);

export const saveCofounderProfile = (body: Partial<CofounderProfile> & { headline: string; strength: string; seeking: string }) =>
  apiRequest<{ id: number }>('/api/cofounder/profile', { method: 'PUT', body: JSON.stringify(body) });

export const cofounderMatches = () =>
  apiRequest<{ profile: CofounderProfile; matches: CofounderMatch[] }>('/api/cofounder/matches');

export const requestIntroduction = (toProfileId: number, message: string) =>
  apiRequest<{ id: number }>('/api/cofounder/introductions', {
    method: 'POST',
    body: JSON.stringify({ toProfileId, message }),
  });

export const respondToIntroduction = (introductionId: number, decision: 'accepted' | 'declined') =>
  apiRequest<{ ok: true; status: string }>(`/api/cofounder/introductions/${introductionId}/respond`, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  });

// ---------------------------------------------------------------------------
// The investor update
// ---------------------------------------------------------------------------

export interface SendInvestorUpdateBody {
  content: Record<string, unknown>;
  recipients: Array<{ email: string; name?: string | null }>;
  objectId?: string | null;
  /** The transport binding, passed straight through to `campaignTransports`.
   *  Omitted means the platform sender with the workspace's verified identity. */
  binding?: Record<string, unknown>;
}

export const sendInvestorUpdate = (body: SendInvestorUpdateBody) =>
  apiRequest<{ sent: number; failed: Array<{ email: string; error: string; retryable: boolean }>; transport: string; fromLabel: string }>(
    '/api/investor-updates/send',
    { method: 'POST', body: JSON.stringify(body) },
  );

// ---------------------------------------------------------------------------
// Document templates (FO-D5) — the founders' agreement and its siblings
// ---------------------------------------------------------------------------

export interface DocumentTemplateVariable {
  name: string;
  label: string;
  kind: 'text' | 'longText' | 'date' | 'number' | 'parties';
  required: boolean;
  hint: string;
}

export interface DocumentTemplateSummary {
  key: string;
  title: string;
  purpose: string;
  category: string;
  contractType: string;
  intent: 'sign' | 'acknowledge';
  variables: DocumentTemplateVariable[];
}

export interface TemplateParty {
  name: string;
  email: string;
  role: string;
  share: number | null;
  contribution: string;
}

export interface RenderedDocument {
  key: string;
  title: string;
  category: string;
  contractType: string;
  intent: 'sign' | 'acknowledge';
  body: string;
  parties: TemplateParty[];
}

export const documentTemplates = () =>
  apiRequest<{ templates: DocumentTemplateSummary[] }>('/api/document-templates').then((r) => r.templates);

/** The text and NOTHING else — so a founders' agreement can be read and argued
 *  about before anybody is asked to sign it. */
export const renderDocumentTemplate = (key: string, values: Record<string, unknown>) =>
  apiRequest<{ document: RenderedDocument }>(`/api/document-templates/${encodeURIComponent(key)}/render`, {
    method: 'POST',
    body: JSON.stringify({ values }),
  }).then((r) => r.document);

/** Render AND send for signature, in one call. The signers default to the parties
 *  the DOCUMENT names, so who signs cannot disagree with the text. */
export const sendDocumentTemplate = (key: string, body: {
  values: Record<string, unknown>;
  parties?: Array<{ name: string; email: string; partyRef?: string | null }>;
  objectId?: string | null;
  subject?: string;
  expiresAt?: string;
  remindAfterDays?: number;
}) =>
  apiRequest<{ requestId: number; status: string; document: RenderedDocument; delivery: { sent: number; failed: number } }>(
    `/api/document-templates/${encodeURIComponent(key)}/send`,
    { method: 'POST', body: JSON.stringify(body) },
  );

// ---------------------------------------------------------------------------
// The data room (FO-E2) — sharing it, and what the firm actually read
// ---------------------------------------------------------------------------

export type DataRoomNdaState = 'not-required' | 'pending' | 'signed' | 'declined' | 'expired';

export interface DataRoomShareResult {
  shareId: string;
  /** The plaintext credential, returned EXACTLY once — only the hash is stored. */
  token: string;
  permission: 'view' | 'download';
  expiresAt: string | null;
  ndaState: 'not-required' | 'pending';
  ndaSignatureRequestId: number | null;
  /** True when the room watermarks and the requested download was refused. */
  downloadRefusedByWatermark: boolean;
}

export interface DataRoomShareSummary {
  shareId: string;
  recipientName: string | null;
  recipientEmail: string | null;
  firmPartyRef: string | null;
  permission: string;
  state: 'active' | 'revoked' | 'expired';
  ndaState: DataRoomNdaState;
  expiresAt: string | null;
  createdAt: string;
}

export interface DataRoomAnalytics {
  dataRoomId: number;
  opens: number;
  documentViews: number;
  recipients: Array<{ recipientEmail: string; opens: number; documentViews: number; lastSeen: string | null }>;
  documents: Array<{ documentId: number; label: string; views: number; lastViewedAt: string | null }>;
}

export interface DataRoomDocumentRow {
  documentId: number;
  label: string;
  category: string;
  status: string;
  required: boolean;
  available: boolean;
  mime: string | null;
  sizeBytes: number | null;
}

export interface DataRoomSummary {
  id: number;
  objectId: string | null;
  name: string;
  purpose: string | null;
  status: string;
  ndaRequired: boolean;
  watermark: boolean;
  expiresAt: string | null;
  documents: DataRoomDocumentRow[];
  /** Share of REQUIRED documents actually provided, 0-100 — computed, never
   *  authored. A room with nothing required reads 0, not 100. */
  readiness: number;
  activeShares: number;
  opens: number;
  documentViews: number;
}

export const listDataRooms = () =>
  apiRequest<{ rooms: DataRoomSummary[] }>('/api/data-rooms').then((r) => r.rooms);

export const shareDataRoom = (dataRoomId: number, body: {
  recipientName: string;
  recipientEmail: string;
  firmPartyRef?: string | null;
  permission?: 'view' | 'download';
  expiresAt?: string | null;
  jurisdiction?: string | null;
  purpose?: string | null;
}) =>
  apiRequest<DataRoomShareResult>(`/api/data-rooms/${dataRoomId}/share`, { method: 'POST', body: JSON.stringify(body) });

export const dataRoomShares = (dataRoomId: number) =>
  apiRequest<{ shares: DataRoomShareSummary[] }>(`/api/data-rooms/${dataRoomId}/shares`).then((r) => r.shares);

export const revokeDataRoomShare = (shareId: string) =>
  apiRequest<{ ok: true }>(`/api/data-rooms/shares/${encodeURIComponent(shareId)}/revoke`, { method: 'POST' });

export const dataRoomAnalytics = (dataRoomId: number) =>
  apiRequest<{ analytics: DataRoomAnalytics }>(`/api/data-rooms/${dataRoomId}/analytics`).then((r) => r.analytics);

export interface PublicDataRoomDocument {
  documentId: number;
  label: string;
  category: string;
  status: string;
  required: boolean;
  available: boolean;
  mime: string | null;
  sizeBytes: number | null;
}

export interface PublicDataRoomShare {
  shareId: string;
  dataRoomId: number;
  roomName: string;
  recipientName: string | null;
  recipientEmail: string | null;
  permission: 'view' | 'download';
  watermark: boolean;
  watermarkLabel: string | null;
  ndaState: DataRoomNdaState;
  expiresAt: string | null;
  documents: PublicDataRoomDocument[];
}

export type PublicDataRoomView =
  | { outcome: 'ok'; share: PublicDataRoomShare }
  | { outcome: 'nda-pending'; roomName: string; ndaState: DataRoomNdaState };

/** The recipient's read. No session — the token is the credential. */
export const publicDataRoom = (token: string) =>
  apiRequest<PublicDataRoomView>(`/api/public/data-rooms/${encodeURIComponent(token)}`);

/** A plain address the browser streams from, exactly like the legal-document
 *  share: the server's own `Content-Disposition` is what enforces inline-vs-save
 *  (a watermarked room is always inline), and re-fetching the bytes into a blob
 *  here would buy nothing. */
export function dataRoomDocumentUrl(token: string, documentId: number): string {
  return `${getApiBaseUrl()}/api/public/data-rooms/${encodeURIComponent(token)}/documents/${documentId}`;
}
