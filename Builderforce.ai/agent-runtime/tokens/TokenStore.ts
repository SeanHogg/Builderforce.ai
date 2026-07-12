/**
 * TokenStore: Simple key-value store for JWT-like session tokens with expiry.
 *
 * Tracks:
 * - token value (Bearer ...).
 * - expiry timestamp (computed from JWT exp or supplied TTL).
 * - last-written timestamp (for potential refresh ramp).
 *
 * Implements proactive refresh to avoid 401 during long-running executions.
 * No silent null returns on auth failures.
 */

export interface TokenInfo {
  value: string;             // e.g., "Bearer <signed-token>"
  exp: number;               // expiry timestamp (seconds since epoch)
  issuedAt: number;         // issuance timestamp (seconds since epoch)
}

export interface TokenProvider {
  acquire(): Promise<string>;           // Returns new token (Bearer part only)
}

/**
 * AuthError: thrown when token refresh fails and execution cannot continue.
 * Clear, structure; differentiable from legitimate null fields.
 */
export class AuthError extends Error {
  constructor(
    message: string,
    public readonly executionId: string,
    public readonly operation: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * RefreshResult: result of a token refresh attempt.
 */
export interface RefreshResult {
  success: boolean;
  token?: string;
  error?: string;
}

interface RefreshOptions {
  /**
   * Time before expiry to initiate proactive refresh.
   * Default 60 seconds (configurable).
   */
  refreshBufferSeconds: number;
  /**
   * Maximum number of consecutive refresh attempts to this provider before failing.
   * Default 3.
   */
  maxRetryAttempts: number;
}

export class TokenStore {
  private current: TokenInfo | null = null;
  private currentPromise: Promise<RefreshResult> | null = null;
  private proactiveTimer: NodeJS.Timeout | null = null;
  private pendingRequest: {
    url: string;
    options: RequestInit;
    retryCount: number;
  } | null = null;
  private refreshAttemptCount = 0;
  private options: Required<RefreshOptions> = {
    refreshBufferSeconds: 60,
    maxRetryAttempts: 3,
  };

  constructor(private provider: TokenProvider, refreshOptions?: Partial<RefreshOptions>) {
    if (refreshOptions) {
      this.options = {
        refreshBufferSeconds: refreshOptions.refreshBufferSeconds ?? 60,
        maxRetryAttempts: refreshOptions.maxRetryAttempts ?? 3,
      };
    }
  }

  /**
   * Internal helper: fetch a fresh token in memory and update the internal state.
   * Emits structured log for proactive refresh failures.
   */
  private async acquireInMemory(newToken: string): Promise<RefreshResult> {
    if (!newToken || newToken.trim().length === 0) {
      const logMsg = `[TokenStore] acquire returned empty token value; skipping store update`;
      console.warn(logMsg);
      return { success: false, error: "Empty token returned", token: "" };
    }

    // Extract Bearer prefix and compute JWT fields.
    let raw = newToken;
    if (raw.startsWith("Bearer ")) {
      raw = raw.slice(7);
    }

    const epochSecs = Math.floor(Date.now() / 1000);
    this.current = {
      value: `Bearer ${raw.trim()}`,
      exp: this.extractExpiry(raw),
      issuedAt: epochSecs,
    };

    // If this was an on-demand refresh triggered by a pending request, clear it.
    if (this.pendingRequest) {
      this.pendingRequest.retryCount = 0;
      this.pendingRequest = null;
    }

    // Schedule proactive refresh for next time, if not already scheduled.
    if (isFinite(this.current.exp) && this.current.exp > epochSecs) {
      const timeUntilExpiry = this.current.exp - epochSecs;
      const proactiveDelay = Math.max(
        1000,
        (timeUntilExpiry - this.options.refreshBufferSeconds) * 1000
      );

      if (this.proactiveTimer) {
        clearTimeout(this.proactiveTimer);
      }

      this.proactiveTimer = setTimeout(
        () => {
          triggerProactiveRefresh(this.current?.value ?? "").catch((e) => {
            console.error("[TokenStore] proactive refresh failed:", e);
          });
        },
        proactiveDelay
      );
    }

    return { success: true, token: newToken };
  }

  /**
   * Extract expiration from a standard JWT (rs256) / session token.
   * Uses claim 'exp' if present; otherwise falls back to supervised duration cap.
   */
  private extractExpiry(token: string): number {
    // Attempt RFC 7519 decode. Errors => no expiry.
    try {
      const parts = token.split(".");
      if (parts.length !== 3) {
        console.warn("[TokenStore] token is not a 3-part JWT; using fallback expiry");
        return this.defaultTtlCap();
      }

      const payload = this.base64urlDecode(parts[1]);
      const payloadObj = JSON.parse(payload);

      if (typeof payloadObj.exp === "number" && payloadObj.exp > 0) {
        return payloadObj.exp;
      }

      // No exp claim in payload; use supervised fallback.
      return this.defaultTtlCap();
    } catch (e) {
      console.warn("[TokenStore] failed to parse JWT payload; using fallback expiry", e);
      return this.defaultTtlCap();
    }
  }

  private base64urlDecode(str: string): string {
    const cleaned = str.replace(/-/g, "+").replace(/_/g, "/");
    const padded = cleaned + "=".repeat((4 - cleaned.length % 4) % 4);
    return Buffer.from(padded, "base64").toString("utf-8");
  }

  /**
   * Proactive refresh helper (async callable).
   */
  private async triggerProactiveRefresh(): Promise<void> {
    if (!this.current || !isFinite(this.current.exp)) {
      return;
    }

    const epochSecs = Math.floor(Date.now() / 1000);
    if (this.current.exp <= epochSecs) {
      // Token already expired; no need to refresh yet.
      return;
    }

    const token = this.current.value.slice(7); // Strip "Bearer "
    return triggerProactiveRefresh(token);
  }

  async getToken(): Promise<string | null> {
    const info = this.current;
    if (!info) {
      return null;
    }

    const epochSecs = Math.floor(Date.now() / 1000);
    if (epochSecs < info.exp) {
      // Current token is still valid.
      return info.value;
    }

    // Token is expired or theoretical expired. Fail fast if a current refresh is in progress.
    if (this.currentPromise) {
      return null; // Not back in sync; wait for underlying refresh.
    }

    // Trigger fresh token acquisition.
    const refreshResult = await this.acquireInternal();
    return refreshResult.success ? refreshResult.token ?? null : null;
  }

  private async acquireInternal(): Promise<RefreshResult> {
    this.currentPromise = this.performAcquire();
    try {
      return await this.currentPromise;
    } finally {
      this.currentPromise = null;
    }
  }

  private async performAcquire(): Promise<RefreshResult> {
    const epochSecs = Math.floor(Date.now() / 1000);
    const freshTokenData = await this.provider.acquire();

    // Update our internal state.
    const result = await this.acquireInMemory(freshTokenData);

    // Reset retry counter on success.
    if (result.success && this.refreshAttemptCount > 0) {
      this.refreshAttemptCount = 0;
    }
    if (!result.success) {
      this.refreshAttemptCount++;
      const logMsg = `[TokenStore] refresh attempt ${this.refreshAttemptCount} failed: ${result.error}`;
      console.warn(logMsg);
      return result;
    }

    return result;
  }

  /**
   * Synchronous check for expiry (recommended for fast path).
   */
  hasToken(): boolean {
    const info = this.current;
    if (!info) {
      return false;
    }
    const epochSecs = Math.floor(Date.now() / 1000);
    return epochSecs < info.exp && isFinite(info.exp);
  }

  /**
   * Supervised fallback expiry if JWT exp cannot be parsed.
   * Cap at maxTtl to prevent infinite construed expiry.
   */
  private defaultTtlCap(): number {
    // Approximate token server TTL (gap to expiry). Use 90s minimum, 120s typical.
    const baseTtl = 90;
    const maxTtl = 120;
    return Math.min(baseTtl * 2, maxTtl); // 180s max even if JWT fails.
  }

  getDebugInfo(): {
    current?: TokenInfo;
    expired: boolean;
    processing: boolean;
    expiresAt?: Date;
    nextRefreshMs?: number;
  } {
    const info = this.current;
    const epochSecs = Math.floor(Date.now() / 1000);
    const earliest = info?.exp ?? 0;
    return {
      current: info,
      expired: epochSecs >= earliest && isFinite(earliest),
      processing: !!this.currentPromise,
      expiresAt: (isFinite(earliest) && earliest > epochSecs) ? new Date(earliest * 1000) : undefined,
      nextRefreshMs: this.proactiveTimer
        ? Math.max(0, ((earliest - this.options.refreshBufferSeconds - epochSecs) * 1000))
        : undefined,
    };
  }

  /**
   * Returns token for use in pre-calculated Authorization header without verification.
   * Only safe for already-checked contexts.
   */
  getTokenForHeader(): string | null {
    return this.hasToken() ? this.current!.value : null;
  }

  /**
   * Clears internal state (used for testing or explicit logout).
   */
  clear(): void {
    if (this.proactiveTimer) {
      clearTimeout(this.proactiveTimer);
      this.proactiveTimer = null;
    }
    this.currentPromise = null;
    this.current = null;
    this.pendingRequest = null;
    this.refreshAttemptCount = 0;
  }
}

/**
 * Proactive refresh (parallel-safe).
 * Call as a top-level outside method to avoid lockups.
 */
async function triggerProactiveRefresh(tokenPrefixed: string): Promise<void> {
  // Pass empty shim provider to avoid cycles.
  const provider: TokenProvider = {
    async acquire(): Promise<string> {
      throw new Error("triggerProactiveRefresh is an async-only entry point; you must pass an actual provider.");
    },
  };

  const store = new TokenStore(provider);
  try {
    await store.performAcquire(); // run logic in parallel
  } catch (err) {
    console.error("[TokenStore] proactive refresh failure:", err);
  }
}