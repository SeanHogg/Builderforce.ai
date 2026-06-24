/**
 * Board provider adapters.
 *
 * Each provider knows how to (a) pull tickets changed since a cursor and
 * (b) push a change-set back to one ticket. All network access goes through an
 * INJECTED fetch so tests never hit the network.
 *
 * Tickets are normalized to a provider-agnostic shape and stamped with a
 * `source` label (the provider id) so downstream BF tasks record their origin
 * board (tasks.source).
 */

import { hashFields } from './reconciler';

/** Injectable fetch (matches the global fetch signature we rely on). */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** A normalized ticket pulled from any board provider. */
export interface NormalizedTicket {
  externalId:      string;
  externalUrl:     string | null;
  externalVersion: string | null;
  title:           string;
  body:            string | null;
  state:           string;
  /** Origin board provider label, stamped onto tasks.source. */
  source:          string;
  /** Stable content hash of the normalized fields (for idempotency). */
  contentHash:     string;
  /** The normalized field bag persisted on the link. */
  fields:          Record<string, unknown>;
}

export interface FetchPage {
  tickets:    NormalizedTicket[];
  nextCursor: string | null;
}

/** A change-set to push back to a provider (normalized field names). */
export interface ChangeSet {
  title?:  string;
  body?:   string;
  state?:  string;
  [k: string]: unknown;
}

export interface BoardProvider {
  readonly id: string;
  /** Pull tickets changed at/after `cursor` (null = full/initial pull). */
  fetchTicketsSince(cursor: string | null): Promise<FetchPage>;
  /** Push a change-set to one external ticket. Resolves on success, throws on failure. */
  pushUpdate(externalId: string, changeSet: ChangeSet): Promise<void>;
}

export interface ProviderConfig {
  /** Credential bag (decrypted) — token / apiToken / email etc. */
  credentials: Record<string, unknown>;
  /** Provider base URL (Jira/Confluence/self-hosted). */
  baseUrl?: string | null;
  /** External board identifier: GitHub "owner/repo" or Jira project key/JQL scope. */
  externalBoardId?: string | null;
}

/** Build the normalized ticket field bag + content hash from raw normalized parts. */
function buildTicket(
  source: string,
  parts: {
    externalId: string;
    externalUrl: string | null;
    externalVersion: string | null;
    title: string;
    body: string | null;
    state: string;
    extra?: Record<string, unknown>;
  },
): NormalizedTicket {
  const fields: Record<string, unknown> = {
    title: parts.title,
    body:  parts.body ?? '',
    state: parts.state,
    ...(parts.extra ?? {}),
  };
  return {
    externalId:      parts.externalId,
    externalUrl:     parts.externalUrl,
    externalVersion: parts.externalVersion,
    title:           parts.title,
    body:            parts.body,
    state:           parts.state,
    source,
    contentHash:     hashFields(fields),
    fields,
  };
}

// ---------------------------------------------------------------------------
// GitHub Issues (REST)
// ---------------------------------------------------------------------------

interface GitHubIssueRaw {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  updated_at: string;
  pull_request?: unknown; // present on PRs; we skip those
}

export class GitHubBoardProvider implements BoardProvider {
  readonly id = 'github';
  constructor(private readonly cfg: ProviderConfig, private readonly fetchFn: FetchLike) {}

  async fetchTicketsSince(cursor: string | null): Promise<FetchPage> {
    const repo = (this.cfg.externalBoardId ?? '').trim();
    if (!repo) throw new Error('github provider requires externalBoardId "owner/repo"');
    const token = String(this.cfg.credentials.accessToken ?? '');

    const params = new URLSearchParams({
      state: 'all',
      sort: 'updated',
      direction: 'asc',
      per_page: '100',
    });
    if (cursor) params.set('since', cursor);

    const url = `https://api.github.com/repos/${repo}/issues?${params.toString()}`;
    const res = await this.fetchFn(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'Builderforce/1.0',
        Accept: 'application/vnd.github+json',
      },
    });
    if (!res.ok) throw new Error(`GitHub issues fetch failed: ${res.status}`);

    const raw = (await res.json()) as GitHubIssueRaw[];
    const tickets: NormalizedTicket[] = [];
    let maxUpdated = cursor;

    for (const issue of raw) {
      if (issue.pull_request) continue; // issues only
      tickets.push(
        buildTicket(this.id, {
          externalId:      String(issue.number),
          externalUrl:     issue.html_url,
          externalVersion: issue.updated_at,
          title:           issue.title,
          body:            issue.body,
          state:           issue.state,
        }),
      );
      if (!maxUpdated || issue.updated_at > maxUpdated) maxUpdated = issue.updated_at;
    }

    return { tickets, nextCursor: maxUpdated };
  }

  async pushUpdate(externalId: string, changeSet: ChangeSet): Promise<void> {
    const repo = (this.cfg.externalBoardId ?? '').trim();
    const token = String(this.cfg.credentials.accessToken ?? '');
    const patch: Record<string, unknown> = {};
    if (changeSet.title !== undefined) patch.title = changeSet.title;
    if (changeSet.body !== undefined) patch.body = changeSet.body;
    if (changeSet.state !== undefined) patch.state = changeSet.state;

    const url = `https://api.github.com/repos/${repo}/issues/${externalId}`;
    const res = await this.fetchFn(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'Builderforce/1.0',
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`GitHub issue update failed: ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Jira (JQL search, updated >= cursor)
// ---------------------------------------------------------------------------

interface JiraIssueRaw {
  key: string;
  self?: string;
  fields: {
    summary: string;
    description?: string | null;
    updated: string;
    status?: { name?: string };
  };
}

interface JiraSearchRaw {
  issues: JiraIssueRaw[];
}

export class JiraBoardProvider implements BoardProvider {
  readonly id = 'jira';
  constructor(private readonly cfg: ProviderConfig, private readonly fetchFn: FetchLike) {}

  private authHeader(): string {
    const email = String(this.cfg.credentials.email ?? '');
    const apiToken = String(this.cfg.credentials.apiToken ?? '');
    return `Basic ${btoa(`${email}:${apiToken}`)}`;
  }

  async fetchTicketsSince(cursor: string | null): Promise<FetchPage> {
    const base = (this.cfg.baseUrl ?? '').replace(/\/$/, '');
    if (!base) throw new Error('jira provider requires baseUrl');
    const projectScope = (this.cfg.externalBoardId ?? '').trim();

    // JQL: updated >= cursor, optionally scoped to a project, ordered ascending.
    const clauses: string[] = [];
    if (projectScope) clauses.push(`project = "${projectScope}"`);
    if (cursor) clauses.push(`updated >= "${cursor}"`);
    const jql = `${clauses.join(' AND ')} ORDER BY updated ASC`.trim();

    const url = `${base}/rest/api/3/search`;
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader(),
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jql, maxResults: 100, fields: ['summary', 'description', 'updated', 'status'] }),
    });
    if (!res.ok) throw new Error(`Jira search failed: ${res.status}`);

    const raw = (await res.json()) as JiraSearchRaw;
    const tickets: NormalizedTicket[] = [];
    let maxUpdated = cursor;

    for (const issue of raw.issues ?? []) {
      const updated = issue.fields.updated;
      const body =
        typeof issue.fields.description === 'string' ? issue.fields.description : issue.fields.description ? JSON.stringify(issue.fields.description) : null;
      tickets.push(
        buildTicket(this.id, {
          externalId:      issue.key,
          externalUrl:     issue.self ? issue.self : `${base}/browse/${issue.key}`,
          externalVersion: updated,
          title:           issue.fields.summary,
          body,
          state:           issue.fields.status?.name ?? 'unknown',
        }),
      );
      if (!maxUpdated || updated > maxUpdated) maxUpdated = updated;
    }

    return { tickets, nextCursor: maxUpdated };
  }

  async pushUpdate(externalId: string, changeSet: ChangeSet): Promise<void> {
    const base = (this.cfg.baseUrl ?? '').replace(/\/$/, '');
    const fields: Record<string, unknown> = {};
    if (changeSet.title !== undefined) fields.summary = changeSet.title;
    if (changeSet.body !== undefined) fields.description = changeSet.body;

    const url = `${base}/rest/api/3/issue/${externalId}`;
    const res = await this.fetchFn(url, {
      method: 'PUT',
      headers: {
        Authorization: this.authHeader(),
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) throw new Error(`Jira issue update failed: ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Shared helpers (used by the providers below)
// ---------------------------------------------------------------------------

function basicAuth(user: string, pass: string): string {
  return `Basic ${btoa(`${user}:${pass}`)}`;
}

function trimSlash(u: string | null | undefined): string {
  return (u ?? '').replace(/\/$/, '');
}

/** Keep the lexicographically-largest version string seen so far (cursor advance). */
function maxVersion(current: string | null, candidate: string | null | undefined): string | null {
  if (!candidate) return current;
  if (!current || candidate > current) return candidate;
  return current;
}

/** POST a GraphQL query and throw on transport OR GraphQL-level errors. */
async function gqlFetch<T>(
  fetchFn: FetchLike,
  url: string,
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
  label: string,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`${label} GraphQL failed: ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: Array<{ message?: string }> };
  if (json.errors?.length) throw new Error(`${label} GraphQL error: ${json.errors.map((e) => e.message).join('; ')}`);
  if (!json.data) throw new Error(`${label} GraphQL returned no data`);
  return json.data;
}

/**
 * Max provider pages followed within ONE fetchTicketsSince call (200 items/page
 * cap → up to ~2k items per sync). Providers that can't order ascending-by-updated
 * (Linear/Sentry/monday/Asana) page through here so the initial pull drains the
 * backlog in one sync instead of capping at the newest 100. A sync that hits this
 * ceiling logs and resumes from the advanced cursor on the next run.
 */
const MAX_SYNC_PAGES = 20;

// ---------------------------------------------------------------------------
// Linear (GraphQL) — pm
// ---------------------------------------------------------------------------

interface LinearIssueNode {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  url: string;
  updatedAt: string;
  state?: { name?: string };
}

export class LinearBoardProvider implements BoardProvider {
  readonly id = 'linear';
  private static readonly ENDPOINT = 'https://api.linear.app/graphql';
  constructor(private readonly cfg: ProviderConfig, private readonly fetchFn: FetchLike) {}

  async fetchTicketsSince(cursor: string | null): Promise<FetchPage> {
    const apiKey = String(this.cfg.credentials.apiKey ?? '');
    if (!apiKey) throw new Error('linear provider requires an apiKey credential');
    const teamId = (this.cfg.externalBoardId ?? '').trim();

    const filter: Record<string, unknown> = {};
    if (cursor) filter.updatedAt = { gte: cursor };
    if (teamId) filter.team = { id: { eq: teamId } };

    const query = `query Issues($filter: IssueFilter, $after: String) {
      issues(first: 100, after: $after, filter: $filter, orderBy: updatedAt) {
        nodes { id identifier title description url updatedAt state { name } }
        pageInfo { hasNextPage endCursor }
      }
    }`;

    const tickets: NormalizedTicket[] = [];
    let next = cursor;
    let after: string | null = null;
    let pages = 0;
    do {
      const data: { issues: { nodes: LinearIssueNode[]; pageInfo?: { hasNextPage?: boolean; endCursor?: string } } } =
        await gqlFetch(this.fetchFn, LinearBoardProvider.ENDPOINT, apiKey, query, { filter, after }, 'Linear');
      for (const n of data.issues.nodes ?? []) {
        tickets.push(
          buildTicket(this.id, {
            externalId:      n.id,
            externalUrl:     n.url,
            externalVersion: n.updatedAt,
            title:           n.title,
            body:            n.description ?? null,
            state:           n.state?.name ?? 'unknown',
            extra:           { identifier: n.identifier },
          }),
        );
        next = maxVersion(next, n.updatedAt);
      }
      const pi = data.issues.pageInfo;
      after = pi?.hasNextPage ? pi.endCursor ?? null : null;
    } while (after && ++pages < MAX_SYNC_PAGES);
    if (after) console.warn(`[boardsync:linear] hit ${MAX_SYNC_PAGES}-page ceiling; resumes next sync`);
    return { tickets, nextCursor: next };
  }

  async pushUpdate(externalId: string, changeSet: ChangeSet): Promise<void> {
    const apiKey = String(this.cfg.credentials.apiKey ?? '');
    const input: Record<string, unknown> = {};
    if (changeSet.title !== undefined) input.title = changeSet.title;
    if (changeSet.body !== undefined) input.description = changeSet.body;
    if (Object.keys(input).length === 0) return;

    const query = `mutation Update($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { success }
    }`;
    await gqlFetch(this.fetchFn, LinearBoardProvider.ENDPOINT, apiKey, query, { id: externalId, input }, 'Linear');
  }
}

// ---------------------------------------------------------------------------
// Sentry (REST) — incident
// ---------------------------------------------------------------------------

interface SentryIssueRaw {
  id: string;
  shortId?: string;
  title: string;
  culprit?: string | null;
  permalink?: string;
  status?: string;
  lastSeen?: string;
}

/** Extract the rel="next" cursor from a Sentry pagination Link header (null when exhausted). */
function parseSentryNextCursor(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(',')) {
    if (/rel="next"/.test(part) && /results="true"/.test(part)) {
      const m = part.match(/cursor="([^"]+)"/);
      if (m?.[1]) return m[1];
    }
  }
  return null;
}

export class SentryBoardProvider implements BoardProvider {
  readonly id = 'sentry';
  constructor(private readonly cfg: ProviderConfig, private readonly fetchFn: FetchLike) {}

  private base(): string {
    return trimSlash(this.cfg.baseUrl) || 'https://sentry.io';
  }

  async fetchTicketsSince(cursor: string | null): Promise<FetchPage> {
    const token = String(this.cfg.credentials.token ?? '');
    if (!token) throw new Error('sentry provider requires a token credential');
    const scope = (this.cfg.externalBoardId ?? '').trim();
    const [org, project] = scope.split('/');
    if (!org || !project) throw new Error('sentry provider requires externalBoardId "org/project"');

    // Sentry sorts by last-seen date desc and paginates via the Link header.
    // We follow rel="next" while results remain, filter to the cursor in-code,
    // and (since the feed is date-desc) stop early once a page goes at/under the
    // cursor — everything beyond it is older.
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    const baseUrl = `${this.base()}/api/0/projects/${org}/${project}/issues/?sort=date&limit=100&query=`;

    const tickets: NormalizedTicket[] = [];
    let next = cursor;
    let pageCursor: string | null = null;
    let pages = 0;
    let reachedCursor = false;
    do {
      const url = pageCursor ? `${baseUrl}&cursor=${encodeURIComponent(pageCursor)}` : baseUrl;
      const res = await this.fetchFn(url, { headers });
      if (!res.ok) throw new Error(`Sentry issues fetch failed: ${res.status}`);
      const raw = (await res.json()) as SentryIssueRaw[];
      for (const i of raw) {
        const last = i.lastSeen ?? null;
        if (cursor && last && last <= cursor) { reachedCursor = true; continue; }
        tickets.push(
          buildTicket(this.id, {
            externalId:      i.id,
            externalUrl:     i.permalink ?? null,
            externalVersion: last,
            title:           i.title,
            body:            i.culprit ?? null,
            state:           i.status ?? 'unresolved',
            extra:           { shortId: i.shortId ?? null },
          }),
        );
        next = maxVersion(next, last);
      }
      pageCursor = reachedCursor ? null : parseSentryNextCursor(res.headers.get('Link'));
    } while (pageCursor && ++pages < MAX_SYNC_PAGES);
    if (pageCursor) console.warn(`[boardsync:sentry] hit ${MAX_SYNC_PAGES}-page ceiling; resumes next sync`);
    return { tickets, nextCursor: next };
  }

  async pushUpdate(externalId: string, changeSet: ChangeSet): Promise<void> {
    // Only the resolution status is writable on a Sentry issue.
    if (changeSet.state === undefined) return;
    const token = String(this.cfg.credentials.token ?? '');
    const status = ['resolved', 'unresolved', 'ignored'].includes(String(changeSet.state))
      ? String(changeSet.state)
      : 'resolved';
    const res = await this.fetchFn(`${this.base()}/api/0/issues/${externalId}/`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error(`Sentry issue update failed: ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// PagerDuty (REST) — incident
// ---------------------------------------------------------------------------

interface PagerDutyIncidentRaw {
  id: string;
  incident_number?: number;
  title: string;
  description?: string | null;
  status?: string;
  html_url?: string;
  created_at?: string;
}

export class PagerDutyBoardProvider implements BoardProvider {
  readonly id = 'pagerduty';
  private static readonly BASE = 'https://api.pagerduty.com';
  constructor(private readonly cfg: ProviderConfig, private readonly fetchFn: FetchLike) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Token token=${String(this.cfg.credentials.apiToken ?? '')}`,
      Accept: 'application/vnd.pagerduty+json;version=2',
      'Content-Type': 'application/json',
    };
  }

  async fetchTicketsSince(cursor: string | null): Promise<FetchPage> {
    if (!this.cfg.credentials.apiToken) throw new Error('pagerduty provider requires an apiToken credential');
    const params = new URLSearchParams({ sort_by: 'created_at:asc', limit: '100' });
    if (cursor) params.set('since', cursor);
    const service = (this.cfg.externalBoardId ?? '').trim();
    if (service) params.append('service_ids[]', service);

    const res = await this.fetchFn(`${PagerDutyBoardProvider.BASE}/incidents?${params.toString()}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`PagerDuty incidents fetch failed: ${res.status}`);

    const raw = (await res.json()) as { incidents?: PagerDutyIncidentRaw[] };
    const tickets: NormalizedTicket[] = [];
    let next = cursor;
    for (const i of raw.incidents ?? []) {
      tickets.push(
        buildTicket(this.id, {
          externalId:      i.id,
          externalUrl:     i.html_url ?? null,
          externalVersion: i.created_at ?? null,
          title:           i.title,
          body:            i.description ?? i.title,
          state:           i.status ?? 'triggered',
          extra:           { incidentNumber: i.incident_number ?? null },
        }),
      );
      next = maxVersion(next, i.created_at ?? null);
    }
    return { tickets, nextCursor: next };
  }

  async pushUpdate(externalId: string, changeSet: ChangeSet): Promise<void> {
    if (changeSet.state === undefined) return;
    const fromEmail = String(this.cfg.credentials.fromEmail ?? '');
    if (!fromEmail) throw new Error('pagerduty write-back requires a fromEmail credential');
    const status = String(changeSet.state) === 'acknowledged' ? 'acknowledged' : 'resolved';
    const res = await this.fetchFn(`${PagerDutyBoardProvider.BASE}/incidents/${externalId}`, {
      method: 'PUT',
      headers: { ...this.headers(), From: fromEmail },
      body: JSON.stringify({ incident: { type: 'incident_reference', status } }),
    });
    if (!res.ok) throw new Error(`PagerDuty incident update failed: ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Freshservice (REST) — itsm
// ---------------------------------------------------------------------------

const FRESHSERVICE_STATUS: Record<number, string> = { 2: 'open', 3: 'pending', 4: 'resolved', 5: 'closed' };

interface FreshserviceTicketRaw {
  id: number;
  subject: string;
  description_text?: string | null;
  description?: string | null;
  status?: number;
  updated_at: string;
}

export class FreshserviceBoardProvider implements BoardProvider {
  readonly id = 'freshservice';
  constructor(private readonly cfg: ProviderConfig, private readonly fetchFn: FetchLike) {}

  async fetchTicketsSince(cursor: string | null): Promise<FetchPage> {
    const base = trimSlash(this.cfg.baseUrl);
    if (!base) throw new Error('freshservice provider requires baseUrl');
    const apiKey = String(this.cfg.credentials.apiKey ?? '');

    const params = new URLSearchParams({ order_by: 'updated_at', order_type: 'asc', per_page: '100' });
    if (cursor) params.set('updated_since', cursor);

    const res = await this.fetchFn(`${base}/api/v2/tickets?${params.toString()}`, {
      headers: { Authorization: basicAuth(apiKey, 'X'), Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Freshservice tickets fetch failed: ${res.status}`);

    const raw = (await res.json()) as { tickets?: FreshserviceTicketRaw[] };
    const tickets: NormalizedTicket[] = [];
    let next = cursor;
    for (const t of raw.tickets ?? []) {
      tickets.push(
        buildTicket(this.id, {
          externalId:      String(t.id),
          externalUrl:     `${base}/a/tickets/${t.id}`,
          externalVersion: t.updated_at,
          title:           t.subject,
          body:            t.description_text ?? t.description ?? null,
          state:           FRESHSERVICE_STATUS[t.status ?? 2] ?? 'open',
        }),
      );
      next = maxVersion(next, t.updated_at);
    }
    return { tickets, nextCursor: next };
  }

  async pushUpdate(externalId: string, changeSet: ChangeSet): Promise<void> {
    const base = trimSlash(this.cfg.baseUrl);
    const apiKey = String(this.cfg.credentials.apiKey ?? '');
    const fields: Record<string, unknown> = {};
    if (changeSet.title !== undefined) fields.subject = changeSet.title;
    if (changeSet.body !== undefined) fields.description = changeSet.body;
    if (Object.keys(fields).length === 0) return;

    const res = await this.fetchFn(`${base}/api/v2/tickets/${externalId}`, {
      method: 'PUT',
      headers: { Authorization: basicAuth(apiKey, 'X'), Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    if (!res.ok) throw new Error(`Freshservice ticket update failed: ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// ServiceNow (REST Table API) — itsm
// ---------------------------------------------------------------------------

interface ServiceNowRecordRaw {
  sys_id: string;
  number?: string;
  short_description?: string;
  description?: string | null;
  state?: string;
  sys_updated_on?: string;
}

export class ServiceNowBoardProvider implements BoardProvider {
  readonly id = 'servicenow';
  constructor(private readonly cfg: ProviderConfig, private readonly fetchFn: FetchLike) {}

  private table(): string {
    return (this.cfg.externalBoardId ?? '').trim() || 'incident';
  }

  async fetchTicketsSince(cursor: string | null): Promise<FetchPage> {
    const base = trimSlash(this.cfg.baseUrl);
    if (!base) throw new Error('servicenow provider requires baseUrl');
    const auth = basicAuth(String(this.cfg.credentials.username ?? ''), String(this.cfg.credentials.password ?? ''));
    const table = this.table();

    const query = cursor
      ? `sys_updated_on>=${cursor}^ORDERBYsys_updated_on`
      : `ORDERBYsys_updated_on`;
    // Build the query string by hand: URLSearchParams encodes spaces as '+',
    // but ServiceNow's sysparm_query needs '%20' (encodeURIComponent does this).
    const qs = `sysparm_query=${encodeURIComponent(query)}&sysparm_limit=100&sysparm_display_value=true`;

    const res = await this.fetchFn(`${base}/api/now/table/${table}?${qs}`, {
      headers: { Authorization: auth, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`ServiceNow fetch failed: ${res.status}`);

    const raw = (await res.json()) as { result?: ServiceNowRecordRaw[] };
    const tickets: NormalizedTicket[] = [];
    let next = cursor;
    for (const r of raw.result ?? []) {
      tickets.push(
        buildTicket(this.id, {
          externalId:      r.sys_id,
          externalUrl:     `${base}/nav_to.do?uri=${table}.do?sys_id=${r.sys_id}`,
          externalVersion: r.sys_updated_on ?? null,
          title:           r.short_description ?? r.number ?? r.sys_id,
          body:            r.description ?? null,
          state:           r.state ?? 'new',
          extra:           { number: r.number ?? null },
        }),
      );
      next = maxVersion(next, r.sys_updated_on ?? null);
    }
    return { tickets, nextCursor: next };
  }

  async pushUpdate(externalId: string, changeSet: ChangeSet): Promise<void> {
    const base = trimSlash(this.cfg.baseUrl);
    const auth = basicAuth(String(this.cfg.credentials.username ?? ''), String(this.cfg.credentials.password ?? ''));
    const fields: Record<string, unknown> = {};
    if (changeSet.title !== undefined) fields.short_description = changeSet.title;
    if (changeSet.body !== undefined) fields.description = changeSet.body;
    if (Object.keys(fields).length === 0) return;

    const res = await this.fetchFn(`${base}/api/now/table/${this.table()}/${externalId}`, {
      method: 'PUT',
      headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    if (!res.ok) throw new Error(`ServiceNow update failed: ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// monday.com (GraphQL) — pm
// ---------------------------------------------------------------------------

interface MondayItemRaw {
  id: string;
  name: string;
  updated_at?: string;
  state?: string;
}

export class MondayBoardProvider implements BoardProvider {
  readonly id = 'monday';
  private static readonly ENDPOINT = 'https://api.monday.com/v2';
  constructor(private readonly cfg: ProviderConfig, private readonly fetchFn: FetchLike) {}

  async fetchTicketsSince(cursor: string | null): Promise<FetchPage> {
    const token = String(this.cfg.credentials.token ?? '');
    if (!token) throw new Error('monday provider requires a token credential');
    const boardId = (this.cfg.externalBoardId ?? '').trim();
    if (!boardId) throw new Error('monday provider requires externalBoardId (board id)');

    // monday has no server-side updated_at filter on items_page, so we page the
    // whole board (items_page → next_items_page by cursor) and filter in-code.
    const firstQuery = `query($boardId: [ID!]) {
      boards(ids: $boardId) { items_page(limit: 100) { cursor items { id name updated_at state } } }
    }`;
    const nextQuery = `query($cursor: String!) {
      next_items_page(limit: 100, cursor: $cursor) { cursor items { id name updated_at state } }
    }`;

    const tickets: NormalizedTicket[] = [];
    let next = cursor;
    let pageCursor: string | null = null;
    let pages = 0;
    const consume = (page?: { cursor?: string | null; items?: MondayItemRaw[] }): string | null => {
      for (const it of page?.items ?? []) {
        const updated = it.updated_at ?? null;
        if (cursor && updated && updated <= cursor) continue;
        tickets.push(
          buildTicket(this.id, {
            externalId:      it.id,
            externalUrl:     `https://monday.com/boards/${boardId}/pulses/${it.id}`,
            externalVersion: updated,
            title:           it.name,
            body:            null,
            state:           it.state ?? 'active',
          }),
        );
        next = maxVersion(next, updated);
      }
      return page?.cursor ?? null;
    };

    const first = await gqlFetch<{ boards: Array<{ items_page?: { cursor?: string | null; items?: MondayItemRaw[] } }> }>(
      this.fetchFn, MondayBoardProvider.ENDPOINT, token, firstQuery, { boardId: [boardId] }, 'monday', { 'API-Version': '2024-01' },
    );
    pageCursor = consume(first.boards?.[0]?.items_page);

    while (pageCursor && ++pages < MAX_SYNC_PAGES) {
      const more: { next_items_page?: { cursor?: string | null; items?: MondayItemRaw[] } } =
        await gqlFetch(this.fetchFn, MondayBoardProvider.ENDPOINT, token, nextQuery, { cursor: pageCursor }, 'monday', { 'API-Version': '2024-01' });
      pageCursor = consume(more.next_items_page);
    }
    if (pageCursor) console.warn(`[boardsync:monday] hit ${MAX_SYNC_PAGES}-page ceiling; resumes next sync`);
    return { tickets, nextCursor: next };
  }

  async pushUpdate(externalId: string, changeSet: ChangeSet): Promise<void> {
    // Only the item name (title) is round-trippable via column values.
    if (changeSet.title === undefined) return;
    const token = String(this.cfg.credentials.token ?? '');
    const boardId = (this.cfg.externalBoardId ?? '').trim();
    const query = `mutation($boardId: ID!, $itemId: ID!, $cols: JSON!) {
      change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $cols) { id }
    }`;
    await gqlFetch(
      this.fetchFn,
      MondayBoardProvider.ENDPOINT,
      token,
      query,
      { boardId, itemId: externalId, cols: JSON.stringify({ name: changeSet.title }) },
      'monday',
      { 'API-Version': '2024-01' },
    );
  }
}

// ---------------------------------------------------------------------------
// Asana (REST) — pm
// ---------------------------------------------------------------------------

interface AsanaTaskRaw {
  gid: string;
  name: string;
  notes?: string | null;
  completed?: boolean;
  modified_at?: string;
  permalink_url?: string;
}

export class AsanaBoardProvider implements BoardProvider {
  readonly id = 'asana';
  private static readonly BASE = 'https://app.asana.com/api/1.0';
  constructor(private readonly cfg: ProviderConfig, private readonly fetchFn: FetchLike) {}

  async fetchTicketsSince(cursor: string | null): Promise<FetchPage> {
    const token = String(this.cfg.credentials.accessToken ?? '');
    if (!token) throw new Error('asana provider requires an accessToken credential');
    const project = (this.cfg.externalBoardId ?? '').trim();
    if (!project) throw new Error('asana provider requires externalBoardId (project gid)');

    // Asana paginates via next_page.offset (opaque continuation token). Follow it
    // so the initial pull drains rather than capping at the first 100.
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    const tickets: NormalizedTicket[] = [];
    let next = cursor;
    let offset: string | null = null;
    let pages = 0;
    do {
      const params = new URLSearchParams({
        project,
        opt_fields: 'name,notes,completed,modified_at,permalink_url',
        limit: '100',
      });
      if (cursor) params.set('modified_since', cursor);
      if (offset) params.set('offset', offset);

      const res = await this.fetchFn(`${AsanaBoardProvider.BASE}/tasks?${params.toString()}`, { headers });
      if (!res.ok) throw new Error(`Asana tasks fetch failed: ${res.status}`);

      const raw = (await res.json()) as { data?: AsanaTaskRaw[]; next_page?: { offset?: string } | null };
      for (const t of raw.data ?? []) {
        tickets.push(
          buildTicket(this.id, {
            externalId:      t.gid,
            externalUrl:     t.permalink_url ?? null,
            externalVersion: t.modified_at ?? null,
            title:           t.name,
            body:            t.notes ?? null,
            state:           t.completed ? 'completed' : 'open',
          }),
        );
        next = maxVersion(next, t.modified_at ?? null);
      }
      offset = raw.next_page?.offset ?? null;
    } while (offset && ++pages < MAX_SYNC_PAGES);
    if (offset) console.warn(`[boardsync:asana] hit ${MAX_SYNC_PAGES}-page ceiling; resumes next sync`);
    return { tickets, nextCursor: next };
  }

  async pushUpdate(externalId: string, changeSet: ChangeSet): Promise<void> {
    const token = String(this.cfg.credentials.accessToken ?? '');
    const data: Record<string, unknown> = {};
    if (changeSet.title !== undefined) data.name = changeSet.title;
    if (changeSet.body !== undefined) data.notes = changeSet.body;
    if (Object.keys(data).length === 0) return;

    const res = await this.fetchFn(`${AsanaBoardProvider.BASE}/tasks/${externalId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    });
    if (!res.ok) throw new Error(`Asana task update failed: ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// ClickUp (REST) — pm
// ---------------------------------------------------------------------------

interface ClickUpTaskRaw {
  id: string;
  name: string;
  description?: string | null;
  text_content?: string | null;
  status?: { status?: string };
  date_updated?: string;
  url?: string;
}

export class ClickUpBoardProvider implements BoardProvider {
  readonly id = 'clickup';
  private static readonly BASE = 'https://api.clickup.com/api/v2';
  constructor(private readonly cfg: ProviderConfig, private readonly fetchFn: FetchLike) {}

  async fetchTicketsSince(cursor: string | null): Promise<FetchPage> {
    const token = String(this.cfg.credentials.token ?? '');
    if (!token) throw new Error('clickup provider requires a token credential');
    const listId = (this.cfg.externalBoardId ?? '').trim();
    if (!listId) throw new Error('clickup provider requires externalBoardId (list id)');

    // date_updated_gt expects epoch ms; order ascending (reverse=true) so the
    // cursor drains the backlog forward over repeated syncs.
    const params = new URLSearchParams({ order_by: 'updated', reverse: 'true', subtasks: 'true' });
    if (cursor) params.set('date_updated_gt', cursor);

    const res = await this.fetchFn(`${ClickUpBoardProvider.BASE}/list/${listId}/task?${params.toString()}`, {
      headers: { Authorization: token, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`ClickUp tasks fetch failed: ${res.status}`);

    const raw = (await res.json()) as { tasks?: ClickUpTaskRaw[] };
    const tickets: NormalizedTicket[] = [];
    let next = cursor;
    for (const t of raw.tasks ?? []) {
      const updated = t.date_updated ?? null;
      tickets.push(
        buildTicket(this.id, {
          externalId:      t.id,
          externalUrl:     t.url ?? null,
          externalVersion: updated,
          title:           t.name,
          body:            t.description ?? t.text_content ?? null,
          state:           t.status?.status ?? 'open',
        }),
      );
      next = maxVersion(next, updated);
    }
    return { tickets, nextCursor: next };
  }

  async pushUpdate(externalId: string, changeSet: ChangeSet): Promise<void> {
    const token = String(this.cfg.credentials.token ?? '');
    const patch: Record<string, unknown> = {};
    if (changeSet.title !== undefined) patch.name = changeSet.title;
    if (changeSet.body !== undefined) patch.description = changeSet.body;
    if (Object.keys(patch).length === 0) return;

    const res = await this.fetchFn(`${ClickUpBoardProvider.BASE}/task/${externalId}`, {
      method: 'PUT',
      headers: { Authorization: token, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`ClickUp task update failed: ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

type BoardProviderCtor = new (cfg: ProviderConfig, fetchFn: FetchLike) => BoardProvider;

/** id → adapter constructor. Must cover every id in providerCatalog.BOARD_PROVIDERS. */
const PROVIDER_REGISTRY: Record<string, BoardProviderCtor> = {
  github:       GitHubBoardProvider,
  jira:         JiraBoardProvider,
  linear:       LinearBoardProvider,
  sentry:       SentryBoardProvider,
  pagerduty:    PagerDutyBoardProvider,
  freshservice: FreshserviceBoardProvider,
  servicenow:   ServiceNowBoardProvider,
  monday:       MondayBoardProvider,
  asana:        AsanaBoardProvider,
  clickup:      ClickUpBoardProvider,
};

/** Factory: build a provider adapter by id. Throws for unknown providers. */
export function createBoardProvider(
  provider: string,
  cfg: ProviderConfig,
  fetchFn: FetchLike,
): BoardProvider {
  const Ctor = PROVIDER_REGISTRY[provider];
  if (!Ctor) throw new Error(`Unsupported board provider: ${provider}`);
  return new Ctor(cfg, fetchFn);
}
