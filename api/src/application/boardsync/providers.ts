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

/** Factory: build a provider adapter by id. Throws for unknown providers. */
export function createBoardProvider(
  provider: string,
  cfg: ProviderConfig,
  fetchFn: FetchLike,
): BoardProvider {
  switch (provider) {
    case 'github':
      return new GitHubBoardProvider(cfg, fetchFn);
    case 'jira':
      return new JiraBoardProvider(cfg, fetchFn);
    default:
      throw new Error(`Unsupported board provider: ${provider}`);
  }
}
