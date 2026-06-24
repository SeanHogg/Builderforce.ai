/**
 * GitLab REST v4 → activity events (the poll producer for GitLab projects).
 *
 * Mirrors {@link ./githubActivitySource}: pulls commits + merge requests since a
 * watermark and maps them to {@link IngestEvent}s. GitLab's commit API exposes the
 * git author email but not a GitLab username, so commits are attributed by email
 * (provider 'gitlab') — still a real contributor, never an orphan. MRs carry the
 * author username. Review events are GitHub-specific (GitLab's approval model has
 * no equivalent "review submitted" event), so they're omitted here.
 *
 * Raw-payload → IngestEvent mappers are pure + exported for unit tests.
 */
import type { FetchLike } from '../repos/sources/repoSourceBase';
import type { ActivitySource, IngestEvent } from './activityIngest';

const BACKFILL_PAGES = 5;

export interface GitlabRepoCoords { owner: string; repo: string; host?: string | null; token: string; }

interface GlCommit {
  id?: string;
  title?: string;
  message?: string;
  created_at?: string;
  author_name?: string;
  author_email?: string;
  web_url?: string;
  stats?: { additions?: number; deletions?: number; total?: number };
}
interface GlMergeRequest {
  iid?: number;
  title?: string;
  web_url?: string;
  state?: string;        // 'opened' | 'closed' | 'merged' | 'locked'
  author?: { username?: string; avatar_url?: string } | null;
  created_at?: string;
  updated_at?: string;
  merged_at?: string | null;
  closed_at?: string | null;
}

// ── pure mappers ──────────────────────────────────────────────────────────────

/** A GitLab commit → one 'commit' event, attributed by git author email. */
export function mapGlCommit(c: GlCommit, repoFullName: string, repoName: string): IngestEvent | null {
  if (!c.id) return null;
  const email = c.author_email ?? null;
  return {
    eventType: 'commit',
    externalId: c.id,
    contributorExternalId: email,
    authorDisplayName: c.author_name ?? null,
    authorEmail: email,
    repositoryName: repoName,
    repositoryFullName: repoFullName,
    title: (c.title ?? c.message ?? '').split('\n')[0]!.slice(0, 500),
    url: c.web_url ?? null,
    linesAdded: c.stats?.additions ?? null,
    linesRemoved: c.stats?.deletions ?? null,
    occurredAt: c.created_at ?? new Date().toISOString(),
  };
}

/** A merge request → its lifecycle events: pr_opened, plus pr_merged / pr_closed. */
export function mapGlMergeRequest(m: GlMergeRequest, repoFullName: string, repoName: string): IngestEvent[] {
  if (m.iid == null) return [];
  const login = m.author?.username ?? null;
  const base = {
    contributorExternalId: login,
    authorDisplayName: login,
    authorAvatarUrl: m.author?.avatar_url ?? null,
    repositoryName: repoName,
    repositoryFullName: repoFullName,
    title: m.title ?? null,
    url: m.web_url ?? null,
  };
  const out: IngestEvent[] = [{
    ...base, eventType: 'pr_opened', externalId: `mr-${m.iid}`,
    occurredAt: m.created_at ?? new Date().toISOString(),
  }];
  if (m.merged_at) {
    const cycle = m.created_at
      ? Math.max(0, Math.round((new Date(m.merged_at).getTime() - new Date(m.created_at).getTime()) / 3_600_000))
      : null;
    out.push({ ...base, eventType: 'pr_merged', externalId: `mr-${m.iid}`, cycleTimeHours: cycle, occurredAt: m.merged_at });
  } else if (m.state === 'closed' && m.closed_at) {
    out.push({ ...base, eventType: 'pr_closed', externalId: `mr-${m.iid}`, occurredAt: m.closed_at });
  }
  return out;
}

// ── REST fetch ────────────────────────────────────────────────────────────────

export class GitlabActivitySource implements ActivitySource {
  private readonly base: string;
  private readonly projectId: string;
  constructor(private readonly cfg: GitlabRepoCoords, private readonly fetchFn: FetchLike) {
    const host = (cfg.host ?? 'gitlab.com').trim() || 'gitlab.com';
    this.base = `https://${host}/api/v4`;
    this.projectId = encodeURIComponent(`${cfg.owner}/${cfg.repo}`);
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.cfg.token}`,
      'PRIVATE-TOKEN': this.cfg.token,
      'User-Agent': 'Builderforce/1.0',
      Accept: 'application/json',
    };
  }

  private async getJson<T>(path: string): Promise<T | null> {
    const res = await this.fetchFn(`${this.base}${path}`, { headers: this.headers });
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as T | null;
  }

  async fetchSince(since: Date, repoFullName: string, repoName: string): Promise<IngestEvent[]> {
    const sinceIso = since.toISOString();
    const events: IngestEvent[] = [];

    for (let page = 1; page <= BACKFILL_PAGES; page++) {
      const rows = await this.getJson<GlCommit[]>(
        `/projects/${this.projectId}/repository/commits?since=${encodeURIComponent(sinceIso)}&with_stats=true&all=true&per_page=100&page=${page}`,
      );
      if (!rows || rows.length === 0) break;
      for (const c of rows) { const e = mapGlCommit(c, repoFullName, repoName); if (e) events.push(e); }
      if (rows.length < 100) break;
    }

    for (let page = 1; page <= BACKFILL_PAGES; page++) {
      const rows = await this.getJson<GlMergeRequest[]>(
        `/projects/${this.projectId}/merge_requests?updated_after=${encodeURIComponent(sinceIso)}&state=all&order_by=updated_at&sort=desc&per_page=100&page=${page}`,
      );
      if (!rows || rows.length === 0) break;
      for (const m of rows) events.push(...mapGlMergeRequest(m, repoFullName, repoName));
      if (rows.length < 100) break;
    }

    return events;
  }
}
