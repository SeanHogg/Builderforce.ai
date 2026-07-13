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
  /** Story-point estimate from the tracker, when the provider exposes one (EMP-4).
   *  Persisted to tasks.story_points on sync; undefined = provider has no estimate
   *  (leaves any manual estimate untouched). */
  storyPoints?:    number | null;
  /** External item type (Jira issuetype, GitLab issue_type, Bitbucket kind, Rally
   *  artifact). Drives board_type_mappings → task_type/status on sync. */
  externalType?:   string | null;
  /** External assignee id (matches a DiscoveredUser.externalId). Lets a migration
   *  set assignedUserId when that user maps to an existing member. */
  assigneeExternalId?: string | null;
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

/** A project/board discovered on the external system (migration wizard step 1). */
export interface DiscoveredProject {
  externalId:  string;
  /** Human-readable key (Jira project key, GitLab path, repo slug) when distinct from id. */
  key?:        string | null;
  name:        string;
  description?: string | null;
  url?:        string | null;
  /** Best-effort item count; null when the provider can't cheaply report one. */
  itemCount?:  number | null;
}

/** An item/issue type discovered on the external system (drives type mapping). */
export interface DiscoveredItemType {
  externalType: string;
  name:         string;
  /** Provider hint: 'epic' | 'story' | 'bug' | 'subtask' | 'task' | … (best-effort). */
  category?:    string | null;
}

/** A user/member discovered on the external system (drives user mapping). */
export interface DiscoveredUser {
  externalId:   string;
  displayName:  string;
  email?:       string | null;
}

export interface DiscoveryResult {
  projects:  DiscoveredProject[];
  itemTypes: DiscoveredItemType[];
  users:     DiscoveredUser[];
}

export interface BoardProvider {
  readonly id: string;
  /** Pull tickets changed at/after `cursor` (null = full/initial pull). */
  fetchTicketsSince(cursor: string | null): Promise<FetchPage>;
  /** Push a change-set to one external ticket. Resolves on success, throws on failure. */
  pushUpdate(externalId: string, changeSet: ChangeSet): Promise<void>;
  /**
   * Enumerate the external projects/boards, item types, and users for the
   * migration wizard. Optional — a provider that can't discover (or hasn't been
   * wired yet) simply omits it; MigrationService treats absence as "not
   * discoverable" rather than an error.
   */
  discover?(): Promise<DiscoveryResult>;
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
    storyPoints?: number | null;
    externalType?: string | null;
    assigneeExternalId?: string | null;
    extra?: Record<string, unknown>;
  },
): NormalizedTicket {
  const fields: Record<string, unknown> = {
    title: parts.title,
    body:  parts.body ?? '',
    state: parts.state,
    ...(parts.storyPoints != null ? { storyPoints: parts.storyPoints } : {}),
    ...(parts.externalType ? { externalType: parts.externalType } : {}),
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
    storyPoints:     parts.storyPoints ?? null,
    externalType:    parts.externalType ?? null,
    assigneeExternalId: parts.assigneeExternalId ?? null,
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
  assignee?: { login?: string } | null;
  labels?: Array<{ name?: string } | string>;
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
          assigneeExternalId: issue.assignee?.login ?? null,
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

  async discover(): Promise<DiscoveryResult> {
    const token = String(this.cfg.credentials.accessToken ?? '');
    const headers = { Authorization: `Bearer ${token}`, 'User-Agent': 'Builderforce/1.0', Accept: 'application/vnd.github+json' };
    const scope = (this.cfg.externalBoardId ?? '').trim();

    // Repos: an explicit owner/repo scopes to that one; otherwise list the token's
    // repos (so the operator can pick which to migrate). Each repo's externalId is
    // "owner/repo" so a staged project maps straight onto a connection scope.
    const projects: DiscoveredProject[] = [];
    if (scope) {
      const res = await this.fetchFn(`https://api.github.com/repos/${scope}`, { headers });
      if (res.ok) {
        const r = (await res.json()) as { full_name: string; description?: string; html_url?: string; open_issues_count?: number };
        projects.push({ externalId: r.full_name, key: r.full_name, name: r.full_name, description: r.description ?? null, url: r.html_url ?? null, itemCount: r.open_issues_count ?? null });
      }
    } else {
      const res = await this.fetchFn('https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member', { headers });
      if (!res.ok) throw new Error(`GitHub repos fetch failed: ${res.status}`);
      const repos = (await res.json()) as Array<{ full_name: string; description?: string; html_url?: string; open_issues_count?: number; has_issues?: boolean }>;
      for (const r of repos) {
        if (r.has_issues === false) continue;
        projects.push({ externalId: r.full_name, key: r.full_name, name: r.full_name, description: r.description ?? null, url: r.html_url ?? null, itemCount: r.open_issues_count ?? null });
      }
    }

    // GitHub has no first-class issue "types"; expose the common label vocabulary
    // so the operator can map bug/feature labels to task/epic.
    const itemTypes: DiscoveredItemType[] = [
      { externalType: 'issue', name: 'Issue', category: 'task' },
      { externalType: 'bug', name: 'Bug', category: 'bug' },
      { externalType: 'feature', name: 'Feature', category: 'story' },
      { externalType: 'epic', name: 'Epic', category: 'epic' },
    ];

    // Users: dedupe assignees/collaborators across the first 20 discovered repos.
    const users = new Map<string, DiscoveredUser>();
    for (const p of projects.slice(0, 20)) {
      const res = await this.fetchFn(`https://api.github.com/repos/${p.externalId}/assignees?per_page=100`, { headers });
      if (!res.ok) continue;
      const list = (await res.json()) as Array<{ login: string; id: number }>;
      for (const u of list) if (!users.has(u.login)) users.set(u.login, { externalId: u.login, displayName: u.login, email: null });
    }

    return { projects, itemTypes, users: [...users.values()] };
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
    issuetype?: { name?: string; subtask?: boolean };
    assignee?: { accountId?: string } | null;
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

    // Story-point field id is instance-specific; default to the Jira Cloud default
    // (customfield_10016) and let a tenant override via credentials.storyPointsField.
    const spField = String(this.cfg.credentials.storyPointsField ?? 'customfield_10016');

    const url = `${base}/rest/api/3/search`;
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader(),
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jql, maxResults: 100, fields: ['summary', 'description', 'updated', 'status', 'issuetype', 'assignee', spField] }),
    });
    if (!res.ok) throw new Error(`Jira search failed: ${res.status}`);

    const raw = (await res.json()) as JiraSearchRaw;
    const tickets: NormalizedTicket[] = [];
    let maxUpdated = cursor;

    for (const issue of raw.issues ?? []) {
      const updated = issue.fields.updated;
      const body =
        typeof issue.fields.description === 'string' ? issue.fields.description : issue.fields.description ? JSON.stringify(issue.fields.description) : null;
      const spRaw = (issue.fields as Record<string, unknown>)[spField];
      const storyPoints = typeof spRaw === 'number' && Number.isFinite(spRaw) ? spRaw : null;
      tickets.push(
        buildTicket(this.id, {
          externalId:      issue.key,
          externalUrl:     issue.self ? issue.self : `${base}/browse/${issue.key}`,
          externalVersion: updated,
          title:           issue.fields.summary,
          body,
          state:           issue.fields.status?.name ?? 'unknown',
          storyPoints,
          externalType:    issue.fields.issuetype?.name ?? null,
          assigneeExternalId: issue.fields.assignee?.accountId ?? null,
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

  async discover(): Promise<DiscoveryResult> {
    const base = (this.cfg.baseUrl ?? '').replace(/\/$/, '');
    if (!base) throw new Error('jira provider requires baseUrl');
    const headers = { Authorization: this.authHeader(), Accept: 'application/json' };

    // Projects — page through /project/search (50/page).
    const projects: DiscoveredProject[] = [];
    let startAt = 0;
    for (let page = 0; page < MAX_SYNC_PAGES; page += 1) {
      const res = await this.fetchFn(`${base}/rest/api/3/project/search?startAt=${startAt}&maxResults=50`, { headers });
      if (!res.ok) throw new Error(`Jira project search failed: ${res.status}`);
      const data = (await res.json()) as { values?: Array<{ id: string; key: string; name: string; description?: string; self?: string }>; isLast?: boolean; total?: number };
      for (const p of data.values ?? []) {
        projects.push({ externalId: p.key, key: p.key, name: p.name, description: p.description ?? null, url: p.self ? `${base}/browse/${p.key}` : null, itemCount: await this.projectIssueCount(base, headers, p.key) });
      }
      if (data.isLast || !(data.values?.length)) break;
      startAt += data.values.length;
    }

    // Issue types.
    const typesRes = await this.fetchFn(`${base}/rest/api/3/issuetype`, { headers });
    const rawTypes = typesRes.ok ? ((await typesRes.json()) as Array<{ name: string; subtask?: boolean; hierarchyLevel?: number }>) : [];
    const seenType = new Set<string>();
    const itemTypes: DiscoveredItemType[] = [];
    for (const t of rawTypes) {
      if (seenType.has(t.name)) continue;
      seenType.add(t.name);
      itemTypes.push({ externalType: t.name, name: t.name, category: t.subtask ? 'subtask' : (t.hierarchyLevel ?? 0) > 0 ? 'epic' : null });
    }

    // Users — assignable across projects (best-effort; needs Browse Users).
    const users: DiscoveredUser[] = [];
    const uRes = await this.fetchFn(`${base}/rest/api/3/users/search?maxResults=200`, { headers });
    if (uRes.ok) {
      const rawUsers = (await uRes.json()) as Array<{ accountId: string; displayName?: string; emailAddress?: string; accountType?: string }>;
      for (const u of rawUsers) {
        if (u.accountType && u.accountType !== 'atlassian') continue; // skip app/bot accounts
        users.push({ externalId: u.accountId, displayName: u.displayName ?? u.accountId, email: u.emailAddress ?? null });
      }
    }

    return { projects, itemTypes, users };
  }

  /** Total issue count for a project via a 0-result JQL search (count only). */
  private async projectIssueCount(base: string, headers: Record<string, string>, key: string): Promise<number | null> {
    try {
      const res = await this.fetchFn(`${base}/rest/api/3/search`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jql: `project = "${key}"`, maxResults: 0 }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { total?: number };
      return typeof data.total === 'number' ? data.total : null;
    } catch {
      return null;
    }
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
const FRESHSERVICE_PRIORITY: Record<number, string> = { 1: 'low', 2: 'normal', 3: 'high', 4: 'urgent' };

interface FreshserviceTicketRaw {
  id: number;
  subject: string;
  description_text?: string | null;
  description?: string | null;
  status?: number;
  priority?: number;
  /** Ticket type ('Incident' | 'Service Request' | 'Problem' | …). */
  type?: string | null;
  /** Requester (distinct-customer key for support-tix-per-customer). */
  requester_id?: number | null;
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
          extra:           {
            priority: FRESHSERVICE_PRIORITY[t.priority ?? 2] ?? 'normal',
            ticketType: t.type ?? null,
            requester: t.requester_id != null ? String(t.requester_id) : null,
          },
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
// Freshdesk (REST) — itsm (help desk / support)
// ---------------------------------------------------------------------------
// Freshworks' help-desk product (distinct from Freshservice ITSM). Same /api/v2/
// tickets REST shape + basic-auth-with-apiKey, so this mirrors FreshserviceBoardProvider;
// the differences are the base URL (…/freshdesk.com) and Freshdesk's default status set.

const FRESHDESK_STATUS: Record<number, string> = { 2: 'open', 3: 'pending', 4: 'resolved', 5: 'closed' };
const FRESHDESK_PRIORITY: Record<number, string> = { 1: 'low', 2: 'normal', 3: 'high', 4: 'urgent' };

interface FreshdeskTicketRaw {
  id: number;
  subject: string;
  description_text?: string | null;
  description?: string | null;
  status?: number;
  priority?: number;
  /** Freshdesk ticket type ('Incident' | 'Problem' | 'Question' | 'Feature Request' | …). */
  type?: string | null;
  requester_id?: number | null;
  updated_at: string;
}

export class FreshdeskBoardProvider implements BoardProvider {
  readonly id = 'freshdesk';
  constructor(private readonly cfg: ProviderConfig, private readonly fetchFn: FetchLike) {}

  async fetchTicketsSince(cursor: string | null): Promise<FetchPage> {
    const base = trimSlash(this.cfg.baseUrl);
    if (!base) throw new Error('freshdesk provider requires baseUrl');
    const apiKey = String(this.cfg.credentials.apiKey ?? '');

    const params = new URLSearchParams({ order_by: 'updated_at', order_type: 'asc', per_page: '100' });
    if (cursor) params.set('updated_since', cursor);

    const res = await this.fetchFn(`${base}/api/v2/tickets?${params.toString()}`, {
      headers: { Authorization: basicAuth(apiKey, 'X'), Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Freshdesk tickets fetch failed: ${res.status}`);

    const raw = (await res.json()) as FreshdeskTicketRaw[];
    const tickets: NormalizedTicket[] = [];
    let next = cursor;
    for (const t of raw ?? []) {
      tickets.push(
        buildTicket(this.id, {
          externalId:      String(t.id),
          externalUrl:     `${base}/a/tickets/${t.id}`,
          externalVersion: t.updated_at,
          title:           t.subject,
          body:            t.description_text ?? t.description ?? null,
          state:           FRESHDESK_STATUS[t.status ?? 2] ?? 'open',
          extra:           {
            priority: FRESHDESK_PRIORITY[t.priority ?? 2] ?? 'normal',
            ticketType: t.type ?? null,
            requester: t.requester_id != null ? String(t.requester_id) : null,
          },
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
    if (!res.ok) throw new Error(`Freshdesk ticket update failed: ${res.status}`);
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
  priority?: string;
  /** Caller/customer — with sysparm_display_value=true this is a display name. */
  caller_id?: string;
  category?: string;
  sys_updated_on?: string;
}

/** ServiceNow numeric priority (display value "1 - Critical" etc.) → our vocabulary. */
function serviceNowPriority(raw: string | undefined): string {
  const s = (raw ?? '').toLowerCase();
  if (s.includes('critical') || s.startsWith('1')) return 'urgent';
  if (s.includes('high') || s.startsWith('2')) return 'high';
  if (s.includes('low') || s.startsWith('4') || s.startsWith('5')) return 'low';
  return 'normal';
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
          extra:           {
            number: r.number ?? null,
            priority: serviceNowPriority(r.priority),
            requester: r.caller_id ?? null,
            category: r.category ?? null,
          },
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

  async discover(): Promise<DiscoveryResult> {
    const token = String(this.cfg.credentials.token ?? '');
    if (!token) throw new Error('monday provider requires a token credential');
    const hdr = { 'API-Version': '2024-01' };

    // Boards (= projects) with item counts + their groups (= item types).
    const boardsQuery = `query { boards(limit: 200, state: active) { id name description items_count groups { id title } } }`;
    const boardsData = await gqlFetch<{ boards: Array<{ id: string; name: string; description?: string; items_count?: number; groups?: Array<{ id: string; title: string }> }> }>(
      this.fetchFn, MondayBoardProvider.ENDPOINT, token, boardsQuery, {}, 'monday', hdr,
    );
    const projects: DiscoveredProject[] = [];
    const typeSet = new Map<string, DiscoveredItemType>();
    for (const b of boardsData.boards ?? []) {
      projects.push({ externalId: b.id, name: b.name, description: b.description ?? null, url: `https://monday.com/boards/${b.id}`, itemCount: b.items_count ?? null });
      for (const g of b.groups ?? []) {
        if (!typeSet.has(g.title)) typeSet.set(g.title, { externalType: g.title, name: g.title, category: null });
      }
    }

    // Users.
    const usersQuery = `query { users(limit: 200, kind: non_guests) { id name email } }`;
    const usersData = await gqlFetch<{ users: Array<{ id: string; name: string; email?: string }> }>(
      this.fetchFn, MondayBoardProvider.ENDPOINT, token, usersQuery, {}, 'monday', hdr,
    );
    const users: DiscoveredUser[] = (usersData.users ?? []).map((u) => ({ externalId: u.id, displayName: u.name, email: u.email ?? null }));

    return { projects, itemTypes: [...typeSet.values()], users };
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
// GitLab (REST v4) — scm/pm (Issues)
// ---------------------------------------------------------------------------

interface GitLabIssueRaw {
  iid: number;
  title: string;
  description?: string | null;
  web_url?: string;
  state?: string;          // opened | closed
  updated_at?: string;
  issue_type?: string;     // issue | incident | test_case | task
  assignee?: { id?: number } | null;
}

export class GitLabBoardProvider implements BoardProvider {
  readonly id = 'gitlab';
  constructor(private readonly cfg: ProviderConfig, private readonly fetchFn: FetchLike) {}

  private root(): string {
    return trimSlash(this.cfg.baseUrl) || 'https://gitlab.com';
  }

  private headers(): Record<string, string> {
    const token = String(this.cfg.credentials.accessToken ?? '');
    return { Authorization: `Bearer ${token}`, 'PRIVATE-TOKEN': token, Accept: 'application/json' };
  }

  async fetchTicketsSince(cursor: string | null): Promise<FetchPage> {
    const project = (this.cfg.externalBoardId ?? '').trim();
    if (!project) throw new Error('gitlab provider requires externalBoardId (project id or path)');
    const pid = encodeURIComponent(project);

    const params = new URLSearchParams({ order_by: 'updated_at', sort: 'asc', per_page: '100', scope: 'all' });
    if (cursor) params.set('updated_after', cursor);

    const res = await this.fetchFn(`${this.root()}/api/v4/projects/${pid}/issues?${params.toString()}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`GitLab issues fetch failed: ${res.status}`);
    const raw = (await res.json()) as GitLabIssueRaw[];

    const tickets: NormalizedTicket[] = [];
    let next = cursor;
    for (const i of raw) {
      tickets.push(
        buildTicket(this.id, {
          externalId:      String(i.iid),
          externalUrl:     i.web_url ?? null,
          externalVersion: i.updated_at ?? null,
          title:           i.title,
          body:            i.description ?? null,
          state:           i.state ?? 'opened',
          externalType:    i.issue_type ?? 'issue',
          assigneeExternalId: i.assignee?.id != null ? String(i.assignee.id) : null,
        }),
      );
      next = maxVersion(next, i.updated_at ?? null);
    }
    return { tickets, nextCursor: next };
  }

  async pushUpdate(externalId: string, changeSet: ChangeSet): Promise<void> {
    const project = (this.cfg.externalBoardId ?? '').trim();
    const pid = encodeURIComponent(project);
    const body: Record<string, unknown> = {};
    if (changeSet.title !== undefined) body.title = changeSet.title;
    if (changeSet.body !== undefined) body.description = changeSet.body;
    if (changeSet.state !== undefined) body.state_event = String(changeSet.state) === 'closed' ? 'close' : 'reopen';
    if (Object.keys(body).length === 0) return;

    const res = await this.fetchFn(`${this.root()}/api/v4/projects/${pid}/issues/${externalId}`, {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`GitLab issue update failed: ${res.status}`);
  }

  async discover(): Promise<DiscoveryResult> {
    const headers = this.headers();
    // Projects the token is a member of (id + path, with issue counts).
    const projects: DiscoveredProject[] = [];
    const pRes = await this.fetchFn(`${this.root()}/api/v4/projects?membership=true&per_page=100&order_by=last_activity_at&with_issues_enabled=true`, { headers });
    if (!pRes.ok) throw new Error(`GitLab projects fetch failed: ${pRes.status}`);
    const rawProjects = (await pRes.json()) as Array<{ id: number; name: string; path_with_namespace?: string; description?: string; web_url?: string; open_issues_count?: number }>;
    for (const p of rawProjects) {
      projects.push({ externalId: String(p.id), key: p.path_with_namespace ?? null, name: p.name, description: p.description ?? null, url: p.web_url ?? null, itemCount: p.open_issues_count ?? null });
    }

    // GitLab work-item types are a fixed vocabulary.
    const itemTypes: DiscoveredItemType[] = [
      { externalType: 'issue', name: 'Issue', category: 'task' },
      { externalType: 'incident', name: 'Incident', category: 'bug' },
      { externalType: 'task', name: 'Task', category: 'task' },
      { externalType: 'test_case', name: 'Test Case', category: 'task' },
    ];

    // Users — dedupe members across the first 20 discovered projects (bounded).
    const users = new Map<string, DiscoveredUser>();
    for (const p of projects.slice(0, 20)) {
      const mRes = await this.fetchFn(`${this.root()}/api/v4/projects/${p.externalId}/members/all?per_page=100`, { headers });
      if (!mRes.ok) continue;
      const members = (await mRes.json()) as Array<{ id: number; name?: string; username?: string }>;
      for (const m of members) {
        const id = String(m.id);
        if (!users.has(id)) users.set(id, { externalId: id, displayName: m.name ?? m.username ?? id, email: null });
      }
    }

    return { projects, itemTypes, users: [...users.values()] };
  }
}

// ---------------------------------------------------------------------------
// Bitbucket (Cloud REST 2.0) — scm/pm (Issues)
// ---------------------------------------------------------------------------

interface BitbucketIssueRaw {
  id: number;
  title: string;
  content?: { raw?: string | null };
  state?: string;          // new | open | resolved | on hold | invalid | duplicate | wontfix | closed
  updated_on?: string;
  kind?: string;           // bug | enhancement | proposal | task
  assignee?: { uuid?: string; account_id?: string } | null;
  links?: { html?: { href?: string } };
}

export class BitbucketBoardProvider implements BoardProvider {
  readonly id = 'bitbucket';
  private static readonly BASE = 'https://api.bitbucket.org/2.0';
  constructor(private readonly cfg: ProviderConfig, private readonly fetchFn: FetchLike) {}

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${String(this.cfg.credentials.accessToken ?? '')}`, Accept: 'application/json' };
  }

  /** A board connection scopes to "workspace/repo_slug"; discovery uses the workspace alone. */
  private workspace(): string {
    const ws = String(this.cfg.credentials.workspace ?? '').trim();
    if (ws) return ws;
    return (this.cfg.externalBoardId ?? '').split('/')[0]?.trim() ?? '';
  }

  async fetchTicketsSince(cursor: string | null): Promise<FetchPage> {
    const scope = (this.cfg.externalBoardId ?? '').trim();
    const [ws, repo] = scope.split('/');
    if (!ws || !repo) throw new Error('bitbucket provider requires externalBoardId "workspace/repo_slug"');

    const params = new URLSearchParams({ sort: 'updated_on', pagelen: '100' });
    if (cursor) params.set('q', `updated_on > "${cursor}"`);

    const res = await this.fetchFn(`${BitbucketBoardProvider.BASE}/repositories/${ws}/${repo}/issues?${params.toString()}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Bitbucket issues fetch failed: ${res.status}`);
    const raw = (await res.json()) as { values?: BitbucketIssueRaw[] };

    const tickets: NormalizedTicket[] = [];
    let next = cursor;
    for (const i of raw.values ?? []) {
      tickets.push(
        buildTicket(this.id, {
          externalId:      String(i.id),
          externalUrl:     i.links?.html?.href ?? null,
          externalVersion: i.updated_on ?? null,
          title:           i.title,
          body:            i.content?.raw ?? null,
          state:           i.state ?? 'new',
          externalType:    i.kind ?? 'task',
          assigneeExternalId: i.assignee?.uuid ?? i.assignee?.account_id ?? null,
        }),
      );
      next = maxVersion(next, i.updated_on ?? null);
    }
    return { tickets, nextCursor: next };
  }

  async pushUpdate(externalId: string, changeSet: ChangeSet): Promise<void> {
    const scope = (this.cfg.externalBoardId ?? '').trim();
    const [ws, repo] = scope.split('/');
    const body: Record<string, unknown> = {};
    if (changeSet.title !== undefined) body.title = changeSet.title;
    if (changeSet.body !== undefined) body.content = { raw: changeSet.body };
    if (Object.keys(body).length === 0) return;

    const res = await this.fetchFn(`${BitbucketBoardProvider.BASE}/repositories/${ws}/${repo}/issues/${externalId}`, {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Bitbucket issue update failed: ${res.status}`);
  }

  async discover(): Promise<DiscoveryResult> {
    const ws = this.workspace();
    if (!ws) throw new Error('bitbucket discovery requires a workspace credential or externalBoardId');
    const headers = this.headers();

    // Repositories (= projects). externalId carries "workspace/repo_slug" so a
    // staged project maps straight onto a connection scope.
    const projects: DiscoveredProject[] = [];
    const rRes = await this.fetchFn(`${BitbucketBoardProvider.BASE}/repositories/${ws}?role=member&pagelen=100`, { headers });
    if (!rRes.ok) throw new Error(`Bitbucket repositories fetch failed: ${rRes.status}`);
    const repos = (await rRes.json()) as { values?: Array<{ slug?: string; name: string; full_name?: string; description?: string; links?: { html?: { href?: string } } }> };
    for (const r of repos.values ?? []) {
      const slug = r.slug ?? r.full_name?.split('/')[1] ?? r.name;
      projects.push({ externalId: `${ws}/${slug}`, key: r.full_name ?? `${ws}/${slug}`, name: r.name, description: r.description ?? null, url: r.links?.html?.href ?? null, itemCount: null });
    }

    // Bitbucket issue kinds are a fixed vocabulary.
    const itemTypes: DiscoveredItemType[] = [
      { externalType: 'bug', name: 'Bug', category: 'bug' },
      { externalType: 'enhancement', name: 'Enhancement', category: 'story' },
      { externalType: 'proposal', name: 'Proposal', category: 'story' },
      { externalType: 'task', name: 'Task', category: 'task' },
    ];

    // Workspace members (Bitbucket does not expose member emails).
    const users: DiscoveredUser[] = [];
    const mRes = await this.fetchFn(`${BitbucketBoardProvider.BASE}/workspaces/${ws}/members?pagelen=100`, { headers });
    if (mRes.ok) {
      const members = (await mRes.json()) as { values?: Array<{ user?: { uuid?: string; account_id?: string; display_name?: string } }> };
      for (const m of members.values ?? []) {
        const u = m.user;
        const id = u?.uuid ?? u?.account_id;
        if (id) users.push({ externalId: id, displayName: u?.display_name ?? id, email: null });
      }
    }

    return { projects, itemTypes, users };
  }
}

// ---------------------------------------------------------------------------
// Rally / CA Agile Central (WSAPI v2.0) — pm
// ---------------------------------------------------------------------------

interface RallyArtifactRaw {
  ObjectID: number;
  FormattedID?: string;
  Name: string;
  Description?: string | null;
  ScheduleState?: string;
  LastUpdateDate?: string;
  _ref?: string;
  _refObjectName?: string;
}

export class RallyBoardProvider implements BoardProvider {
  readonly id = 'rally';
  constructor(private readonly cfg: ProviderConfig, private readonly fetchFn: FetchLike) {}

  private base(): string {
    return trimSlash(this.cfg.baseUrl) || 'https://rally1.rallydev.com';
  }

  private headers(): Record<string, string> {
    // Rally WSAPI authenticates with an API key in the ZSESSIONID header.
    return { ZSESSIONID: String(this.cfg.credentials.apiKey ?? ''), Accept: 'application/json' };
  }

  async fetchTicketsSince(cursor: string | null): Promise<FetchPage> {
    const projectRef = (this.cfg.externalBoardId ?? '').trim();
    const clauses: string[] = [];
    if (cursor) clauses.push(`(LastUpdateDate > "${cursor}")`);
    const query = clauses.length ? clauses.join('') : '';
    const params = new URLSearchParams({
      order: 'LastUpdateDate',
      pagesize: '100',
      fetch: 'FormattedID,Name,Description,ScheduleState,LastUpdateDate,ObjectID',
    });
    if (query) params.set('query', query);
    if (projectRef) params.set('project', projectRef);

    const res = await this.fetchFn(`${this.base()}/slm/webservice/v2.0/hierarchicalrequirement?${params.toString()}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Rally fetch failed: ${res.status}`);
    const data = (await res.json()) as { QueryResult?: { Results?: RallyArtifactRaw[] } };

    const tickets: NormalizedTicket[] = [];
    let next = cursor;
    for (const a of data.QueryResult?.Results ?? []) {
      tickets.push(
        buildTicket(this.id, {
          externalId:      String(a.ObjectID),
          externalUrl:     a._ref ?? null,
          externalVersion: a.LastUpdateDate ?? null,
          title:           a.Name,
          body:            a.Description ?? null,
          state:           a.ScheduleState ?? 'Defined',
          externalType:    'User Story',
          extra:           { formattedId: a.FormattedID ?? null },
        }),
      );
      next = maxVersion(next, a.LastUpdateDate ?? null);
    }
    return { tickets, nextCursor: next };
  }

  async pushUpdate(externalId: string, changeSet: ChangeSet): Promise<void> {
    const fields: Record<string, unknown> = {};
    if (changeSet.title !== undefined) fields.Name = changeSet.title;
    if (changeSet.body !== undefined) fields.Description = changeSet.body;
    if (Object.keys(fields).length === 0) return;

    const res = await this.fetchFn(`${this.base()}/slm/webservice/v2.0/hierarchicalrequirement/${externalId}`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ HierarchicalRequirement: fields }),
    });
    if (!res.ok) throw new Error(`Rally update failed: ${res.status}`);
  }

  async discover(): Promise<DiscoveryResult> {
    const headers = this.headers();

    const projects: DiscoveredProject[] = [];
    const pRes = await this.fetchFn(`${this.base()}/slm/webservice/v2.0/project?fetch=Name,Description,ObjectID&pagesize=100`, { headers });
    if (!pRes.ok) throw new Error(`Rally project fetch failed: ${pRes.status}`);
    const pData = (await pRes.json()) as { QueryResult?: { Results?: Array<{ ObjectID: number; Name: string; Description?: string; _ref?: string }> } };
    for (const p of pData.QueryResult?.Results ?? []) {
      projects.push({ externalId: String(p.ObjectID), key: null, name: p.Name, description: p.Description ?? null, url: p._ref ?? null, itemCount: null });
    }

    // Rally artifact types we can import as tasks.
    const itemTypes: DiscoveredItemType[] = [
      { externalType: 'User Story', name: 'User Story', category: 'story' },
      { externalType: 'Defect', name: 'Defect', category: 'bug' },
      { externalType: 'Task', name: 'Task', category: 'task' },
      { externalType: 'Feature', name: 'Feature', category: 'epic' },
    ];

    const users: DiscoveredUser[] = [];
    const uRes = await this.fetchFn(`${this.base()}/slm/webservice/v2.0/user?fetch=UserName,DisplayName,EmailAddress,ObjectID&pagesize=200`, { headers });
    if (uRes.ok) {
      const uData = (await uRes.json()) as { QueryResult?: { Results?: Array<{ ObjectID: number; DisplayName?: string; UserName?: string; EmailAddress?: string }> } };
      for (const u of uData.QueryResult?.Results ?? []) {
        users.push({ externalId: String(u.ObjectID), displayName: u.DisplayName ?? u.UserName ?? String(u.ObjectID), email: u.EmailAddress ?? null });
      }
    }

    return { projects, itemTypes, users };
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
  freshdesk:    FreshdeskBoardProvider,
  servicenow:   ServiceNowBoardProvider,
  monday:       MondayBoardProvider,
  asana:        AsanaBoardProvider,
  clickup:      ClickUpBoardProvider,
  gitlab:       GitLabBoardProvider,
  bitbucket:    BitbucketBoardProvider,
  rally:        RallyBoardProvider,
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
