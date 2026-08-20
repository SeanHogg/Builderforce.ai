/**
 * BitbucketRepoSource — read a Bitbucket repo via REST, on EITHER edition.
 *
 * Bitbucket is two products with two incompatible APIs. Cloud speaks
 * `/2.0/repositories/{workspace}/{repo}/…`; Server (Data Center) speaks
 * `/rest/api/1.0/projects/{projectKey}/repos/{repoSlug}/…` with different
 * endpoints, different envelopes and different pagination. This class used to
 * hard-code the Cloud base, so a Server-hosted repo silently aimed Cloud paths at
 * `api.bitbucket.org` — the read just failed. The dialect now comes from the ONE
 * shaped target (`resolveRepoApiTarget`), and each method branches where the two
 * editions genuinely differ.
 *
 * Auth: Bearer <access-token>, or HTTP Basic (username + app password) when the
 * stored credential carries a username. Bitbucket has no languages API on either
 * edition, so `getLanguages` derives a {language: bytes} proxy from the file tree's
 * extensions ([1553]). On Cloud `owner` is the workspace and `repo` the slug; on
 * Server `owner` is the PROJECT KEY (or `~user` for a personal repo).
 */
import {
  type FetchLike,
  type RepoCommit,
  type RepoSource,
  type RepoSourceConfig,
  type RepoTreeEntry,
  RepoSourceError,
} from './repoSourceBase';
import { deriveLanguagesFromTree } from './languageWeighting';
import { parseBitbucketServerBrowse, resolveRepoApiTarget, type RepoApiTarget } from '../repoApiTarget';

interface BbRepo { mainbranch?: { name?: string } }
interface BbSrcNode { path?: string; type?: string; size?: number }
interface BbSrcPage { values?: BbSrcNode[]; next?: string }
interface BbCommit { hash?: string; message?: string; date?: string }
interface BbCommitPage { values?: BbCommit[] }

/** Server's `/files` listing: a page of repo-relative file PATHS (strings). */
interface BsFilesPage { values?: string[]; isLastPage?: boolean; nextPageStart?: number | null }
interface BsCommit { id?: string; message?: string; authorTimestamp?: number }
interface BsCommitPage { values?: BsCommit[] }
interface BsDefaultBranch { displayId?: string; id?: string }

/** Pages we will walk on either edition before declaring the listing truncated. */
const MAX_TREE_PAGES = 20;
/** Server `/files` page size — its hard cap is 1000. */
const SERVER_PAGE_LIMIT = 1000;

export class BitbucketRepoSource implements RepoSource {
  private readonly api: RepoApiTarget;

  constructor(private readonly cfg: RepoSourceConfig, private readonly fetchFn: FetchLike) {
    this.api = resolveRepoApiTarget({
      provider: 'bitbucket', host: cfg.host ?? null, owner: cfg.owner, repo: cfg.repo,
    });
  }

  private get isServer(): boolean {
    return this.api.flavor === 'bitbucket-server';
  }

  private get headers(): Record<string, string> {
    const auth = this.cfg.username
      ? `Basic ${btoa(`${this.cfg.username}:${this.cfg.token}`)}`
      : `Bearer ${this.cfg.token}`;
    return { Authorization: auth, 'User-Agent': 'Builderforce/1.0', Accept: 'application/json' };
  }

  private async getJson<T>(url: string): Promise<{ ok: boolean; status: number; body: T | null }> {
    const res = await this.fetchFn(url, { headers: this.headers });
    if (!res.ok) return { ok: false, status: res.status, body: null };
    const body = (await res.json().catch(() => null)) as T | null;
    return { ok: true, status: res.status, body };
  }

  async getDefaultBranch(): Promise<string> {
    if (this.isServer) {
      // Server exposes the default branch as its own sub-resource; `displayId` is
      // the short name ('main'), `id` the fully-qualified ref.
      const { ok, status, body } = await this.getJson<BsDefaultBranch>(`${this.api.repoBase}/branches/default`);
      if (!ok) throw new RepoSourceError('bitbucket', status, 'default-branch fetch failed');
      return body?.displayId || (body?.id ?? '').replace(/^refs\/heads\//, '') || 'main';
    }
    const { ok, status, body } = await this.getJson<BbRepo>(this.api.repoBase);
    if (!ok) throw new RepoSourceError('bitbucket', status, 'repo metadata fetch failed');
    return body?.mainbranch?.name ?? 'main';
  }

  async getLanguages(): Promise<Record<string, number>> {
    // Bitbucket has no languages API on either edition — derive a {language: bytes}
    // proxy from the file tree's extensions, for parity with GitHub/GitLab's language
    // signal in the evidence bundle. Best-effort: a fetch failure yields {} (no
    // signal) rather than throwing the whole diagnostic. [1553]
    try {
      const branch = await this.getDefaultBranch();
      const { entries } = await this.getTree(branch);
      return deriveLanguagesFromTree(entries);
    } catch {
      return {};
    }
  }

  async getTree(ref: string): Promise<{ entries: RepoTreeEntry[]; truncated: boolean }> {
    return this.isServer ? this.getServerTree(ref) : this.getCloudTree(ref);
  }

  /** Cloud: `/src/{ref}/?max_depth=…` gives a recursive listing; `next` paginates. */
  private async getCloudTree(ref: string): Promise<{ entries: RepoTreeEntry[]; truncated: boolean }> {
    const entries: RepoTreeEntry[] = [];
    let url: string | null = `${this.api.repoBase}/src/${encodeURIComponent(ref)}/?max_depth=10&pagelen=100`;
    let pages = 0;
    let truncated = false;
    while (url && pages < MAX_TREE_PAGES) {
      const { ok, status, body }: { ok: boolean; status: number; body: BbSrcPage | null } =
        await this.getJson<BbSrcPage>(url);
      if (!ok) throw new RepoSourceError('bitbucket', status, 'src listing failed');
      for (const n of body?.values ?? []) {
        if (typeof n.path === 'string' && n.type === 'commit_file') {
          entries.push({ path: n.path, type: 'file', bytes: typeof n.size === 'number' ? n.size : undefined });
        }
      }
      url = body?.next ?? null;
      pages += 1;
      if (url && pages >= MAX_TREE_PAGES) truncated = true;
    }
    return { entries, truncated };
  }

  /**
   * Server: `/files?at={ref}` is the one endpoint that lists the tree RECURSIVELY —
   * `/browse` only ever returns one directory level, so walking it would cost a
   * request per directory. `/files` hands back bare path STRINGS with no size, which
   * is why Server entries carry no `bytes` (and `selectEvidence`'s size floor is what
   * keeps them rankable). Pagination is offset-based (`start`/`nextPageStart`).
   */
  private async getServerTree(ref: string): Promise<{ entries: RepoTreeEntry[]; truncated: boolean }> {
    const entries: RepoTreeEntry[] = [];
    let start: number | null = 0;
    let pages = 0;
    while (start !== null && pages < MAX_TREE_PAGES) {
      const url: string = `${this.api.repoBase}/files?at=${encodeURIComponent(ref)}`
        + `&limit=${SERVER_PAGE_LIMIT}&start=${start}`;
      const { ok, status, body }: { ok: boolean; status: number; body: BsFilesPage | null } =
        await this.getJson<BsFilesPage>(url);
      if (!ok) throw new RepoSourceError('bitbucket', status, 'file listing failed');
      for (const path of body?.values ?? []) {
        if (typeof path === 'string' && path) entries.push({ path, type: 'file' });
      }
      start = body?.isLastPage === false ? body?.nextPageStart ?? null : null;
      pages += 1;
      if (start !== null && pages >= MAX_TREE_PAGES) return { entries, truncated: true };
    }
    return { entries, truncated: false };
  }

  /**
   * File content at `ref`. Both editions have an endpoint that returns the raw
   * bytes, so the common path is one GET of `api.fileContent(...)`.
   *
   * Server fallback: `/raw` is the right endpoint but is not universally reachable
   * (older Data Center builds, and reverse proxies that only expose `/browse`), so a
   * non-200 there retries `/browse`, which answers with a PAGINATED envelope of
   * `lines: [{ text }]` — newline-stripped, one page at a time. That difference is
   * normalised here (`parseBitbucketServerBrowse` + a page walk) rather than leaked:
   * callers get one string, exactly as they do from every other provider.
   */
  async getFileContent(path: string, ref: string): Promise<string | null> {
    const res = await this.fetchFn(this.api.fileContent(path, ref), { headers: this.headers });
    if (res.ok) return res.text().catch(() => null);
    if (!this.isServer) return null;
    return this.browseFileContent(path, ref);
  }

  /** Reassemble a file from Server's line-paginated `/browse` pages. */
  private async browseFileContent(path: string, ref: string): Promise<string | null> {
    const pagesText: string[] = [];
    let start: number | null = 0;
    let pages = 0;
    while (start !== null && pages < MAX_TREE_PAGES) {
      const url: string = `${this.api.fileWrite(path)}?at=${encodeURIComponent(ref)}`
        + `&limit=${SERVER_PAGE_LIMIT}&start=${start}`;
      const { ok, body } = await this.getJson<unknown>(url);
      if (!ok) return pagesText.length > 0 ? pagesText.join('\n') : null;
      const page = parseBitbucketServerBrowse(body);
      if (page.text === null) return null; // a directory, or an unreadable/binary blob
      pagesText.push(page.text);
      start = page.nextPageStart;
      pages += 1;
    }
    return pagesText.join('\n');
  }

  async listCommits(ref: string, limit: number): Promise<RepoCommit[]> {
    if (this.isServer) {
      const { ok, body } = await this.getJson<BsCommitPage>(
        `${this.api.repoBase}/commits?until=${encodeURIComponent(ref)}&limit=${Math.min(limit, 100)}`,
      );
      if (!ok || !Array.isArray(body?.values)) return [];
      return body!.values!.map((c) => ({
        sha: c.id ?? '',
        message: c.message ?? '',
        // Server dates are epoch MILLISECONDS; the shared shape is an ISO string.
        date: typeof c.authorTimestamp === 'number' ? new Date(c.authorTimestamp).toISOString() : '',
      }));
    }
    const { ok, body } = await this.getJson<BbCommitPage>(
      `${this.api.repoBase}/commits/${encodeURIComponent(ref)}?pagelen=${Math.min(limit, 100)}`,
    );
    if (!ok || !Array.isArray(body?.values)) return [];
    return body!.values!.map((c) => ({ sha: c.hash ?? '', message: c.message ?? '', date: c.date ?? '' }));
  }
}
