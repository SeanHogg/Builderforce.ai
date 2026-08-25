/**
 * Typed client for the CEO's raise — `/api/investor/*` and the public grant.
 *
 * A component never embeds a fetch: the wire shape is stated once here, so the
 * Companies view, the Investors view and the pack are all reading the same
 * contract as the server writes. Room-level reads stay in `founderOpsApi.ts`
 * (`listDataRooms`, `shareDataRoom`, `dataRoomShares`, `dataRoomAnalytics`) —
 * this file is the COMPANY level, and duplicating the room client here would be
 * two clients for one surface.
 *
 * `apiRequest` is THE transport (`lib/apiClient.ts`) — the emulation token, the
 * locale header, the 401 redirect and the typed 402 all live in it.
 */

import { apiRequest, getApiBaseUrl } from './apiClient';

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

export interface CompanyRound {
  id: number;
  name: string;
  round: string | null;
  askAmount: string | null;
  preMoney: string | null;
  currency: string;
  status: string;
  leadRef: string | null;
  decidedAt: string | null;
  updatedAt: string;
}

export interface CompanySummary {
  id: number;
  objectId: string | null;
  name: string;
  slug: string | null;
  website: string | null;
  stage: string | null;
  sector: string | null;
  country: string | null;
  headcount: number | null;
  arr: string | null;
  valuation: string | null;
  currency: string;
  isPortfolio: boolean;
  /** How much delivery this company owns (IN-1). Zero is a real answer: projects
   *  that predate any company row were deliberately never backfilled. */
  projectCount: number;
  dataRoomCount: number;
  /** REQUIRED diligence documents still at `requested` — the holes in the raise. */
  openGaps: number;
  openRound: CompanyRound | null;
  updatedAt: string;
}

export interface CompanyProject {
  id: number;
  publicId: string;
  key: string;
  name: string;
  description: string | null;
  status: string;
  updatedAt: string;
}

/**
 * One REQUIRED diligence document still at `requested`.
 *
 * `domain` and `seat` arrive RESOLVED from the server's own
 * `SEAT_FOR_CATEGORY` — the surface never re-maps a category to a seat, because
 * two mappings is how a panel and a document come to disagree about who owns
 * "commercial".
 */
export interface DiligenceGap {
  documentId: number;
  checklistId: number;
  checklistName: string;
  label: string;
  category: string;
  domain: string | null;
  seat: string | null;
  note: string | null;
  dueAt: string | null;
}

export interface CompanyDetail extends CompanySummary {
  projects: CompanyProject[];
  rooms: Array<{ id: number; name: string; status: string; purpose: string | null; ndaRequired: boolean; watermark: boolean }>;
  rounds: CompanyRound[];
  gaps: DiligenceGap[];
  /** Required documents settled over required documents. 0 when nothing is
   *  required — an unprepared raise, not a complete one. */
  readiness: number;
}

export interface CreateCompanyBody {
  name: string;
  website?: string | null;
  stage?: string | null;
  sector?: string | null;
  country?: string | null;
  headcount?: number | null;
  arr?: string | null;
  valuation?: string | null;
  currency?: string | null;
  isPortfolio?: boolean;
}

// ---------------------------------------------------------------------------
// Investor grants (IN-2)
// ---------------------------------------------------------------------------

export type InvestorNdaState = 'not-required' | 'pending' | 'signed' | 'declined' | 'expired';

export interface InvestorGrantSummary {
  grantId: string;
  recipientName: string;
  recipientEmail: string;
  firmPartyRef: string | null;
  permission: string;
  state: 'active' | 'revoked' | 'expired';
  ndaState: InvestorNdaState;
  membershipState: string | null;
  expiresAt: string | null;
  createdAt: string;
  roomsOpened: number;
  documentViews: number;
  lastSeen: string | null;
}

export interface CreatedInvestorGrant {
  grantId: string;
  invitationId: string;
  /** The plaintext credential, returned EXACTLY once — only hashes are stored,
   *  so it cannot be read back and must be handed over from this response. */
  token: string;
  companyId: number;
  recipientEmail: string;
  permission: 'view' | 'download';
  expiresAt: string | null;
  ndaState: 'not-required' | 'pending';
  ndaSignatureRequestId: number | null;
  downloadRefusedByWatermark: boolean;
}

export interface CompanyInvestorAnalytics {
  companyId: number;
  opens: number;
  documentViews: number;
  investors: Array<{ recipientEmail: string; opens: number; documentViews: number; roomsReached: number; lastSeen: string | null }>;
  documents: Array<{ documentId: string; label: string; views: number; lastViewedAt: string | null }>;
}

// ---------------------------------------------------------------------------
// The pack (IN-4)
// ---------------------------------------------------------------------------

/** What the pack's financial section is built from. Mirrors the server's
 *  `PACK_GROUNDING`, and is RENDERED rather than restated in page copy — a
 *  sentence written twice is a claim free to outrun the code. */
export interface PackGrounding {
  financials: 'declared' | 'ledger';
  notice: string;
}

export interface BuiltPack {
  requestId: string;
  responseId: string | null;
  companyId: number;
  companyName: string;
  groundedOnProjectId: number | null;
  projectsCited: number;
  openGaps: number;
  grounding: PackGrounding;
}

export interface PackSummary {
  requestId: string;
  companyId: number;
  title: string;
  status: string;
  updatedAt: string;
  responses: Array<{ id: string; status: string; createdAt: string }>;
  grounding: PackGrounding;
}

// ---------------------------------------------------------------------------

const post = <T>(path: string, payload?: unknown): Promise<T> =>
  apiRequest<T>(path, { method: 'POST', ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });

export const investorApi = {
  companies: {
    list: (): Promise<CompanySummary[]> =>
      apiRequest<{ companies: CompanySummary[] }>('/api/investor/companies').then((r) => r.companies),
    get: (id: number): Promise<CompanyDetail> =>
      apiRequest<{ company: CompanyDetail }>(`/api/investor/companies/${id}`).then((r) => r.company),
    create: (body: CreateCompanyBody): Promise<CompanySummary> =>
      post<{ company: CompanySummary }>('/api/investor/companies', body).then((r) => r.company),
  },

  /** IN-1 — a company owns the work being done inside it. Attaching is an ACT,
   *  never a name match: nothing infers this edge from a project's title. */
  projects: {
    available: (companyId: number): Promise<CompanyProject[]> =>
      apiRequest<{ projects: CompanyProject[] }>(`/api/investor/companies/${companyId}/projects/available`).then((r) => r.projects),
    attach: (companyId: number, projectId: number): Promise<{ ok: true }> =>
      post(`/api/investor/companies/${companyId}/projects`, { projectId }),
    detach: (companyId: number, projectId: number): Promise<{ ok: true }> =>
      apiRequest<{ ok: true }>(`/api/investor/companies/${companyId}/projects/${projectId}`, { method: 'DELETE' }),
  },

  /** IN-2 — the grant is on the COMPANY. One NDA, one watermark identity, one
   *  expiry, one revocation, across every room the company has and will have. */
  investors: {
    list: (companyId: number): Promise<InvestorGrantSummary[]> =>
      apiRequest<{ investors: InvestorGrantSummary[] }>(`/api/investor/companies/${companyId}/investors`).then((r) => r.investors),
    invite: (companyId: number, body: {
      recipientName: string;
      recipientEmail: string;
      firmPartyRef?: string | null;
      permission?: 'view' | 'download';
      expiresAt?: string | null;
      jurisdiction?: string | null;
      purpose?: string | null;
      message?: string | null;
    }): Promise<CreatedInvestorGrant> => post(`/api/investor/companies/${companyId}/investors`, body),
    revoke: (companyId: number, grantId: string): Promise<{ ok: true; roomSharesRevoked: number }> =>
      post(`/api/investor/companies/${companyId}/investors/${encodeURIComponent(grantId)}/revoke`),
    analytics: (companyId: number): Promise<CompanyInvestorAnalytics> =>
      apiRequest<{ analytics: CompanyInvestorAnalytics }>(`/api/investor/companies/${companyId}/investors/analytics`).then((r) => r.analytics),
  },

  /** IN-4 — the pack. `rfpService` company-scoped, not a second generator, so the
   *  document is rendered by the ONE renderer at `/api/rfp/responses/:id/document`. */
  pack: {
    list: (companyId: number): Promise<PackSummary[]> =>
      apiRequest<{ packs: PackSummary[] }>(`/api/investor/companies/${companyId}/pack`).then((r) => r.packs),
    build: (companyId: number, body: { projectId?: number | null; audience?: string | null; emphasis?: string | null } = {}): Promise<BuiltPack> =>
      post(`/api/investor/companies/${companyId}/pack`, body),
  },
};

/** The rendered pack, as a plain address the browser opens. The ONE renderer —
 *  the same endpoint a tender response is read through, so the two can never
 *  quote different numbers. `?format=pdf` returns real PDF bytes. */
export function packDocumentUrl(responseId: string, format?: 'pdf'): string {
  const suffix = format === 'pdf' ? '?format=pdf' : '';
  return `${getApiBaseUrl()}/api/rfp/responses/${encodeURIComponent(responseId)}/document${suffix}`;
}

// ---------------------------------------------------------------------------
// The investor's own read — no session, the token is the credential
// ---------------------------------------------------------------------------

export interface PublicInvestorGrant {
  companyId: number;
  companyName: string;
  recipientName: string;
  recipientEmail: string;
  permission: 'view' | 'download';
  ndaState: InvestorNdaState;
  expiresAt: string | null;
  /** Every room the grant reaches — including rooms created AFTER it was minted,
   *  which is half the point of a company-level grant. */
  rooms: Array<{ id: number; name: string; purpose: string | null; ndaRequired: boolean; watermark: boolean }>;
}

export type PublicInvestorView =
  | { outcome: 'ok'; grant: PublicInvestorGrant }
  | { outcome: 'nda-pending'; companyName: string; ndaState: InvestorNdaState };

export const publicInvestorGrant = (token: string) =>
  apiRequest<PublicInvestorView>(`/api/public/investor/${encodeURIComponent(token)}`);

/** One room, opened THROUGH the company grant. The per-room share is derived
 *  server-side on this call, so a room built after the grant is reached by it. */
export const publicInvestorRoom = (token: string, roomId: number) =>
  apiRequest<
    | { outcome: 'ok'; share: import('./founderOpsApi').PublicDataRoomShare }
    | { outcome: 'nda-pending'; roomName: string; ndaState: InvestorNdaState }
  >(`/api/public/investor/${encodeURIComponent(token)}/rooms/${roomId}`);

/** A plain address the browser streams from. The server's own
 *  `Content-Disposition` enforces inline-vs-save (a watermarked room is always
 *  inline unless the stamp actually landed), so re-fetching into a blob here
 *  would buy nothing and would strip the header that is doing the work. */
export function investorDocumentUrl(token: string, roomId: number, documentId: string): string {
  return `${getApiBaseUrl()}/api/public/investor/${encodeURIComponent(token)}/rooms/${roomId}/documents/${encodeURIComponent(documentId)}`;
}
