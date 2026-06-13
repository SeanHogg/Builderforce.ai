/**
 * readRepoContents — read a file's contents and list the repo tree via the
 * provider REST API, server-side with the tenant's decrypted token.
 *
 * These back the cloud agent's read tools (`read_file` / `list_files`) so the
 * Worker loop — which has no filesystem — can inspect an EXISTING codebase before
 * editing it, instead of only writing fresh files. `read_file`/`list_files` work
 * for GitHub, GitLab, and Bitbucket Cloud (non-GitHub via the shared RepoSource);
 * `searchRepoCode`/`compare` remain GitHub-only (no cross-provider code-search /
 * compare equivalent yet). Never throws.
 */
import { buildGitApiBaseUrl } from './gitProxy';
import { createRepoSource, makeRepoFetch } from './sources/RepoSource';

export interface RepoReadContext {
  provider: string;
  host: string | null;
  owner: string;
  repo: string;
  token: string;
  /** Branch/ref to read from. */
  ref: string;
}

/** Cap on a single file read so one huge file can't blow the model's context. */
const MAX_FILE_CHARS = 60_000;
/** Cap on the tree listing so a giant monorepo can't blow the context/budget. */
const MAX_TREE_ENTRIES = 400;

export type ReadFileResult =
  | { ok: true; path: string; content: string; truncated: boolean }
  | { ok: false; reason: string };

export type ListFilesResult =
  | { ok: true; paths: string[]; truncated: boolean }
  | { ok: false; reason: string };

export type SearchCodeResult =
  | { ok: true; matches: Array<{ path: string; fragments: string[] }>; total: number; truncated: boolean }
  | { ok: false; reason: string };

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'BuilderForce-Read/1.0',
  };
}

/** UTF-8-safe base64 decode (GitHub returns base64 with embedded newlines). */
function fromBase64Utf8(b64: string): string {
  const clean = b64.replace(/\s/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export async function readRepoFile(ctx: RepoReadContext, path: string): Promise<ReadFileResult> {
  if (!path) return { ok: false, reason: 'path is required' };
  // GitLab/Bitbucket route through the shared (tested) RepoSource.getFileContent;
  // GitHub keeps its richer inline path below (no-regression). [1248]
  if (ctx.provider !== 'github') {
    try {
      const src = createRepoSource(ctx.provider, { owner: ctx.owner, repo: ctx.repo, host: ctx.host, token: ctx.token }, makeRepoFetch());
      const content = await src.getFileContent(path, ctx.ref);
      if (content == null) return { ok: false, reason: `file not found on ${ctx.ref}: ${path}` };
      const truncated = content.length > MAX_FILE_CHARS;
      return { ok: true, path, content: truncated ? content.slice(0, MAX_FILE_CHARS) : content, truncated };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : `read not implemented for provider '${ctx.provider}'` };
    }
  }
  const apiBase = buildGitApiBaseUrl(ctx.provider, ctx.host);
  const url = `${apiBase}/repos/${ctx.owner}/${ctx.repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ctx.ref)}`;
  const res = await fetch(url, { headers: ghHeaders(ctx.token) }).catch(() => null);
  if (!res) return { ok: false, reason: 'read request failed (network)' };
  if (res.status === 404) return { ok: false, reason: `file not found on ${ctx.ref}: ${path}` };
  if (!res.ok) { const t = await res.text().catch(() => ''); return { ok: false, reason: `GitHub ${res.status}: ${t.slice(0, 160)}` }; }
  const json = (await res.json().catch(() => null)) as { content?: string; encoding?: string; type?: string } | null;
  if (!json || json.type !== 'file' || typeof json.content !== 'string') {
    return { ok: false, reason: `not a readable file: ${path}` };
  }
  let content = json.encoding === 'base64' ? fromBase64Utf8(json.content) : json.content;
  const truncated = content.length > MAX_FILE_CHARS;
  if (truncated) content = content.slice(0, MAX_FILE_CHARS);
  return { ok: true, path, content, truncated };
}

/**
 * Search the repo for a literal string/symbol across ALL files in ONE request via
 * GitHub's indexed code search — the cloud agent's missing "grep". Without this
 * the (shell-less) Worker loop has to read files one-by-one to find a reference,
 * which burns the step budget and leads to band-aid edits when it can't confirm.
 *
 * Scope caveat (surfaced to the model in the tool description): code search hits
 * GitHub's index of the repo's DEFAULT branch, so very-recently-pushed code may
 * lag and 0 results means "not in the indexed codebase" — confirm a specific file
 * with read_file when in doubt. `ctx.ref` is accepted for signature parity but
 * unused (the index isn't branch-scoped). Never throws.
 */
export async function searchRepoCode(
  ctx: RepoReadContext,
  query: string,
  opts?: { maxResults?: number },
): Promise<SearchCodeResult> {
  if (ctx.provider !== 'github') return { ok: false, reason: `search not implemented for provider '${ctx.provider}'` };
  if (!query.trim()) return { ok: false, reason: 'query is required' };
  const apiBase = buildGitApiBaseUrl(ctx.provider, ctx.host);
  const perPage = Math.min(Math.max(opts?.maxResults ?? 30, 1), 50);
  // GitHub's REST /search/code has NO boolean `OR` operator: a quoted query is an
  // exact-phrase match. So a model's natural compound query ("a OR b OR c") would
  // be matched verbatim — including the literal " OR "s — and return 0 for every
  // realistic search, leaving the agent blind. Split on " OR " and union the hits;
  // the common single-term case still runs exactly one request. Cap the fan-out so
  // a sprawling query can't burn GitHub's tight code-search rate limit.
  const terms = query.split(/\s+OR\s+/i).map((t) => t.trim()).filter(Boolean).slice(0, 5);
  const reqs = terms.map(async (term) => {
    // Quote each term so GitHub matches the literal token sequence, scoped to the repo.
    const q = `${JSON.stringify(term)} repo:${ctx.owner}/${ctx.repo}`;
    const url = `${apiBase}/search/code?q=${encodeURIComponent(q)}&per_page=${perPage}`;
    const res = await fetch(url, {
      headers: { ...ghHeaders(ctx.token), Accept: 'application/vnd.github.text-match+json' },
    }).catch(() => null);
    if (!res) return { reason: 'search request failed (network)' as const };
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { reason: `GitHub ${res.status}: ${t.slice(0, 160)}` };
    }
    const json = (await res.json().catch(() => null)) as {
      total_count?: number;
      items?: Array<{ path?: string; text_matches?: Array<{ fragment?: string }> }>;
    } | null;
    return { items: json?.items ?? [], total: json?.total_count ?? 0 };
  });
  const results = await Promise.all(reqs);
  // If every term's request failed (not just returned 0), surface the error.
  if (results.every((r) => 'reason' in r)) {
    return { ok: false, reason: (results[0] as { reason: string }).reason };
  }
  // Union by path, keeping the first fragments seen for each file.
  const byPath = new Map<string, { path: string; fragments: string[] }>();
  let totalCount = 0;
  for (const r of results) {
    if ('reason' in r) continue;
    totalCount += r.total;
    for (const it of r.items) {
      const path = it.path ?? '';
      if (!path || byPath.has(path)) continue;
      byPath.set(path, {
        path,
        fragments: (it.text_matches ?? []).map((m) => (m.fragment ?? '').trim()).filter(Boolean).slice(0, 3),
      });
    }
  }
  const matches = [...byPath.values()].slice(0, perPage);
  // total_count is per-term and double-counts files matching multiple terms; the
  // deduped match count is the honest floor for "is it truncated".
  const total = Math.max(totalCount, matches.length);
  return { ok: true, matches, total, truncated: total > matches.length };
}

export type BranchDiffEntry = { path: string; status: 'added' | 'modified' | 'removed' | 'renamed' | string };
export type BranchDiffResult =
  | { ok: true; files: BranchDiffEntry[]; truncated: boolean }
  | { ok: false; reason: string };

/** Cap on the diff listing so a sprawling branch can't blow the context/budget. */
const MAX_DIFF_ENTRIES = 100;

/**
 * List the files a ticket branch has changed relative to its base, via GitHub's
 * compare API (`base...branch`). This is what makes a *re-run* aware of what a
 * PRIOR pass already committed: the agent loop can then reconcile (and delete
 * dead/stub files) instead of blindly appending. A missing branch (first run, no
 * commits yet) returns an empty list, not an error. `ctx.ref` is unused here (the
 * range is explicit). Never throws.
 */
export async function listBranchDiff(ctx: RepoReadContext, base: string, branch: string): Promise<BranchDiffResult> {
  if (ctx.provider !== 'github') return { ok: false, reason: `compare not implemented for provider '${ctx.provider}'` };
  if (base.trim() === branch.trim()) return { ok: true, files: [], truncated: false };
  const apiBase = buildGitApiBaseUrl(ctx.provider, ctx.host);
  const range = `${encodeURIComponent(base)}...${encodeURIComponent(branch)}`;
  const url = `${apiBase}/repos/${ctx.owner}/${ctx.repo}/compare/${range}`;
  const res = await fetch(url, { headers: ghHeaders(ctx.token) }).catch(() => null);
  if (!res) return { ok: false, reason: 'compare request failed (network)' };
  // 404 = the branch doesn't exist yet (no prior commits) — a clean first run.
  if (res.status === 404) return { ok: true, files: [], truncated: false };
  if (!res.ok) { const t = await res.text().catch(() => ''); return { ok: false, reason: `GitHub ${res.status}: ${t.slice(0, 160)}` }; }
  const json = (await res.json().catch(() => null)) as { files?: Array<{ filename?: string; status?: string }> } | null;
  let files = (json?.files ?? [])
    .filter((f) => typeof f.filename === 'string')
    .map((f) => ({ path: f.filename as string, status: (f.status ?? 'modified') as BranchDiffEntry['status'] }));
  const truncated = files.length > MAX_DIFF_ENTRIES;
  if (truncated) files = files.slice(0, MAX_DIFF_ENTRIES);
  return { ok: true, files, truncated };
}

export async function listRepoFiles(ctx: RepoReadContext, subPath?: string): Promise<ListFilesResult> {
  // GitLab/Bitbucket via the shared RepoSource.getTree (which also recovers
  // truncated GitHub trees); GitHub keeps its inline path below (no-regression). [1248]
  if (ctx.provider !== 'github') {
    try {
      const src = createRepoSource(ctx.provider, { owner: ctx.owner, repo: ctx.repo, host: ctx.host, token: ctx.token }, makeRepoFetch());
      const { entries } = await src.getTree(ctx.ref);
      const prefix = subPath?.replace(/^\/+|\/+$/g, '');
      let paths = entries
        .filter((e) => e.type === 'file')
        .map((e) => e.path)
        .filter((p) => (prefix ? p === prefix || p.startsWith(`${prefix}/`) : true));
      const truncated = paths.length > MAX_TREE_ENTRIES;
      if (truncated) paths = paths.slice(0, MAX_TREE_ENTRIES);
      return { ok: true, paths, truncated };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : `list not implemented for provider '${ctx.provider}'` };
    }
  }
  const apiBase = buildGitApiBaseUrl(ctx.provider, ctx.host);
  // The ref lives in the path here (not a query param); a branch like
  // "builderforce/task-12" must keep its slash, so encode segments individually.
  const refPath = ctx.ref.split('/').map(encodeURIComponent).join('/');
  const url = `${apiBase}/repos/${ctx.owner}/${ctx.repo}/git/trees/${refPath}?recursive=1`;
  const res = await fetch(url, { headers: ghHeaders(ctx.token) }).catch(() => null);
  if (!res) return { ok: false, reason: 'list request failed (network)' };
  if (!res.ok) { const t = await res.text().catch(() => ''); return { ok: false, reason: `GitHub ${res.status}: ${t.slice(0, 160)}` }; }
  const json = (await res.json().catch(() => null)) as { tree?: Array<{ path?: string; type?: string }> } | null;
  const prefix = subPath?.replace(/^\/+|\/+$/g, '');
  let paths = (json?.tree ?? [])
    .filter((n) => n.type === 'blob' && typeof n.path === 'string')
    .map((n) => n.path as string)
    .filter((p) => (prefix ? p === prefix || p.startsWith(`${prefix}/`) : true));
  const truncated = paths.length > MAX_TREE_ENTRIES;
  if (truncated) paths = paths.slice(0, MAX_TREE_ENTRIES);
  return { ok: true, paths, truncated };
}
