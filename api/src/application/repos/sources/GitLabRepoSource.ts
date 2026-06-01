/**
 * GitLabRepoSource — read a GitLab project via the REST API v4 for analysis.
 * Auth: Bearer <token> (works for OAuth + PAT); GitLab also accepts
 * PRIVATE-TOKEN for PATs, so we send both headers. The project id is the
 * URL-encoded "owner/repo" path.
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

const MAX_FILE_BYTES = 512 * 1024;

interface GlProject { default_branch?: string }
interface GlTreeNode { path?: string; type?: string }
interface GlFile { content?: string; encoding?: string; size?: number }
interface GlCommit { id?: string; message?: string; created_at?: string }

export class GitLabRepoSource implements RepoSource {
  private readonly base: string;
  private readonly projectId: string;
  constructor(private readonly cfg: RepoSourceConfig, private readonly fetchFn: FetchLike) {
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

  private async get<T>(path: string): Promise<{ ok: boolean; status: number; body: T | null; res: Response | null }> {
    const res = await this.fetchFn(`${this.base}${path}`, { headers: this.headers });
    if (!res.ok) return { ok: false, status: res.status, body: null, res };
    const body = (await res.json().catch(() => null)) as T | null;
    return { ok: true, status: res.status, body, res };
  }

  async getDefaultBranch(): Promise<string> {
    const { ok, status, body } = await this.get<GlProject>(`/projects/${this.projectId}`);
    if (!ok) throw new RepoSourceError('gitlab', status, 'project metadata fetch failed');
    return body?.default_branch ?? 'main';
  }

  async getLanguages(): Promise<Record<string, number>> {
    // GitLab returns { lang: percentage }; we keep the relative weighting.
    const { ok, body } = await this.get<Record<string, number>>(`/projects/${this.projectId}/languages`);
    return ok && body ? body : {};
  }

  async getTree(ref: string): Promise<{ entries: RepoTreeEntry[]; truncated: boolean }> {
    const entries: RepoTreeEntry[] = [];
    let page = 1;
    const maxPages = 20; // 20 * 100 = 2000 entries cap — bounds subrequests
    let truncated = false;
    while (page <= maxPages) {
      const { ok, status, body, res } = await this.get<GlTreeNode[]>(
        `/projects/${this.projectId}/repository/tree?recursive=true&per_page=100&ref=${encodeURIComponent(ref)}&page=${page}`,
      );
      if (!ok) throw new RepoSourceError('gitlab', status, 'tree fetch failed');
      for (const n of body ?? []) {
        if (typeof n.path === 'string') {
          entries.push({ path: n.path, type: n.type === 'tree' ? 'dir' : 'file' });
        }
      }
      const next = res?.headers.get('x-next-page');
      if (!next) break;
      if (page >= maxPages) { truncated = true; break; }
      page = Number(next);
      if (!Number.isFinite(page) || page <= 0) break;
    }
    return { entries, truncated };
  }

  async getFileContent(path: string, ref: string): Promise<string | null> {
    const { ok, body } = await this.get<GlFile>(
      `/projects/${this.projectId}/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`,
    );
    if (!ok || !body) return null;
    if (typeof body.size === 'number' && body.size > MAX_FILE_BYTES) return null;
    if (body.encoding !== 'base64' || typeof body.content !== 'string') return null;
    return decodeBase64Utf8(body.content.replace(/\n/g, ''));
  }

  async listCommits(ref: string, limit: number): Promise<RepoCommit[]> {
    const { ok, body } = await this.get<GlCommit[]>(
      `/projects/${this.projectId}/repository/commits?ref_name=${encodeURIComponent(ref)}&per_page=${Math.min(limit, 100)}`,
    );
    if (!ok || !Array.isArray(body)) return [];
    return body.map((c) => ({ sha: c.id ?? '', message: c.message ?? '', date: c.created_at ?? '' }));
  }
}
