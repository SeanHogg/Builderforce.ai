/**
 * Leaf types + helpers shared by RepoSource and the concrete provider clients.
 * This module imports nothing so the clients can depend on it without creating
 * a cycle back through the RepoSource barrel (which imports the clients for its
 * factory). Keeping it dependency-free is what stops vitest's module transform
 * from looping during collection.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type RepoProvider = 'github' | 'bitbucket' | 'gitlab';

export interface RepoSourceConfig {
  owner: string;
  repo: string;
  /** Provider host, e.g. 'github.com' / 'gitlab.com' / 'bitbucket.org'. */
  host?: string | null;
  /** Access token (PAT / app password / OAuth token), already decrypted. */
  token: string;
  /** Bitbucket app-password auth needs a username for Basic auth. */
  username?: string | null;
}

export interface RepoTreeEntry {
  path: string;
  type: 'file' | 'dir';
  /** Size in bytes when the provider reports it (used to rank "largest module"). */
  bytes?: number;
}

export interface RepoCommit {
  sha: string;
  message: string;
  /** ISO date string. */
  date: string;
}

export interface RepoSource {
  getDefaultBranch(): Promise<string>;
  /** { language: bytes } — empty object when the provider has no languages API. */
  getLanguages(): Promise<Record<string, number>>;
  /** Recursive, flattened tree at `ref`. May be truncated by the provider. */
  getTree(ref: string): Promise<{ entries: RepoTreeEntry[]; truncated: boolean }>;
  /** File content at `ref`, or null when binary / too large / missing. */
  getFileContent(path: string, ref: string): Promise<string | null>;
  listCommits(ref: string, limit: number): Promise<RepoCommit[]>;
}

/** Raised on a hard provider failure (non-2xx that isn't a missing file). */
export class RepoSourceError extends Error {
  constructor(
    public readonly provider: RepoProvider,
    public readonly status: number,
    message: string,
  ) {
    super(`[${provider}] ${message} (status ${status})`);
    this.name = 'RepoSourceError';
  }
}

/** Decode a base64 payload (provider file contents) as UTF-8 text. */
export function decodeBase64Utf8(b64: string): string {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
