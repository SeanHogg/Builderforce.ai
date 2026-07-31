/**
 * RepoSource — a minimal, provider-agnostic read interface over a hosted Git
 * repository, used by the Architect / Digital-Transformation analysis pipeline
 * to fetch the evidence the LLM reasons over (file tree, selected file
 * contents, languages, recent commits). Everything runs server-side in the
 * Worker via the provider's REST API — no clone, no installed agent.
 *
 * Leaf types/helpers live in ./repoSourceBase (imported by the concrete clients
 * too) so this barrel can depend on the clients for its factory without forming
 * a cycle. In production the DO passes `makeRepoFetch()`, which wraps the global
 * fetch in the shared vendor timeout + Cloudflare subrequest-cap detection so a
 * repo that blows the per-invocation budget surfaces the typed
 * WorkerSubrequestExhaustedError the DO knows how to back off on.
 */
import { fetchWithVendorTimeout } from '../../llm/vendors/types';
import { GitHubRepoSource } from './GitHubRepoSource';
import { GitLabRepoSource } from './GitLabRepoSource';
import { BitbucketRepoSource } from './BitbucketRepoSource';
import type { FetchLike, RepoSource, RepoSourceConfig, RepoTreeEntry } from './repoSourceBase';
import { estimateTokensFromChars } from '../../llm/tokenUsage';

export type {
  FetchLike,
  RepoProvider,
  RepoSource,
  RepoSourceConfig,
  RepoTreeEntry,
  RepoCommit,
} from './repoSourceBase';
export { RepoSourceError, decodeBase64Utf8 } from './repoSourceBase';

/**
 * Worker-safe fetch for repo API calls: shared 15s per-call timeout +
 * Cloudflare subrequest-cap detection (the wrapper re-throws
 * WorkerSubrequestExhaustedError, which the DO catches to back off instead of
 * burning the rest of its budget).
 */
export function makeRepoFetch(timeoutMs = 15_000): FetchLike {
  return (input, init) => fetchWithVendorTimeout('repo', 'fetch', input, init ?? {}, timeoutMs);
}

export function createRepoSource(
  provider: string,
  cfg: RepoSourceConfig,
  fetchFn: FetchLike,
): RepoSource {
  switch (provider) {
    case 'github':
      return new GitHubRepoSource(cfg, fetchFn);
    case 'gitlab':
      return new GitLabRepoSource(cfg, fetchFn);
    case 'bitbucket':
      return new BitbucketRepoSource(cfg, fetchFn);
    default:
      throw new Error(`Unsupported repo provider: ${provider}`);
  }
}

// ---------------------------------------------------------------------------
// Evidence selection — pick the most informative files within a token budget.
// ---------------------------------------------------------------------------

/** Directories never worth sampling (vendored / generated / build output). */
const EXCLUDED_DIR = /(^|\/)(node_modules|dist|build|out|coverage|vendor|\.git|\.next|\.nuxt|\.cache|__pycache__|\.venv|target|bin|obj)(\/|$)/i;

/** Binary / non-source extensions we never send to the LLM. */
const BINARY_EXT = /\.(png|jpe?g|gif|webp|svg|ico|bmp|tiff?|pdf|zip|gz|tar|7z|rar|jar|war|class|exe|dll|so|dylib|bin|wasm|woff2?|ttf|eot|otf|mp[34]|mov|avi|mkv|wav|ogg|flac|lock|min\.js|min\.css|map)$/i;

/** Secret-bearing filenames — defense-in-depth even though repos shouldn't track these. */
const SECRET_PATH = /(^|\/)(\.env(\..*)?|.*\.pem|.*\.key|id_rsa|id_ed25519|.*\.p12|.*\.pfx|.*\.keystore|secrets?\.(ya?ml|json))$/i;

/** Dependency / build manifests — always high-signal for "what is this". */
const MANIFEST = /(^|\/)(package\.json|tsconfig(\..*)?\.json|requirements\.txt|pyproject\.toml|setup\.py|go\.mod|pom\.xml|build\.gradle(\.kts)?|Cargo\.toml|Gemfile|composer\.json|.*\.csproj|Dockerfile|docker-compose.*\.ya?ml|.*\.tf|wrangler\.toml|serverless\.ya?ml|nx\.json|pnpm-workspace\.yaml|turbo\.json|README(\..*)?|readme(\..*)?)$/i;

/** Framework / app entrypoints — reveal architecture quickly. */
const ENTRYPOINT = /(^|\/)(src\/)?(index|main|app|server|bootstrap|cli)\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs)$/i;
const FRAMEWORK_CONFIG = /(^|\/)(next\.config\.[mc]?[jt]s|vite\.config\.[mc]?[jt]s|nuxt\.config\.[mc]?[jt]s|angular\.json|svelte\.config\.[mc]?[jt]s|astro\.config\.[mc]?[jt]s|remix\.config\.[mc]?[jt]s|webpack\.config\.[mc]?[jt]s)$/i;

export function isExcludedPath(path: string): boolean {
  return EXCLUDED_DIR.test(path);
}
export function isBinaryPath(path: string): boolean {
  return BINARY_EXT.test(path);
}
export function isSecretPath(path: string): boolean {
  return SECRET_PATH.test(path);
}

/** Rough token estimate for a byte count (~4 bytes/token). Delegates to the ONE
 *  chars/4 heuristic (bytes ≈ chars for the ASCII-dominant source it samples). */
export function estimateTokens(bytes: number): number {
  return estimateTokensFromChars(bytes);
}

export interface SelectEvidenceOptions {
  /** Max number of files to sample (N=8 free / 25 paid). */
  maxFiles: number;
  /** Max total estimated tokens across sampled files. */
  maxTokens: number;
}

export interface SelectedFile {
  path: string;
  /** Tree-reported size, or 0 when unknown. */
  bytes: number;
  priority: number;
}

/**
 * Choose which files to fetch, in priority order, until the file/token budget
 * is hit: manifests & READMEs → entrypoints / framework config → largest
 * remaining source modules. Excludes vendored/generated/binary/secret paths.
 * Pure + deterministic so it is unit-testable from a canned tree.
 */
export function selectEvidence(
  entries: RepoTreeEntry[],
  opts: SelectEvidenceOptions,
): SelectedFile[] {
  const files = entries.filter(
    (e) =>
      e.type === 'file' &&
      !isExcludedPath(e.path) &&
      !isBinaryPath(e.path) &&
      !isSecretPath(e.path),
  );

  const scored: SelectedFile[] = files.map((e) => {
    const bytes = e.bytes ?? 0;
    let priority: number;
    if (MANIFEST.test(e.path)) priority = 3;
    else if (ENTRYPOINT.test(e.path) || FRAMEWORK_CONFIG.test(e.path)) priority = 2;
    else priority = 1;
    return { path: e.path, bytes, priority };
  });

  // Higher priority first; within a tier, larger files first (more central),
  // then a stable lexical tiebreak so output is deterministic.
  scored.sort((a, b) => b.priority - a.priority || b.bytes - a.bytes || a.path.localeCompare(b.path));

  const picked: SelectedFile[] = [];
  let tokens = 0;
  for (const f of scored) {
    if (picked.length >= opts.maxFiles) break;
    const cost = estimateTokens(Math.max(f.bytes, 256)); // floor so unknown-size files still count
    if (tokens + cost > opts.maxTokens && picked.length > 0) continue;
    picked.push(f);
    tokens += cost;
  }
  return picked;
}
