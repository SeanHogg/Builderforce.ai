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

import { apiRequest } from '@/lib/apiClient';
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
// The pipeline projection
// ---------------------------------------------------------------------------

export interface ProjectedPipeline {
  pipelineRef: string | null;
  stages: string[];
  lanes: Array<{ id: string; title: string; hint: string }>;
  cards: Array<{ id: string; dealId: number; lane: string; stage: string; title: string; note: string; valueCents: number | null }>;
  syncedAt: string;
  totals: { open: number; openValueCents: number; won: number; wonValueCents: number };
}

export const readPipeline = (opts: { pipelineRef?: string; laneBy?: 'source' | 'owner' | 'none' } = {}) => {
  const params = new URLSearchParams(Object.entries(opts).filter(([, v]) => v) as [string, string][]);
  return apiRequest<{ pipeline: ProjectedPipeline }>(`/api/pipeline${params.size ? `?${params}` : ''}`).then((r) => r.pipeline);
};

/** Moves the DEAL and returns the board. One call, because the failure this
 *  replaces is the second write somebody forgets. */
export const moveDeal = (dealId: number, stage: string, opts: { laneBy?: 'source' | 'owner' | 'none' } = {}) => {
  const params = new URLSearchParams(Object.entries(opts).filter(([, v]) => v) as [string, string][]);
  return apiRequest<{ pipeline: ProjectedPipeline }>(
    `/api/pipeline/deals/${dealId}/stage${params.size ? `?${params}` : ''}`,
    { method: 'POST', body: JSON.stringify({ stage }) },
  ).then((r) => r.pipeline);
};

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
