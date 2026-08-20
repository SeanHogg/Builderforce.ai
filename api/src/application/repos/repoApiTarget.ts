/**
 * repoApiTarget — the ONE place that knows what a repo operation's URL looks like
 * on each REST dialect, and the ONLY place that knows Bitbucket Server's path shape.
 *
 * WHY THIS EXISTS
 * `buildGitApiBaseUrl` answers "what is the API root", which is not enough to call
 * anything: Bitbucket is two products whose paths diverge below the root
 * (`/2.0/repositories/{workspace}/{repo}/…` vs
 * `/rest/api/1.0/projects/{projectKey}/repos/{repoSlug}/…`), and GitHub/GitLab
 * disagree with both. Before this module every caller re-derived those segments
 * inline, which is why only the branch-lifecycle / PR callers ever learned the
 * Server dialect and the other five refused `unsupported` on a Server host. Adding
 * five more inline builders would have made the divergence five times harder to
 * keep right, so the shape lives here once and every caller composes it.
 *
 * SCOPE: URL construction and Bitbucket Server RESPONSE normalisation only. This
 * module performs no I/O and never throws for a reachable dialect — an unmapped
 * provider still throws, which each caller maps to its typed `unsupported` refusal.
 */
import {
  bitbucketServerRepoPath,
  buildBitbucketServerBranchUtilsBase,
  buildGitApiBaseUrl,
  resolveGitApiFlavor,
  type GitApiFlavor,
} from './gitProxy';

/** Minimum addressing every operation needs. `token` is deliberately NOT here —
 *  a URL builder has no business holding a credential. */
export interface RepoApiCoords {
  provider: string;
  host: string | null;
  owner: string;
  repo: string;
}

/**
 * Encode a ref/path for a URL PATH while PRESERVING its slashes. A ticket branch is
 * `builderforce/task-12` and a file is `src/app/page.tsx`; collapsing those slashes
 * into `%2F` 404s on every provider that puts them in the path.
 */
export function encodePathSegments(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}

/** GitLab addresses a project by the URL-encoded `owner/repo` path (slash included). */
export function gitlabProjectId(owner: string, repo: string): string {
  return encodeURIComponent(`${owner}/${repo}`);
}

/**
 * Every URL shape the repo surface needs, resolved for one repo's dialect.
 *
 * Methods (not precomputed strings) for anything parameterised, so a caller cannot
 * accidentally interpolate an unencoded ref into a path.
 */
export interface RepoApiTarget {
  flavor: GitApiFlavor;
  /** REST root, e.g. `https://api.github.com` or `https://bb.acme/rest/api/1.0`. */
  apiBase: string;
  /** Repo-scoped root — the segment that differs most between the four dialects. */
  repoBase: string;
  /** The pull/merge-request COLLECTION (list + create). */
  pullRequests(): string;
  /** One pull/merge request by its provider-visible number. */
  pullRequest(number: number): string;
  /** The endpoint that returns a file's BYTES at `ref` (see the Server note below). */
  fileContent(path: string, ref: string): string;
  /** The endpoint a single-file write is addressed to. */
  fileWrite(path: string): string;
  /** Branch refs collection (list / create), where the dialect has one. */
  branches(): string;
  /** Combined CI/build state for a commit. */
  buildStatus(sha: string): string;
  /** Bitbucket Server's branch-utils plugin root. Throws on any other dialect. */
  branchUtilsBase(): string;
}

/**
 * Resolve every URL shape for a repo. `allowBitbucketServer` is passed to
 * `buildGitApiBaseUrl` unconditionally BECAUSE this module supplies the Server
 * path shapes — that is exactly the contract the flag was gated on. Callers that
 * genuinely cannot do an operation on Server must refuse on the OPERATION (see
 * `revertMergedPullRequest`), not by pretending the base URL is unknowable.
 */
export function resolveRepoApiTarget(coords: RepoApiCoords): RepoApiTarget {
  const flavor = resolveGitApiFlavor(coords.provider, coords.host);
  const apiBase = buildGitApiBaseUrl(coords.provider, coords.host, { allowBitbucketServer: true });
  const { owner, repo, host } = coords;

  if (flavor === 'gitlab') {
    const repoBase = `${apiBase}/projects/${gitlabProjectId(owner, repo)}`;
    return {
      flavor, apiBase, repoBase,
      pullRequests: () => `${repoBase}/merge_requests`,
      pullRequest: (n) => `${repoBase}/merge_requests/${n}`,
      // GitLab's `/raw` sub-resource returns the bytes; the bare files endpoint
      // returns a base64 envelope. Path is a SINGLE encoded component here.
      fileContent: (path, ref) =>
        `${repoBase}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(ref)}`,
      fileWrite: (path) => `${repoBase}/repository/files/${encodeURIComponent(path)}`,
      branches: () => `${repoBase}/repository/branches`,
      buildStatus: (sha) => `${repoBase}/repository/commits/${encodeURIComponent(sha)}/statuses`,
      branchUtilsBase: () => { throw new Error('branch-utils is a Bitbucket Server API'); },
    };
  }

  if (flavor === 'bitbucket-cloud') {
    const repoBase = `${apiBase}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    return {
      flavor, apiBase, repoBase,
      pullRequests: () => `${repoBase}/pullrequests`,
      pullRequest: (n) => `${repoBase}/pullrequests/${n}`,
      fileContent: (path, ref) => `${repoBase}/src/${encodeURIComponent(ref)}/${encodePathSegments(path)}`,
      // Cloud writes the WHOLE commit through one form-encoded POST to /src — the
      // path travels in the form body, not the URL, so the write URL is path-free.
      fileWrite: () => `${repoBase}/src`,
      branches: () => `${repoBase}/refs/branches`,
      buildStatus: (sha) => `${repoBase}/commit/${encodeURIComponent(sha)}/statuses`,
      branchUtilsBase: () => { throw new Error('branch-utils is a Bitbucket Server API'); },
    };
  }

  if (flavor === 'bitbucket-server') {
    const repoBase = `${apiBase}${bitbucketServerRepoPath(owner, repo)}`;
    return {
      flavor, apiBase, repoBase,
      pullRequests: () => `${repoBase}/pull-requests`,
      pullRequest: (n) => `${repoBase}/pull-requests/${n}`,
      // `/raw` — NOT `/browse`. Both address the same file, but `/browse` returns a
      // PAGINATED JSON envelope of `lines: [{ text }]` with the trailing newline of
      // every line stripped, so reassembling a file from it is lossy at the tail of
      // each page and costs one request per page. `/raw` returns the bytes in one
      // GET. `parseBitbucketServerBrowse` below exists for the (still reachable)
      // reverse-proxy/older-Server case where `/raw` is unavailable.
      fileContent: (path, ref) => `${repoBase}/raw/${encodePathSegments(path)}?at=${encodeURIComponent(ref)}`,
      // Server writes ONE file per request: PUT /browse/{path}, multipart form.
      fileWrite: (path) => `${repoBase}/browse/${encodePathSegments(path)}`,
      branches: () => `${repoBase}/branches`,
      // Build status is NOT on /rest/api/1.0 — it is its own plugin API, keyed by
      // commit rather than by repo, so it is built from the HOST, not from repoBase.
      buildStatus: (sha) => `${buildStatusBase(host)}/commits/${encodeURIComponent(sha)}`,
      branchUtilsBase: () => `${buildBitbucketServerBranchUtilsBase(host)}${bitbucketServerRepoPath(owner, repo)}`,
    };
  }

  // GitHub (github.com and Enterprise Server share these path shapes).
  const repoBase = `${apiBase}/repos/${owner}/${repo}`;
  return {
    flavor, apiBase, repoBase,
    pullRequests: () => `${repoBase}/pulls`,
    pullRequest: (n) => `${repoBase}/pulls/${n}`,
    fileContent: (path, ref) =>
      `${repoBase}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`,
    fileWrite: (path) => `${repoBase}/contents/${encodeURIComponent(path)}`,
    branches: () => `${repoBase}/git/refs/heads`,
    buildStatus: (sha) => `${repoBase}/commits/${encodeURIComponent(sha)}/status`,
    branchUtilsBase: () => { throw new Error('branch-utils is a Bitbucket Server API'); },
  };
}

/** Bitbucket Server's build-status plugin root (`/rest/build-status/1.0`). */
export function buildStatusBase(host: string | null): string {
  const h = (host ?? '').trim();
  if (!h) throw new Error('Bitbucket Server host is required');
  return `https://${h}/rest/build-status/1.0`;
}

// ── Bitbucket Server response normalisation ──────────────────────────────────

/**
 * A page of Bitbucket Server's `/browse` response, normalised.
 *
 * `/browse` is one endpoint serving two shapes, both paginated:
 *   • a FILE  → `{ lines: [{ text }], start, size, isLastPage, nextPageStart }`
 *   • a DIR   → `{ children: { values: [{ path: { toString }, type }], isLastPage … } }`
 * Every other provider returns a file's content as one blob and a directory as one
 * array, so leaking either shape upward would push Server's pagination into five
 * callers. It is normalised here instead, once.
 */
export interface BitbucketServerBrowsePage {
  /** File shape: this page's lines rejoined with '\n'. Null for a directory. */
  text: string | null;
  /** Directory shape: child entries on this page. Empty for a file. */
  children: Array<{ path: string; type: 'file' | 'dir' }>;
  isLastPage: boolean;
  /** Offset to request next, or null when the listing is complete. */
  nextPageStart: number | null;
}

interface BsBrowseBody {
  lines?: Array<{ text?: string }>;
  isLastPage?: boolean;
  nextPageStart?: number | null;
  size?: number;
  start?: number;
  children?: {
    values?: Array<{ path?: { toString?: string; components?: string[]; name?: string }; type?: string }>;
    isLastPage?: boolean;
    nextPageStart?: number | null;
  };
}

/**
 * Normalise one `/browse` page. Tolerant by construction: a malformed/absent body
 * yields an empty LAST page rather than throwing, because every caller is on a
 * "never throw, return a typed refusal" contract.
 *
 * Note on `lines`: Server strips the newline from each entry, so rejoining with
 * '\n' is the faithful reconstruction — and it is why a multi-page file read must
 * concatenate pages WITHOUT inserting a separator between them (this returns the
 * page's own text; the caller joins pages with '\n').
 */
export function parseBitbucketServerBrowse(body: unknown): BitbucketServerBrowsePage {
  const b = (body ?? {}) as BsBrowseBody;

  if (b.children) {
    const children = (b.children.values ?? [])
      .map((v) => {
        const path = bitbucketServerPathString(v.path);
        if (!path) return null;
        // Server's node types are 'FILE' and 'DIRECTORY'; anything else (submodule)
        // is not something the tree walk can descend, so it is dropped.
        const type = (v.type ?? '').toUpperCase() === 'FILE' ? 'file' as const
          : (v.type ?? '').toUpperCase() === 'DIRECTORY' ? 'dir' as const : null;
        return type ? { path, type } : null;
      })
      .filter((c): c is { path: string; type: 'file' | 'dir' } => c !== null);
    const isLastPage = b.children.isLastPage !== false;
    return {
      text: null,
      children,
      isLastPage,
      nextPageStart: isLastPage ? null : b.children.nextPageStart ?? null,
    };
  }

  if (Array.isArray(b.lines)) {
    const isLastPage = b.isLastPage !== false;
    return {
      text: b.lines.map((l) => l.text ?? '').join('\n'),
      children: [],
      isLastPage,
      nextPageStart: isLastPage ? null : b.nextPageStart ?? null,
    };
  }

  return { text: null, children: [], isLastPage: true, nextPageStart: null };
}

/**
 * Read a path out of a Bitbucket Server `path` object.
 *
 * Server serialises a path as `{ components: […], parent, name, extension, toString }`
 * where `toString` is a STRING FIELD, not a method — which is the trap: on any object
 * that lacks it, `path.toString` silently resolves to `Object.prototype.toString` and
 * a truthiness check hands a FUNCTION back as the path. Hence the explicit typeof.
 */
export function bitbucketServerPathString(
  path: { toString?: unknown; components?: unknown; name?: unknown } | null | undefined,
): string {
  if (!path) return '';
  if (typeof path.toString === 'string') return path.toString;
  if (Array.isArray(path.components)) return path.components.filter((c) => typeof c === 'string').join('/');
  return typeof path.name === 'string' ? path.name : '';
}

/**
 * Bitbucket Server PR states are `OPEN` | `MERGED` | `DECLINED`; the product's
 * vocabulary is `open` | `merged` | `closed` (GitHub's). Cloud uses the same three
 * uppercase words, so ONE mapper serves both editions.
 */
export function normalizeBitbucketPrState(state: string | null | undefined): string | null {
  switch ((state ?? '').toUpperCase()) {
    case 'OPEN': return 'open';
    case 'MERGED': return 'merged';
    case 'DECLINED': return 'closed';
    case '': return null;
    default: return state ?? null;
  }
}

/**
 * Collapse a set of Bitbucket build-status states into the product's tri-state.
 * Server's `/rest/build-status/1.0` reports `SUCCESSFUL` | `FAILED` | `INPROGRESS`;
 * Cloud's `/statuses` adds `ERROR` and `STOPPED`. Any failure wins, then anything
 * still running, else success — the same precedence GitHub's combined status uses.
 */
export function collapseBitbucketBuildStates(states: string[]): 'success' | 'failure' | 'pending' | null {
  const up = states.map((s) => (s ?? '').toUpperCase());
  if (up.length === 0) return null;
  if (up.some((s) => s === 'FAILED' || s === 'ERROR')) return 'failure';
  if (up.some((s) => s === 'INPROGRESS' || s === 'PENDING')) return 'pending';
  if (up.some((s) => s === 'SUCCESSFUL')) return 'success';
  return null;
}
