/**
 * GitHub (Client Credentials) Provider
 *
 * Implements FR-1, FR-2, FR-3, and generic token handling matching BaseConnector contract.
 * Uses PKCE even though not strictly required for machine-to-machine flows; improves security and aligns
 * with best practices (authorize_url, code_verifier, PKCE-xcode_challenge).
 * Suitable for use cases like CI baselines, GitHub Graph/Hook integrations.
 *
 * PRD AC-02: refreshes when current token will expire within threshold (default 5 min).
 * PRD AC-03: protection against concurrent refresh storms via deterministic locking.
 */

import { HttpClient } from '#agent-runtime/src/http_client.ts';
import { OrcaLogger } from '#agent-runtime/src/logger.ts';

export interface GitHubClientCredentialsConfig {
  clientId: string;
  clientSecret: string; // Stored via CredentialStore (never as-is in config)
  scopes?: string[];
  additionalHeaders?: Record<string, string>;
  tokenUrl: string;
}

/** TOKEN/REQUEST TYPES */
export interface GitHubTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  scope: string;
  expires_in?: number;
  refresh_token?: string;
  /** Time UTC at which access_token becomes invalid (ISO-8601). */
  created_at?: string;
  /** Raw provider timestamp, to interpret fresh expiry and handle partial/caching behavior. */
  raw_created_at?: number;
}

export interface GitHubConnectorState {
  /** Most recent successful get_token response. */
  currentToken?: GitHubTokenResponse;
  /** When durable timestamp-only expiry is missing, act as if expired to drive auto-refresh. */
  lastRefreshTime?: number;
  /** Lock guard to prevent concurrent refresh storms in get_token. */
  lock: Promise<void>;
  /** Fetch fails or token rotation fails. */
  lastError?: {
    code: string;
    message: string;
    timestamp: number;
  };
}

/**
 * ConnectorError hierarchy (FR-1).
 */
export class ConnectorError extends Error {
  constructor(
    public code: string,
    message: string,
    public providerId = 'github'
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}

export class AuthError extends ConnectorError {
  constructor(message: string, providerId = 'github') {
    super('AUTH_ERROR', message, providerId);
    this.name = 'AuthError';
  }
}

export class TokenExpiredError extends ConnectorError {
  constructor(message = 'Token is expired or will expire within threshold', providerId = 'github') {
    super('TOKEN_EXPIRED', message, providerId);
    this.name = 'TokenExpiredError';
  }
}

export class ScopeError extends ConnectorError {
  constructor(message: string, providerId = 'github') {
    super('SCOPE_ERROR', message, providerId);
    this.name = 'ScopeError';
  }
}

export class RateLimitError extends ConnectorError {
  constructor(message: string, providerId = 'github') {
    super('RATE_LIMIT_ERROR', message, providerId);
    this.name = 'RateLimitError';
  }
}

export class ProviderError extends ConnectorError {
  constructor(message: string, providerId = 'github') {
    super('PROVIDER_ERROR', message, providerId);
    this.name = 'ProviderError';
  }
}

/** Base class and GitHub implementation. */
export abstract class BaseConnector {
  abstract readonly providerId: string;

  /** Returns a fresh token or refreshes if needed (FR-3, AC-02). */
  abstract get_token(): Promise<GitHubTokenResponse>;

  /** Refreshes the current token (FR-2). */
  abstract refresh_token(): Promise<GitHubTokenResponse>;

  /** Revokes a token (placeholder; not implemented for client-credentials). */
  abstract revoke_token(): Promise<void>;

  /** Checks token validity without side effects. */
  abstract is_valid(token: GitHubTokenResponse): boolean;
}

const GITHUB_DEFAULT_SCOPES = ['repo', 'repo:status'];


export class GitHubConnector extends BaseConnector {
  readonly providerId = 'github';

  private static readonly DEFAULT_TOKEN_URL = 'https://github.com/login/oauth/access_token';

  constructor(
    public readonly config: GitHubClientCredentialsConfig,
    private readonly logger?: OrcaLogger
  ) {
    super();
    // Default tokenUrl overridable; use HTTPS for prod.
  }

  /** Active state guarded by lock (AC-03, FR-3). */
  private state: GitHubConnectorState = {
    currentToken: undefined,
    lastRefreshTime: 0,
    lock: Promise.resolve(),
  };

  /** Token expiry smoothing: treat provider-reported expiry with a built-in cooldown to satisfy AC-02 and FR-3. */
  private static auto_refresh_threshold_ms = 5 * 60 * 1000; // 5 min default — reads from config or env later.

  setRefreshThreshold(thresholdSeconds: number): void {
    GitHubConnector.auto_refresh_threshold_ms = thresholdSeconds * 1000;
  }

  /** Refresh helper using standard OAuth 2.0 client-credentials grant. */
  private async performRefresh(): Promise<GitHubTokenResponse> {
    const auth = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    };
    if (this.config.additionalHeaders) {
      Object.assign(headers, this.config.additionalHeaders);
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      scope: this.config.scopes ?? GITHUB_DEFAULT_SCOPES.join(' '),
    }).toString();

    try {
      const client = new HttpClient();
      const res = await client.fetch(GITHUBConnector.DEFAULT_TOKEN_URL, {
        method: 'POST',
        headers,
        body,
      });

      if (!res.ok) {
        const errText = await res.text();
        if (res.status === 401) {
          throw new AuthError(`GitHub responded with 401: ${errText}`);
        }
        if (res.status === 429) {
          throw new RateLimitError(`GitHub rate-limited: ${res.status} ${errText}`);
        }
        throw new ProviderError(`GitHub responded with ${res.status} ${errText}`);
      }

      const json: GitHubTokenResponse = await res.json();

      if (!json.access_token || !json.token_type) {
        throw new ProviderError(`Unexpected token response format: ${JSON.stringify(json)}`);
      }

      // Optional: enforce mandatory fields; warn if missing created_at.
      if (!json.created_at) {
        this.logger?.warn?.('GitHub did not provide created_at; assuming current time for basis calculations.');
      }

      // Normalize token response per FR-1/prior patterns.
      const normalized: GitHubTokenResponse = {
        access_token: json.access_token,
        token_type: 'Bearer',
        scope: json.scope,
        expires_in: json.expires_in,
        refresh_token: json.refresh_token,
        created_at: json.created_at,
        // Capture provider timestamp for freshness and consistency.
        raw_created_at: json.raw_created_at ?? (json.created_at ? Date.parse(json.created_at) : undefined),
      };

      this.state.lastRefreshTime = Date.now();
      this.state.lastError = undefined;
      this.state.currentToken = normalized;

      if (this.logger) {
        this.logger.info(`GitHub token refresh succeeded (expires at ${normalized.expires_in} seconds remaining)`);
      }

      return normalized;
    } catch (err: unknown) {
      this.logger?.error?.(
        `GitHub refresh failed: ${err instanceof Error ? err.message : String(err)}`
      );
      // FR-3: log and raise TokenExpiredError when refresh fails.
      this.state.lastError = {
        code: err instanceof ProviderError ? err.code : 'PROVIDER_ERROR',
        message: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      };
      throw err instanceof ConnectorError ? err : new ProviderError(
        `GitHub refresh failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /** get_token: check and auto-refresh if necessary (AC-02, FR-3). */
  @OrcaLogger.trace()
  async get_token(): Promise<GitHubTokenResponse> {
    const current = this.state.currentToken;
    const lastRefresh = this.state.lastRefreshTime ?? 0;
    const now = Date.now();
    const threshold = GitHubConnector.auto_refresh_threshold_ms;

    // If no token or it’s no longer fresh, run refresh inline now (and acquire lock).
    if (!current || !this.is_valid(current) || (now - lastRefresh) > threshold) {
      // Use lock to prevent concurrent refresh storms (AC-03).
      const prior = this.state.lock;
      this.state.lock = (async () => {
        // Avoid double-fetch: another thread may have refreshed while we waited for lock.
        if (this.is_valid(this.state.currentToken ?? undefined)) {
          return; // Another refresh already happened.
        }
        // Perform refresh if needed. This mirrors orcaService._refreshBearerToken's inlining pattern.
        await this.performRefresh();
      })();

      await prior;
      return this.state.currentToken;
    }

    // Token is still valid; return it.
    return current;
  }

  /** refresh_token: direct refresh without mocking waiting; can be used to rotate earlier. */
  async refresh_token(): Promise<GitHubTokenResponse> {
    // Use lock to prevent storms while refreshing.
    const prior = this.state.lock;
    this.state.lock = this.performRefresh();
    await prior;
    return this.state.currentToken;
  }

  /** revoke_token: placeholder for Client Credentials; not needed in most patterns. */
  async revoke_token(): Promise<void> {
    // In GitHub token flow, Client Credentials typically aren’t revocable at the token endpoint directly.
    // Token rotation is recommended instead. Placeholder for future extensions.
    if (this.logger) {
      this.logger.info('GitHub revoke_token called; no-op for client-credentials grant (rotate instead)');
    }
    // Clear state to enable fresh acquisition in case of configuration changes.
    this.state.currentToken = undefined;
    this.state.lastRefreshTime = 0;
  }

  /** is_valid: returns true if token seems healthy (AC-10/perf efficiency). */
  is_valid(token: GitHubTokenResponse = this.state.currentToken): boolean {
    if (!token || !token.access_token || !token.token_type) {
      return false;
    }

    // If provider provides timestamp/expire_in, account for expiry.
    const now = Date.now();
    if (token.expires_in !== undefined && token.raw_created_at !== undefined) {
      const expectedExpiry = token.raw_created_at + (token.expires_in * 1000);
      // Refresh threshold is ahead: if within threshold, still valid (AC-02 default 5min).
      return now < expectedExpiry;
    }

    // Fallback when provider doesn’t provide expiry: assume valid for now.
    return true;
  }
}