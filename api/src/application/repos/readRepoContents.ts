/**
 * readRepoContents — read a file's contents and list the repo tree via the
 * provider REST API, server-side with the tenant's decrypted token.
 *
 * These back the cloud agent's read tools (`read_file` / `list_files`) so the
 * Worker loop — which has no filesystem — can inspect an EXISTING codebase before
 * editing it, instead of only writing fresh files. GitHub-only; other providers
 * return a typed `unsupported` result. Never throws.
 */
import { buildGitApiBaseUrl } from './gitProxy';

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
  if (ctx.provider !== 'github') return { ok: false, reason: `read not implemented for provider '${ctx.provider}'` };
  if (!path) return { ok: false, reason: 'path is required' };
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

export async function listRepoFiles(ctx: RepoReadContext, subPath?: string): Promise<ListFilesResult> {
  if (ctx.provider !== 'github') return { ok: false, reason: `list not implemented for provider '${ctx.provider}'` };
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
