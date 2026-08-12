import { apiRequest } from './apiClient';

/**
 * Connected social accounts — X, LinkedIn, Facebook Pages, Instagram, TikTok.
 *
 * Server counterpart: `api/src/presentation/routes/socialRoutes.ts`.
 *
 * CONNECTING an account is deliberately NOT here. A social account is a connector
 * connection, so it is created and edited through `connectorsApi` like every other
 * one — a second connect flow would mean a second credential store. This client is
 * the READ and PUBLISH surface that sits on top of those connections.
 *
 * Rides the ONE transport (`apiRequest`) for the reasons documented in `apiClient.ts`.
 */

export type SocialNetwork = 'x' | 'linkedin' | 'facebook' | 'instagram' | 'tiktok';

/** The canonical order the UI lists networks in. */
export const SOCIAL_NETWORKS: readonly SocialNetwork[] = ['x', 'linkedin', 'facebook', 'instagram', 'tiktok'];

export interface SocialAccountField {
  key: string;
  label: string;
  help: string;
}

export interface SocialAccount {
  /** The connector connection id — the handle every other call takes. */
  id: string;
  network: SocialNetwork;
  networkLabel: string;
  name: string;
  enabled: boolean;
  /** False when a required account-scope field (Page id, author URN…) is missing. */
  ready: boolean;
  missingFields: SocialAccountField[];
  requiresMedia: boolean;
  lastTestOk: boolean | null;
  lastUsedAt: string | null;
}

export interface SocialNetworkOption {
  network: SocialNetwork;
  label: string;
  /** The built-in connector this network runs on — what /connectors is filtered by. */
  connectorKey: string;
  accountFields: SocialAccountField[];
  requiresMedia: boolean;
  connectedCount: number;
}

export interface SocialMetrics {
  likes: number;
  comments: number;
  shares: number;
  views: number;
}

export interface SocialFeedItem {
  id: string;
  network: SocialNetwork;
  connectionId: string;
  accountName: string;
  authorName: string;
  text: string;
  permalink: string | null;
  publishedAtISO: string | null;
  mediaUrls: string[];
  thumbnailUrl: string | null;
  metrics: SocialMetrics;
}

export interface SocialFeedRead {
  items: SocialFeedItem[];
  accounts: SocialAccount[];
  errors: Array<{ connectionId: string; network: SocialNetwork; message: string }>;
  fetchedAtISO: string;
}

export type SocialCampaignStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed';
export type SocialPostStatus = 'queued' | 'published' | 'pending' | 'failed' | 'skipped';

export interface SocialCampaignPost {
  id: number;
  connectionId: string;
  network: SocialNetwork;
  accountName: string;
  body: string;
  status: SocialPostStatus;
  externalId: string | null;
  permalink: string | null;
  error: string | null;
  attempts: number;
  publishedAtISO: string | null;
}

/**
 * A reason a campaign cannot fully publish, as a CODE the client renders.
 *
 * The server never composes the sentence: this tile is rendered in five languages, and
 * a server-authored English string would be untranslatable by the time it arrived.
 */
export interface SocialCampaignBlocker {
  code: 'noCopy' | 'noAccounts' | 'needsMedia' | 'accountNotReady' | 'accountMissing';
  network?: string;
  account?: string;
  fields?: string;
}

export interface SocialCampaign {
  id: number;
  name: string;
  body: string;
  linkUrl: string;
  mediaUrls: string[];
  variants: Partial<Record<SocialNetwork, string>>;
  status: SocialCampaignStatus;
  scheduledAtISO: string | null;
  startedAtISO: string | null;
  completedAtISO: string | null;
  targets: number;
  published: number;
  failed: number;
  projectId: number | null;
  sessionId: string | null;
  updatedAtISO: string;
  posts: SocialCampaignPost[];
  blockers: SocialCampaignBlocker[];
}

export interface SocialFeedFilter {
  networks?: SocialNetwork[];
  accounts?: string[];
  q?: string;
  limit?: number;
}

export interface SocialCampaignInput {
  name: string;
  body: string;
  linkUrl?: string;
  mediaUrls?: string[];
  variants?: Partial<Record<SocialNetwork, string>>;
  connectionIds?: string[];
  scheduledAt?: string | null;
  projectId?: number;
  sessionId?: string;
}

export interface SocialPublishBatch {
  campaignId: number;
  published: number;
  failed: number;
  skipped: number;
  remaining: number;
  status: SocialCampaignStatus;
  results: Array<{ network: SocialNetwork; accountName: string; ok: boolean; permalink: string | null; error: string | null }>;
  campaign: SocialCampaign | null;
}

const SOCIAL = '/api/social';
const json = { 'Content-Type': 'application/json' };

/** ONE query builder, so the panel, the canvas tile and a refresh cannot disagree
 *  about what a filter means. */
export function socialFeedQuery(filter: SocialFeedFilter = {}): string {
  const params = new URLSearchParams();
  if (filter.networks?.length) params.set('networks', filter.networks.join(','));
  if (filter.accounts?.length) params.set('accounts', filter.accounts.join(','));
  if (filter.q?.trim()) params.set('q', filter.q.trim());
  if (filter.limit) params.set('limit', String(filter.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** A one-line description of a feed filter. Shown on the tile, because a tile that
 *  says "12 posts" with no visible filter tells the reader something false. */
export function describeSocialFilter(
  filter: SocialFeedFilter,
  labels: { all: string; networks: (list: string) => string; search: (term: string) => string },
): string {
  const parts: string[] = [];
  if (filter.networks?.length) parts.push(labels.networks(filter.networks.join(', ')));
  if (filter.q?.trim()) parts.push(labels.search(filter.q.trim()));
  return parts.length ? parts.join(' · ') : labels.all;
}

export const socialApi = {
  networks: (): Promise<{ networks: SocialNetworkOption[] }> => apiRequest(`${SOCIAL}/networks`),

  accounts: (): Promise<{ accounts: SocialAccount[] }> => apiRequest(`${SOCIAL}/accounts`),

  feed: (filter: SocialFeedFilter = {}): Promise<SocialFeedRead> =>
    apiRequest(`${SOCIAL}/feed${socialFeedQuery(filter)}`),

  publish: (post: { text: string; connectionId?: string; network?: SocialNetwork; linkUrl?: string; mediaUrls?: string[] }): Promise<{
    published: true; account: SocialAccount; externalId: string; permalink: string | null; pending: boolean;
  }> => apiRequest(`${SOCIAL}/publish`, { method: 'POST', headers: json, body: JSON.stringify(post) }),

  listCampaigns: (projectId?: number): Promise<{ campaigns: SocialCampaign[]; accounts: SocialAccount[] }> =>
    apiRequest(`${SOCIAL}/campaigns${projectId == null ? '' : `?projectId=${projectId}`}`),

  getCampaign: (id: number): Promise<{ campaign: SocialCampaign; accounts: SocialAccount[] }> =>
    apiRequest(`${SOCIAL}/campaigns/${id}`),

  createCampaign: (input: SocialCampaignInput): Promise<{ campaign: SocialCampaign; accounts: SocialAccount[] }> =>
    apiRequest(`${SOCIAL}/campaigns`, { method: 'POST', headers: json, body: JSON.stringify(input) }),

  updateCampaign: (id: number, patch: Partial<SocialCampaignInput>): Promise<{ campaign: SocialCampaign }> =>
    apiRequest(`${SOCIAL}/campaigns/${id}`, { method: 'PATCH', headers: json, body: JSON.stringify(patch) }),

  deleteCampaign: (id: number): Promise<{ deleted: true }> =>
    apiRequest(`${SOCIAL}/campaigns/${id}`, { method: 'DELETE' }),

  publishCampaign: (id: number): Promise<SocialPublishBatch> =>
    apiRequest(`${SOCIAL}/campaigns/${id}/publish`, { method: 'POST' }),
};

/**
 * Which social account a caller meant — the client mirror of the server's
 * `resolveSocialAccount`.
 *
 * Deliberately the SAME rule on both sides: a named connection wins, a single ready
 * account on the named network is assumed, and anything ambiguous is reported rather
 * than guessed at. Two different rules would mean the canvas tile and the agent tool
 * silently published to different Pages for the same request.
 */
export function resolveSocialAccount(
  accounts: SocialAccount[],
  ref: { connectionId?: string | null; network?: SocialNetwork | null } = {},
): { ok: true; account: SocialAccount } | { ok: false; error: string } {
  const usable = accounts.filter((a) => a.enabled && a.ready);
  if (ref.connectionId) {
    const match = accounts.find((a) => a.id === ref.connectionId);
    if (!match) return { ok: false, error: 'That social account is not connected to this workspace.' };
    if (!match.ready) {
      return { ok: false, error: `${match.networkLabel} · ${match.name} is missing ${match.missingFields.map((f) => f.label).join(', ') || 'setup'}.` };
    }
    return { ok: true, account: match };
  }
  const scoped = ref.network ? usable.filter((a) => a.network === ref.network) : usable;
  if (scoped.length === 1) return { ok: true, account: scoped[0]! };
  if (scoped.length === 0) {
    return { ok: false, error: ref.network ? `No ${ref.network} account is connected.` : 'No social account is connected.' };
  }
  return {
    ok: false,
    error: `Several accounts are connected (${scoped.map((a) => `${a.networkLabel} · ${a.name}`).join(', ')}). Name which one to use.`,
  };
}

/** Total engagement across a set of posts — the number a feed tile leads with. */
export function totalEngagement(items: readonly SocialFeedItem[]): SocialMetrics {
  return items.reduce<SocialMetrics>((sum, item) => ({
    likes: sum.likes + item.metrics.likes,
    comments: sum.comments + item.metrics.comments,
    shares: sum.shares + item.metrics.shares,
    views: sum.views + item.metrics.views,
  }), { likes: 0, comments: 0, shares: 0, views: 0 });
}

/** The single best-performing post, by total interactions. Drives the insight line
 *  on a feed tile — see the insights-everywhere standard. */
export function topPerformingPost(items: readonly SocialFeedItem[]): SocialFeedItem | null {
  if (items.length === 0) return null;
  const score = (item: SocialFeedItem) => item.metrics.likes + item.metrics.comments + item.metrics.shares;
  return items.reduce((best, item) => (score(item) > score(best) ? item : best), items[0]!);
}
