import { apiRequest } from './apiClient';

/**
 * Client mirror of what happens to a site AFTER it is published — custom
 * domains, the site's form endpoints and their submissions, traffic, and tenant
 * marketing campaigns.
 *
 * Server counterparts:
 *   api/src/presentation/routes/siteManageRoutes.ts   (/api/projects/:id/site/*)
 *   api/src/presentation/routes/campaignRoutes.ts     (/api/growth/*)
 */

// ---------------------------------------------------------------------------
// Custom domain
// ---------------------------------------------------------------------------

export type CustomDomainStatus = 'unset' | 'pending_dns' | 'pending_certificate' | 'active' | 'failed';

export interface DomainInstructions {
  txt: { name: string; value: string };
  cname: { name: string; value: string };
}

export interface CustomDomainState {
  hostname: string | null;
  status: CustomDomainStatus;
  verifiedAt: string | null;
  error: string | null;
  instructions: DomainInstructions | null;
  live: boolean;
  apex?: string;
  /** null while still pending DNS — the check is skipped until then. */
  cnamePointsAtUs?: boolean | null;
}

const siteBase = (projectId: number | string) => `/api/projects/${projectId}/site`;

export const siteDomainApi = {
  get: (projectId: number | string): Promise<CustomDomainState> =>
    apiRequest(`${siteBase(projectId)}/domain`),

  claim: (projectId: number | string, hostname: string): Promise<CustomDomainState> =>
    apiRequest(`${siteBase(projectId)}/domain`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostname }),
    }),

  verify: (projectId: number | string): Promise<CustomDomainState> =>
    apiRequest(`${siteBase(projectId)}/domain/verify`, { method: 'POST' }),

  release: (projectId: number | string): Promise<CustomDomainState> =>
    apiRequest(`${siteBase(projectId)}/domain`, { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// Site backend: collections + records
// ---------------------------------------------------------------------------

export interface SiteCollection {
  id: number;
  name: string;
  acceptsPublicWrites: boolean;
  audienceId: number | null;
  recordCount: number;
  dailyWriteCap: number;
  createdAt: string;
  /** Absolute URL a form should post to — computed server-side. */
  endpoint: string;
}

export interface SiteRecord {
  id: number;
  payload: Record<string, unknown>;
  email: string | null;
  referrer: string | null;
  createdAt: string;
}

export const siteDataApi = {
  listCollections: (projectId: number | string): Promise<{ collections: SiteCollection[] }> =>
    apiRequest(`${siteBase(projectId)}/collections`),

  createCollection: (projectId: number | string, name: string): Promise<SiteCollection> =>
    apiRequest(`${siteBase(projectId)}/collections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),

  updateCollection: (
    projectId: number | string,
    collectionId: number,
    patch: { acceptsPublicWrites?: boolean; audienceId?: number | null; dailyWriteCap?: number },
  ): Promise<SiteCollection> =>
    apiRequest(`${siteBase(projectId)}/collections/${collectionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),

  listRecords: (
    projectId: number | string,
    collectionId: number,
    limit = 50,
  ): Promise<{ records: SiteRecord[] }> =>
    apiRequest(`${siteBase(projectId)}/collections/${collectionId}/records?limit=${limit}`),
};

// ---------------------------------------------------------------------------
// Traffic
// ---------------------------------------------------------------------------

export interface TrafficDay {
  day: string;
  pageViews: number;
  assetHits: number;
  visitors: number;
  bytesServed: number;
}

export interface SiteTrafficSummary {
  days: TrafficDay[];
  totals: { pageViews: number; visitors: number; assetHits: number; bytesServed: number };
  /** Always true — the counts are buffered per isolate. The UI must say so. */
  approximate: boolean;
}

export const siteTrafficApi = {
  get: (projectId: number | string, days: 7 | 30 | 90 = 30): Promise<SiteTrafficSummary> =>
    apiRequest(`${siteBase(projectId)}/traffic?days=${days}`),
};

// ---------------------------------------------------------------------------
// Marketing
// ---------------------------------------------------------------------------

export interface Audience {
  id: number;
  name: string;
  description: string;
  memberCount: number;
  projectId: number | null;
  updatedAt: string;
}

export interface SenderIdentity {
  id: number;
  fromEmail: string;
  fromName: string;
  replyTo: string | null;
  status: 'pending' | 'verified' | 'failed' | string;
  verifyToken: string;
  verifiedAt: string | null;
  lastError: string | null;
  /** The TXT record name to publish — computed server-side. */
  recordName: string;
}

export interface Campaign {
  id: number;
  name: string;
  subject: string;
  status: 'draft' | 'sending' | 'sent' | 'failed' | 'cancelled' | string;
  audienceId: number;
  senderIdentityId: number | null;
  projectId: number | null;
  recipients: number;
  sent: number;
  failed: number;
  suppressed: number;
  opened: number;
  clicked: number;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

const GROWTH = '/api/growth';

export const growthApi = {
  listAudiences: (): Promise<{ audiences: Audience[] }> => apiRequest(`${GROWTH}/audiences`),

  createAudience: (body: { name: string; description?: string; projectId?: number }): Promise<Audience> =>
    apiRequest(`${GROWTH}/audiences`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),

  addMembers: (
    audienceId: number,
    members: Array<{ email: string; name?: string }>,
  ): Promise<{ added: number; updated: number; rejected: number }> =>
    apiRequest(`${GROWTH}/audiences/${audienceId}/members`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ members }),
    }),

  listSenders: (): Promise<{ senders: SenderIdentity[] }> => apiRequest(`${GROWTH}/senders`),

  createSender: (body: { fromEmail: string; fromName?: string; replyTo?: string }): Promise<SenderIdentity> =>
    apiRequest(`${GROWTH}/senders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),

  verifySender: (senderId: number): Promise<SenderIdentity> =>
    apiRequest(`${GROWTH}/senders/${senderId}/verify`, { method: 'POST' }),

  listCampaigns: (): Promise<{ campaigns: Campaign[] }> => apiRequest(`${GROWTH}/campaigns`),

  createCampaign: (body: {
    name: string; audienceId: number; subject?: string; bodyHtml?: string;
    senderIdentityId?: number; projectId?: number;
  }): Promise<Campaign> =>
    apiRequest(`${GROWTH}/campaigns`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),

  updateCampaign: (
    campaignId: number,
    patch: { name?: string; subject?: string; bodyHtml?: string; senderIdentityId?: number; audienceId?: number },
  ): Promise<Campaign> =>
    apiRequest(`${GROWTH}/campaigns/${campaignId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    }),

  send: (campaignId: number): Promise<{
    campaign: Campaign; queued: number; suppressed: number;
    batch: { sent: number; failed: number; remaining: number; status: string };
  }> => apiRequest(`${GROWTH}/campaigns/${campaignId}/send`, { method: 'POST' }),
};

/**
 * A campaign is ready to send only when all four hold. Exported so the button's
 * disabled state and the reason shown next to it are decided ONCE — a
 * prop-drilled `canSend` boolean would let the two drift apart.
 */
export function campaignBlockers(
  campaign: Campaign,
  senders: SenderIdentity[],
  audiences: Audience[],
): Array<'status' | 'subject' | 'sender' | 'audience'> {
  const blockers: Array<'status' | 'subject' | 'sender' | 'audience'> = [];
  if (campaign.status !== 'draft') blockers.push('status');
  if (!campaign.subject.trim()) blockers.push('subject');
  const sender = senders.find((s) => s.id === campaign.senderIdentityId);
  if (!sender || sender.status !== 'verified') blockers.push('sender');
  const audience = audiences.find((a) => a.id === campaign.audienceId);
  if (!audience || audience.memberCount === 0) blockers.push('audience');
  return blockers;
}
