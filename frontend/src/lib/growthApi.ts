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

/**
 * How a campaign leaves the building. Mirrors `CAMPAIGN_TRANSPORTS` server-side.
 *   platform  a DNS-verified sender identity, delivered by Builderforce
 *   mailbox   the tenant's own connected Microsoft 365 / Gmail account
 *   sendgrid  the tenant's Twilio SendGrid connection
 */
export type CampaignTransport = 'platform' | 'mailbox' | 'sendgrid';

export interface EmailTemplate {
  id: number;
  name: string;
  description: string;
  subject: string;
  bodyHtml: string;
  source: 'builtin' | 'custom' | 'imported' | 'generated' | string;
  assetId: number | null;
  /** Placeholders the body references beyond the always-available name/email/
   *  logo/unsubscribe — i.e. the attributes the audience has to carry. */
  mergeFields: string[];
  updatedAt: string;
}

/**
 * What a stored asset IS. `logo` is a ROLE an image plays — templates reference
 * it as `{{logo}}` rather than by id — which is why it sits beside the two media
 * classes instead of above them.
 */
export type AssetKind = 'logo' | 'image' | 'video';

export interface MarketingAsset {
  id: number;
  name: string;
  kind: AssetKind | string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  source: 'uploaded' | 'generated' | string;
  prompt: string | null;
  /** Absolute, session-less URL — what a template's <img src> points at. */
  url: string;
  updatedAt: string;
}

export interface Campaign {
  id: number;
  name: string;
  subject: string;
  bodyHtml: string;
  status: 'draft' | 'sending' | 'sent' | 'failed' | 'cancelled' | string;
  audienceId: number;
  senderIdentityId: number | null;
  transport: CampaignTransport | string;
  mailboxConnectionId: number | null;
  connectorConnectionId: string | null;
  templateId: number | null;
  fromName: string;
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
    senderIdentityId?: number; projectId?: number; templateId?: number;
    transport?: CampaignTransport; mailboxConnectionId?: number;
    connectorConnectionId?: string; fromName?: string;
  }): Promise<Campaign> =>
    apiRequest(`${GROWTH}/campaigns`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),

  updateCampaign: (
    campaignId: number,
    patch: {
      name?: string; subject?: string; bodyHtml?: string; senderIdentityId?: number | null;
      audienceId?: number; templateId?: number | null; transport?: CampaignTransport;
      mailboxConnectionId?: number | null; connectorConnectionId?: string | null; fromName?: string;
    },
  ): Promise<Campaign> =>
    apiRequest(`${GROWTH}/campaigns/${campaignId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    }),

  send: (campaignId: number): Promise<{
    campaign: Campaign; queued: number; suppressed: number;
    batch: { sent: number; failed: number; remaining: number; status: string };
  }> => apiRequest(`${GROWTH}/campaigns/${campaignId}/send`, { method: 'POST' }),

  // ---- templates -------------------------------------------------------

  listTemplates: (): Promise<{ templates: EmailTemplate[] }> => apiRequest(`${GROWTH}/templates`),

  /** Create OR import — one endpoint, because an import is a create whose body
   *  came from outside, and both go through the same server-side sanitizer. */
  createTemplate: (body: {
    name: string; subject?: string; bodyHtml?: string; description?: string;
    source?: 'custom' | 'imported'; assetId?: number;
  }): Promise<EmailTemplate> =>
    apiRequest(`${GROWTH}/templates`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),

  updateTemplate: (
    templateId: number,
    patch: { name?: string; subject?: string; bodyHtml?: string; description?: string; assetId?: number | null },
  ): Promise<EmailTemplate> =>
    apiRequest(`${GROWTH}/templates/${templateId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    }),

  deleteTemplate: (templateId: number): Promise<void> =>
    apiRequest(`${GROWTH}/templates/${templateId}`, { method: 'DELETE' }),

  // ---- assets (logos, images + videos) ----------------------------------

  listAssets: (kind?: AssetKind): Promise<{ assets: MarketingAsset[] }> =>
    apiRequest(`${GROWTH}/assets${kind ? `?kind=${kind}` : ''}`),

  /** multipart, not base64 JSON — a 2 MB logo would inflate to 2.7 MB on the
   *  wire, and a 32 MB clip to 43 MB. No Content-Type header: the browser must
   *  set the form boundary. */
  uploadAsset: (file: File, kind?: AssetKind, name?: string): Promise<MarketingAsset> => {
    const form = new FormData();
    form.append('file', file);
    // Only sent when the caller MEANS it. The server reads the kind off the
    // bytes otherwise, so a hard-coded 'image' here is how an MP4 gets filed as
    // a picture.
    if (kind) form.append('kind', kind);
    if (name) form.append('name', name);
    return apiRequest(`${GROWTH}/assets`, { method: 'POST', body: form });
  },

  /**
   * Store media the caller does NOT hold as a `File` — a `data:` URI the board
   * generated, or a stock `https` URL — and get its public token URL back.
   *
   * The same route as {@link uploadAsset}, in its JSON encoding, because it is
   * the same act. A canvas creative object has pixels but no File, and Instagram
   * and TikTok fetch media themselves with no session, so this is the step
   * between "the board made this" and "this can be published".
   */
  createAssetFromSource: (body: { source: string; name?: string; kind?: AssetKind }): Promise<MarketingAsset> =>
    apiRequest(`${GROWTH}/assets`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),

  generateLogo: (body: { description: string; style?: string; name?: string }): Promise<MarketingAsset> =>
    apiRequest(`${GROWTH}/assets/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),

  deleteAsset: (assetId: number): Promise<void> =>
    apiRequest(`${GROWTH}/assets/${assetId}`, { method: 'DELETE' }),
};

export type CampaignBlocker = 'status' | 'subject' | 'sender' | 'audience' | 'mailbox' | 'connection';

/**
 * Why a campaign cannot send yet.
 *
 * Exported so the button's disabled state and the reason shown next to it are
 * decided ONCE — a prop-drilled `canSend` boolean would let the two drift apart.
 *
 * The identity check is TRANSPORT-DEPENDENT, and getting that wrong is not
 * cosmetic: a mailbox campaign has no sender identity at all, so the old
 * unconditional "is the sender verified?" test would disable a campaign that is
 * perfectly ready and give a reason that makes no sense for it. This mirrors the
 * server's `resolveCampaignSender` — the client must not offer a send the server
 * will refuse, nor block one it would accept.
 */
export function campaignBlockers(
  campaign: Campaign,
  senders: SenderIdentity[],
  audiences: Audience[],
  mailboxes: Array<{ id: number; status: string; allowSending: boolean }> = [],
): CampaignBlocker[] {
  const blockers: CampaignBlocker[] = [];
  if (campaign.status !== 'draft') blockers.push('status');
  if (!campaign.subject.trim()) blockers.push('subject');

  if (campaign.transport === 'mailbox') {
    const mailbox = mailboxes.find((m) => m.id === campaign.mailboxConnectionId);
    if (!mailbox || mailbox.status !== 'connected' || !mailbox.allowSending) blockers.push('mailbox');
  } else {
    // Platform AND SendGrid both send AS a verified identity — SendGrid enforces
    // its own sender verification, so the connector only replaces the delivery
    // pipe, never the identity model.
    const sender = senders.find((s) => s.id === campaign.senderIdentityId);
    if (!sender || sender.status !== 'verified') blockers.push('sender');
    if (campaign.transport === 'sendgrid' && !campaign.connectorConnectionId) blockers.push('connection');
  }

  const audience = audiences.find((a) => a.id === campaign.audienceId);
  if (!audience || audience.memberCount === 0) blockers.push('audience');
  return blockers;
}
