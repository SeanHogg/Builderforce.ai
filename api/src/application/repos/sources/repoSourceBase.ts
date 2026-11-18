/**
 * Leaf types + helpers shared by RepoSource and the concrete provider clients.
 * This module imports nothing but the pure byte helpers so the clients can depend on it without creating
 * a cycle back through the RepoSource barrel (which imports the clients for its
 * factory). Keeping it dependency-free is what stops vitest's module transform
 * from looping during collection.
 */
import { base64ToBytes } from '../../../domain/shared/bytes';

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
  /** Bitbucket Server: at most this many `/browse` pages per file read (default: the tree page limit). */
  maxBrowsePages?: number;
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

/**
 * Why a read stops short of the whole file: `size` — the file is past a read cap;
 * `incomplete` — the provider stopped answering mid-read (a page cap, a refused or
 * rate-limited page). The two call for different answers (rewrite vs retry).
 */
export type TruncationReason = 'size' | 'incomplete';

/** A file read: its content, and whether (and why) that content stops short of the whole file. */
export interface RepoFileRead {
  content: string;
  truncated: boolean;
  /** Set when `truncated`. */
  truncatedReason?: TruncationReason;
}

/**
 * A read held to `cap` characters: past it, cut and truncated for `size`; a read the
 * source already cut keeps its own reason. The ONE place a read cap is applied.
 */
export function capContent(read: RepoFileRead, cap: number): RepoFileRead {
  if (read.content.length > cap) return { content: read.content.slice(0, cap), truncated: true, truncatedReason: read.truncatedReason ?? 'size' };
  return read.truncated ? { ...read, truncatedReason: read.truncatedReason ?? 'incomplete' } : { content: read.content, truncated: false };
}

/** A source's file read with its truncation, whether or not the source pages its reads. */
export async function readSourceFile(source: RepoSource, path: string, ref: string): Promise<RepoFileRead | null> {
  if (source.readFile) return source.readFile(path, ref);
  const content = await source.getFileContent(path, ref);
  return content == null ? null : { content, truncated: false };
}

export interface RepoSource {
  getDefaultBranch(): Promise<string>;
  /** { language: bytes } — empty object when the provider has no languages API. */
  getLanguages(): Promise<Record<string, number>>;
  /** Recursive, flattened tree at `ref`. May be truncated by the provider. */
  getTree(ref: string): Promise<{ entries: RepoTreeEntry[]; truncated: boolean }>;
  /** File content at `ref`, or null when binary / too large / missing. */
  getFileContent(path: string, ref: string): Promise<string | null>;
  /**
   * `getFileContent` plus whether the content is incomplete (a paged read that stopped
   * early). Sources whose reads are never paged need not implement it.
   */
  readFile?(path: string, ref: string): Promise<RepoFileRead | null>;
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
  return new TextDecoder().decode(base64ToBytes(b64));
}
