/**
 * GitHub REST → activity events (the POLL producer).
 *
 * Pulls a connected repo's commits / pull requests / reviews from the GitHub REST
 * API since a watermark and maps them to {@link IngestEvent}s. This is what makes
 * "connect a repo → its activity is ingested" true WITHOUT a webhook, and what
 * backfills history on first sync (the webhook only ever sees events that arrive
 * after it's configured). Driven by {@link ./runRepoActivitySweep}.
 *
 * The raw-payload → IngestEvent mappers are pure + exported so they're unit-tested
 * without the network. Pagination is bounded (BACKFILL_PAGES) so a first-sync of a
 * huge repo can't blow the Worker subrequest budget — honest partial coverage that
 * the next incremental run continues from the advanced watermark.
 */
import type { FetchLike } from '../repos/sources/repoSourceBase';
import type { IngestEvent } from './activityIngest';

/** Max pages (×100) of each list to pull in one sync — bounds a first backfill. */
const BACKFILL_PAGES = 5;
/** Cap on PRs we fetch reviews for per run (reviews are a per-PR subrequest). */
const REVIEW_PR_CAP = 25;

export interface GithubRepoCoords { owner: string; repo: string; host?: string | null; token: string; }

interface GhListCommit {
  sha?: string;
  html_url?: string;
  commit?: { message?: string; author?: { name?: string; email?: string; date?: string } };
  author?: { login?: string; avatar_url?: string } | null;
}
interface GhListPull {
  number?: number;
  title?: string;
  html_url?: string;
  state?: string;
  user?: { login?: string; avatar_url?: string } | null;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
  merged_at?: string | null;
}
interface GhReview {
  id?: number;
  state?: string;
  html_url?: string;
  submitted_at?: string;
  user?: { login?: string; avatar_url?: string } | null;
}

// ── pure mappers (raw GitHub JSON → IngestEvent) ─────────────────────────────

/** A list-commits row → one 'commit' event. Prefers the GitHub login, else the
 *  git author email, so the author is always attributable (no orphan). */
export function mapCommit(c: GhListCommit, repoFullName: string, repoName: string): IngestEvent | null {
  if (!c.sha) return null;
  const login = c.author?.login ?? null;
  const email = c.commit?.author?.email ?? null;
  const message = c.commit?.message ?? '';
  return {
    eventType: 'commit',
    externalId: c.sha,
    contributorExternalId: login ?? email,
    authorDisplayName: c.commit?.author?.name ?? login,
    authorEmail: email,
    authorAvatarUrl: c.author?.avatar_url ?? null,
    repositoryName: repoName,
    repositoryFullName: repoFullName,
    title: (message.split('\n')[0] ?? '').slice(0, 500),
    url: c.html_url ?? null,
    occurredAt: c.commit?.author?.date ?? new Date().toISOString(),
  };
}

/** A list-pulls row → its lifecycle events: always pr_opened; plus pr_merged (with
 *  cycle time) or pr_closed once the PR is closed. Idempotent on the unique key. */
export function mapPull(p: GhListPull, repoFullName: string, repoName: string): IngestEvent[] {
  if (p.number == null) return [];
  const login = p.user?.login ?? null;
  const avatar = p.user?.avatar_url ?? null;
  const base = {
    contributorExternalId: login,
    authorDisplayName: login,
    authorAvatarUrl: avatar,
    repositoryName: repoName,
    repositoryFullName: repoFullName,
    title: p.title ?? null,
    url: p.html_url ?? null,
  };
  const out: IngestEvent[] = [{
    ...base,
    eventType: 'pr_opened',
    externalId: `pr-${p.number}`,
    occurredAt: p.created_at ?? new Date().toISOString(),
  }];
  if (p.merged_at) {
    const cycle = p.created_at
      ? Math.max(0, Math.round((new Date(p.merged_at).getTime() - new Date(p.created_at).getTime()) / 3_600_000))
      : null;
    out.push({ ...base, eventType: 'pr_merged', externalId: `pr-${p.number}`, cycleTimeHours: cycle, occurredAt: p.merged_at });
  } else if (p.state === 'closed' && p.closed_at) {
    out.push({ ...base, eventType: 'pr_closed', externalId: `pr-${p.number}`, occurredAt: p.closed_at });
  }
  return out;
}

/** A PR review → one 'pr_reviewed' event. */
export function mapReview(r: GhReview, repoFullName: string, repoName: string): IngestEvent | null {
  if (r.id == null) return null;
  const login = r.user?.login ?? null;
  return {
    eventType: 'pr_reviewed',
    externalId: `review-${r.id}`,
    contributorExternalId: login,
    authorDisplayName: login,
    authorAvatarUrl: r.user?.avatar_url ?? null,
    repositoryName: repoName,
    repositoryFullName: repoFullName,
    title: r.state ? `Review: ${r.state}` : 'Review',
    url: r.html_url ?? null,
    occurredAt: r.submitted_at ?? new Date().toISOString(),
  };
}

// ── REST fetch (commits + pulls + reviews since the watermark) ────────────────

export class GithubActivitySource {
  private readonly base: string;
  private readonly slug: string;
  constructor(private readonly cfg: GithubRepoCoords, private readonly fetchFn: FetchLike) {
    const host = (cfg.host ?? 'github.com').trim();
    this.base = host === 'github.com' || !host ? 'https://api.github.com' : `https://${host}/api/v3`;
    this.slug = `${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.cfg.token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Builderforce/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private async getJson<T>(path: string): Promise<T | null> {
    const res = await this.fetchFn(`${this.base}${path}`, { headers: this.headers });
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as T | null;
  }

  /**
   * All activity events for this repo since `since` (ISO). `repoFullName` stamps
   * the events for project attribution. Bounded pagination; reviews fetched only
   * for PRs updated in the window, capped.
   */
  async fetchSince(since: Date, repoFullName: string, repoName: string): Promise<IngestEvent[]> {
    const sinceIso = since.toISOString();
    const events: IngestEvent[] = [];

    // Commits — server-side `since` filter.
    for (let page = 1; page <= BACKFILL_PAGES; page++) {
      const rows = await this.getJson<GhListCommit[]>(
        `/repos/${this.slug}/commits?since=${encodeURIComponent(sinceIso)}&per_page=100&page=${page}`,
      );
      if (!rows || rows.length === 0) break;
      for (const c of rows) { const e = mapCommit(c, repoFullName, repoName); if (e) events.push(e); }
      if (rows.length < 100) break;
    }

    // Pulls — sorted by updated desc; stop once we page past the window. No
    // server-side `since`, so filter by updated_at >= since in-memory.
    const updatedPulls: GhListPull[] = [];
    for (let page = 1; page <= BACKFILL_PAGES; page++) {
      const rows = await this.getJson<GhListPull[]>(
        `/repos/${this.slug}/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${page}`,
      );
      if (!rows || rows.length === 0) break;
      const inWindow = rows.filter((p) => (p.updated_at ?? p.created_at ?? '') >= sinceIso);
      for (const p of inWindow) { events.push(...mapPull(p, repoFullName, repoName)); updatedPulls.push(p); }
      if (inWindow.length < rows.length) break;   // remaining pages are older
      if (rows.length < 100) break;
    }

    // Reviews — only for PRs touched in the window, capped to bound subrequests.
    for (const p of updatedPulls.slice(0, REVIEW_PR_CAP)) {
      const rows = await this.getJson<GhReview[]>(`/repos/${this.slug}/pulls/${p.number}/reviews?per_page=100`);
      if (!rows) continue;
      for (const r of rows) {
        if ((r.submitted_at ?? '') < sinceIso) continue;
        const e = mapReview(r, repoFullName, repoName);
        if (e) events.push(e);
      }
    }

    return events;
  }
}
