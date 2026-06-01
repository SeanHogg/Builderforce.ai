/**
 * GitHubRepoSource — read a GitHub repo via the REST API for analysis.
 * Auth: Bearer <token> (PAT / GitHub App installation token / OAuth).
 * Assumes github.com (api.github.com); GitHub Enterprise hosts are a v2 item.
 */
import {
  type FetchLike,
  type RepoCommit,
  type RepoSource,
  type RepoSourceConfig,
  type RepoTreeEntry,
  RepoSourceError,
  decodeBase64Utf8,
} from './RepoSource';

/** Skip files larger than this (bytes) — protects the token budget + memory. */
const MAX_FILE_BYTES = 512 * 1024;

interface GhRepo { default_branch?: string }
interface GhTree { tree?: Array<{ path?: string; type?: string; size?: number }>; truncated?: boolean }
interface GhContent { content?: string; encoding?: string; size?: number }
interface GhCommit { sha?: string; commit?: { message?: string; author?: { date?: string } } }

export class GitHubRepoSource implements RepoSource {
  private readonly base: string;
  constructor(private readonly cfg: RepoSourceConfig, private readonly fetchFn: FetchLike) {
    const host = (cfg.host ?? 'github.com').trim();
    this.base = host === 'github.com' || !host ? 'https://api.github.com' : `https://${host}/api/v3`;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.cfg.token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Builderforce/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private get slug(): string {
    return `${encodeURIComponent(this.cfg.owner)}/${encodeURIComponent(this.cfg.repo)}`;
  }

  private async get<T>(path: string): Promise<{ ok: boolean; status: number; body: T | null }> {
    const res = await this.fetchFn(`${this.base}${path}`, { headers: this.headers });
    if (!res.ok) return { ok: false, status: res.status, body: null };
    const body = (await res.json().catch(() => null)) as T | null;
    return { ok: true, status: res.status, body };
  }

  async getDefaultBranch(): Promise<string> {
    const { ok, status, body } = await this.get<GhRepo>(`/repos/${this.slug}`);
    if (!ok) throw new RepoSourceError('github', status, 'repo metadata fetch failed');
    return body?.default_branch ?? 'main';
  }

  async getLanguages(): Promise<Record<string, number>> {
    const { ok, body } = await this.get<Record<string, number>>(`/repos/${this.slug}/languages`);
    return ok && body ? body : {};
  }

  async getTree(ref: string): Promise<{ entries: RepoTreeEntry[]; truncated: boolean }> {
    const { ok, status, body } = await this.get<GhTree>(
      `/repos/${this.slug}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    );
    if (!ok) throw new RepoSourceError('github', status, 'tree fetch failed');
    const entries: RepoTreeEntry[] = (body?.tree ?? [])
      .filter((t) => typeof t.path === 'string')
      .map((t) => ({
        path: t.path as string,
        type: t.type === 'tree' ? 'dir' : 'file',
        bytes: typeof t.size === 'number' ? t.size : undefined,
      }));
    return { entries, truncated: body?.truncated === true };
  }

  async getFileContent(path: string, ref: string): Promise<string | null> {
    const { ok, body } = await this.get<GhContent>(
      `/repos/${this.slug}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`,
    );
    if (!ok || !body) return null;
    if (typeof body.size === 'number' && body.size > MAX_FILE_BYTES) return null;
    if (body.encoding !== 'base64' || typeof body.content !== 'string') return null;
    return decodeBase64Utf8(body.content.replace(/\n/g, ''));
  }

  async listCommits(ref: string, limit: number): Promise<RepoCommit[]> {
    const { ok, body } = await this.get<GhCommit[]>(
      `/repos/${this.slug}/commits?sha=${encodeURIComponent(ref)}&per_page=${Math.min(limit, 100)}`,
    );
    if (!ok || !Array.isArray(body)) return [];
    return body.map((c) => ({
      sha: c.sha ?? '',
      message: c.commit?.message ?? '',
      date: c.commit?.author?.date ?? '',
    }));
  }
}
