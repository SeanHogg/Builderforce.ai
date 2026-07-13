/**
 * Bitbucket Cloud REST 2.0 → activity events (the poll producer for Bitbucket).
 *
 * Mirrors {@link ./githubActivitySource}: pulls commits + pull requests since a
 * watermark and maps them to {@link IngestEvent}s. Commits are attributed by the
 * Bitbucket account_id when present, else the git author email parsed from `raw`
 * (never an orphan). Bitbucket has no clean "review submitted" event, so review
 * events are omitted (parity with GitLab).
 *
 * Raw-payload → IngestEvent mappers are pure + exported for unit tests.
 */
import type { FetchLike } from '../repos/sources/repoSourceBase';
import type { ActivitySource, IngestEvent } from './activityIngest';

const BACKFILL_PAGES = 5;

export interface BitbucketRepoCoords { owner: string; repo: string; token: string; username?: string | null; }

interface BbAuthor { raw?: string; user?: { account_id?: string; nickname?: string; display_name?: string; links?: { avatar?: { href?: string } } } | null }
interface BbCommit { hash?: string; message?: string; date?: string; author?: BbAuthor; links?: { html?: { href?: string } } }
interface BbCommitPage { values?: BbCommit[]; next?: string }
interface BbPull {
  id?: number;
  title?: string;
  state?: string;        // 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED'
  author?: { account_id?: string; nickname?: string; display_name?: string; links?: { avatar?: { href?: string } } } | null;
  created_on?: string;
  updated_on?: string;
  links?: { html?: { href?: string } };
}
interface BbPullPage { values?: BbPull[]; next?: string }

/** Pull "name <email>" → email (else null). Bitbucket commit authors carry `raw`. */
export function emailFromRaw(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const m = raw.match(/<([^>]+)>/);
  return m ? m[1]!.trim() : null;
}

// ── pure mappers ──────────────────────────────────────────────────────────────

/** A Bitbucket commit → one 'commit' event. account_id is the stable identity;
 *  fall back to the git author email so the author is always attributable. */
export function mapBbCommit(c: BbCommit, repoFullName: string, repoName: string): IngestEvent | null {
  if (!c.hash) return null;
  const user = c.author?.user ?? null;
  const email = emailFromRaw(c.author?.raw);
  const extId = user?.account_id ?? email;
  return {
    eventType: 'commit',
    externalId: c.hash,
    contributorExternalId: extId,
    authorDisplayName: user?.display_name ?? user?.nickname ?? ((c.author?.raw ?? '').replace(/\s*<[^>]+>/, '').trim() || null),
    authorEmail: email,
    authorAvatarUrl: user?.links?.avatar?.href ?? null,
    repositoryName: repoName,
    repositoryFullName: repoFullName,
    title: (c.message ?? '').split('\n')[0]!.slice(0, 500),
    url: c.links?.html?.href ?? null,
    occurredAt: c.date ?? new Date().toISOString(),
  };
}

/** A pull request → its lifecycle events: pr_opened, plus pr_merged / pr_closed. */
export function mapBbPull(p: BbPull, repoFullName: string, repoName: string): IngestEvent[] {
  if (p.id == null) return [];
  const acct = p.author?.account_id ?? p.author?.nickname ?? null;
  const base = {
    contributorExternalId: acct,
    authorDisplayName: p.author?.display_name ?? p.author?.nickname ?? null,
    authorAvatarUrl: p.author?.links?.avatar?.href ?? null,
    repositoryName: repoName,
    repositoryFullName: repoFullName,
    title: p.title ?? null,
    url: p.links?.html?.href ?? null,
  };
  const out: IngestEvent[] = [{
    ...base, eventType: 'pr_opened', externalId: `pr-${p.id}`,
    occurredAt: p.created_on ?? new Date().toISOString(),
  }];
  if (p.state === 'MERGED') {
    const cycle = p.created_on && p.updated_on
      ? Math.max(0, Math.round((new Date(p.updated_on).getTime() - new Date(p.created_on).getTime()) / 3_600_000))
      : null;
    out.push({ ...base, eventType: 'pr_merged', externalId: `pr-${p.id}`, cycleTimeHours: cycle, occurredAt: p.updated_on ?? p.created_on ?? new Date().toISOString() });
  } else if (p.state === 'DECLINED' || p.state === 'SUPERSEDED') {
    out.push({ ...base, eventType: 'pr_closed', externalId: `pr-${p.id}`, occurredAt: p.updated_on ?? p.created_on ?? new Date().toISOString() });
  }
  return out;
}

// ── REST fetch ────────────────────────────────────────────────────────────────

export class BitbucketActivitySource implements ActivitySource {
  private readonly base = 'https://api.bitbucket.org/2.0';
  private readonly slug: string;
  constructor(private readonly cfg: BitbucketRepoCoords, private readonly fetchFn: FetchLike) {
    this.slug = `${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
  }

  private get headers(): Record<string, string> {
    const auth = this.cfg.username
      ? `Basic ${btoa(`${this.cfg.username}:${this.cfg.token}`)}`
      : `Bearer ${this.cfg.token}`;
    return { Authorization: auth, 'User-Agent': 'Builderforce/1.0', Accept: 'application/json' };
  }

  private async getJson<T>(url: string): Promise<T | null> {
    const res = await this.fetchFn(url, { headers: this.headers });
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as T | null;
  }

  async fetchSince(since: Date, repoFullName: string, repoName: string): Promise<IngestEvent[]> {
    const sinceIso = since.toISOString();
    const events: IngestEvent[] = [];

    // Commits: newest-first, no server `since` — page until older than the window.
    let commitsUrl: string | null = `${this.base}/repositories/${this.slug}/commits?pagelen=100`;
    for (let page = 0; page < BACKFILL_PAGES && commitsUrl; page++) {
      const body: BbCommitPage | null = await this.getJson<BbCommitPage>(commitsUrl);
      if (!body?.values?.length) break;
      let reachedOlder = false;
      for (const c of body.values) {
        if ((c.date ?? '') < sinceIso) { reachedOlder = true; continue; }
        const e = mapBbCommit(c, repoFullName, repoName);
        if (e) events.push(e);
      }
      if (reachedOlder) break;        // remaining pages are entirely older
      commitsUrl = body.next ?? null;
    }

    // Pull requests: server-side `q` filter on updated_on, newest-first.
    const q = encodeURIComponent(`updated_on>="${sinceIso}"`);
    let prUrl: string | null = `${this.base}/repositories/${this.slug}/pullrequests?state=ALL&sort=-updated_on&pagelen=50&q=${q}`;
    for (let page = 0; page < BACKFILL_PAGES && prUrl; page++) {
      const body: BbPullPage | null = await this.getJson<BbPullPage>(prUrl);
      if (!body?.values?.length) break;
      for (const p of body.values) events.push(...mapBbPull(p, repoFullName, repoName));
      prUrl = body.next ?? null;
    }

    return events;
  }
}
