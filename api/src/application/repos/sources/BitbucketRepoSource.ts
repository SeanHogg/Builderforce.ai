/**
 * BitbucketRepoSource — read a Bitbucket Cloud repo via the REST API 2.0.
 * Auth: Bearer <access-token>, or HTTP Basic (username + app password) when the
 * stored credential carries a username. Bitbucket has no languages API, so
 * language weighting is left to the caller (derived from file extensions).
 * `owner` is the workspace, `repo` is the repo slug.
 */
import {
  type FetchLike,
  type RepoCommit,
  type RepoSource,
  type RepoSourceConfig,
  type RepoTreeEntry,
  RepoSourceError,
} from './RepoSource';

interface BbRepo { mainbranch?: { name?: string } }
interface BbSrcNode { path?: string; type?: string; size?: number }
interface BbSrcPage { values?: BbSrcNode[]; next?: string }
interface BbCommit { hash?: string; message?: string; date?: string }
interface BbCommitPage { values?: BbCommit[] }

export class BitbucketRepoSource implements RepoSource {
  private readonly base = 'https://api.bitbucket.org/2.0';
  constructor(private readonly cfg: RepoSourceConfig, private readonly fetchFn: FetchLike) {}

  private get headers(): Record<string, string> {
    const auth = this.cfg.username
      ? `Basic ${btoa(`${this.cfg.username}:${this.cfg.token}`)}`
      : `Bearer ${this.cfg.token}`;
    return { Authorization: auth, 'User-Agent': 'Builderforce/1.0', Accept: 'application/json' };
  }

  private get slug(): string {
    return `${encodeURIComponent(this.cfg.owner)}/${encodeURIComponent(this.cfg.repo)}`;
  }

  private async getJson<T>(url: string): Promise<{ ok: boolean; status: number; body: T | null }> {
    const res = await this.fetchFn(url, { headers: this.headers });
    if (!res.ok) return { ok: false, status: res.status, body: null };
    const body = (await res.json().catch(() => null)) as T | null;
    return { ok: true, status: res.status, body };
  }

  async getDefaultBranch(): Promise<string> {
    const { ok, status, body } = await this.getJson<BbRepo>(`${this.base}/repositories/${this.slug}`);
    if (!ok) throw new RepoSourceError('bitbucket', status, 'repo metadata fetch failed');
    return body?.mainbranch?.name ?? 'main';
  }

  async getLanguages(): Promise<Record<string, number>> {
    return {}; // Bitbucket exposes no languages API.
  }

  async getTree(ref: string): Promise<{ entries: RepoTreeEntry[]; truncated: boolean }> {
    const entries: RepoTreeEntry[] = [];
    // max_depth gives a recursive listing; `next` paginates the result set.
    let url: string | null =
      `${this.base}/repositories/${this.slug}/src/${encodeURIComponent(ref)}/?max_depth=10&pagelen=100`;
    const maxPages = 20;
    let pages = 0;
    let truncated = false;
    while (url && pages < maxPages) {
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
      if (url && pages >= maxPages) truncated = true;
    }
    return { entries, truncated };
  }

  async getFileContent(path: string, ref: string): Promise<string | null> {
    const url = `${this.base}/repositories/${this.slug}/src/${encodeURIComponent(ref)}/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
    const res = await this.fetchFn(url, { headers: this.headers });
    if (!res.ok) return null;
    return res.text().catch(() => null);
  }

  async listCommits(ref: string, limit: number): Promise<RepoCommit[]> {
    const { ok, body } = await this.getJson<BbCommitPage>(
      `${this.base}/repositories/${this.slug}/commits/${encodeURIComponent(ref)}?pagelen=${Math.min(limit, 100)}`,
    );
    if (!ok || !Array.isArray(body?.values)) return [];
    return body!.values!.map((c) => ({ sha: c.hash ?? '', message: c.message ?? '', date: c.date ?? '' }));
  }
}
