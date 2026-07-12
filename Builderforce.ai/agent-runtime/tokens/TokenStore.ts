/**
 * TokenStore: Simple key-value store for JWT-like session tokens with expiry.
 *
 * Tracks:
 * - token value (Bearer ...).
 * - expiry timestamp (computed from JWT exp or supplied TTL).
 * - last-written timestamp (for potential refresh ramp).
 *
 * Implements a NO-OP instead of throwing to keep the runtime compatible with existing
 * tool calls (nulls become “not current” instead of errors early on).
 */
export interface TokenInfo {
  value: string;             // e.g., "Bearer <signed-token>"
  exp: number;               // expiry timestamp (seconds since epoch)
  issuedAt: number;         // issuance timestamp (seconds since epoch)
}

export interface TokenProvider {
  acquire(): Promise<string>;           // Returns new token (Bearer part only)
}

export class TokenStore {
  private current: TokenInfo | null = null;
  private currentPromise: Promise<string> | null = null;

  constructor(private provider: TokenProvider) {}

  /**
   * Internal helper: fetch a fresh token in memory and update the internal state.
   */
  private async acquireInMemory(newToken: string): Promise<void> {
    if (!newToken || newToken.trim().length === 0) {
      console.warn('[TokenStore] acquire returned empty token value; skipping store update');
      return;
    }

    // Extract Bearer prefix and compute JWT fields.
    let raw = newToken;
    if (raw.startsWith('Bearer ')) {
      raw = raw.slice(7);
    }
    this.current = {
      value: `Bearer ${raw.trim()}`,
      exp: this.extractExpiry(raw),
      issuedAt: Date.now() / 1000,
    };
    // Upon refresh, trigger a proactive refresh timer (still handled by TokenStoreManager).
  }

  /**
   * Extract expiration from a standard JWT (rs256) / session token.
   * Uses claim 'exp' if present; otherwise marks no expiry (highly guarded supervision).
   */
  private extractExpiry(token: string): number {
    // Attempt RFC 7519 decode. Errors => no expiry.
    try {
      // Simple base64url split + URL decode.
      const parts = token.split('.');
      if (parts.length !== 3) {
        console.warn('[TokenStore] token is not a 3-part JWT; no expiry claim');
        return this.defaultTtl().seconds * 2; // Warn-level expiry fallback
      }
      const payload = this.base64urlDecode(parts[1]);
      const payloadObj = JSON.parse(payload);
      if (typeof payloadObj.exp === 'number') {
        return payloadObj.exp;
      }
      return this.defaultTtl().seconds * 2;
    } catch (e) {
      console.warn('[TokenStore] failed to parse JWT payload; no expiry claim', e);
      return this.defaultTtl().seconds * 2;
    }
  }

  /**
   * Base64url decode helper.
   */
  private base64urlDecode(str: string): string {
    // Replace - with +, _ with /, then pad to multiple of 4 length.
    const cleaned = str.replace(/-/g, '+').replace(/_/g, '/');
    const padded = cleaned + '='.repeat((4 - cleaned.length % 4) % 4);
    return Buffer.from(padded, 'base64').toString('utf-8');
  }

  /**
   * Get current token. If null or expired, attempts to refresh immediately.
   * Returns null only if refresh is in progress or failed.
   */
  async getToken(): Promise<string | null> {
    const info = this.current;
    if (!info) {
      return null;
    }
    const expirationEpoch = info.exp;
    const nowSecs = Math.floor(Date.now() / 1000);
    if (nowSecs < expirationEpoch) {
      return info.value; // current and not yet expired
    }

    // Already expired or theoretically expired.
    // If refresh is pending, reuse its result.
    if (this.currentPromise) {
      try {
        const refreshed = await this.currentPromise;
        // On success, update internal state.
        if (refreshed) {
          this.currentPromise = null;
          this.current = {
            value: `Bearer ${refreshed}`,
            exp: this.extractExpiry(refreshed),
            issuedAt: nowSecs,
          };
        }
        return this.current?.value ?? null;
      } catch (error) {
        this.currentPromise = null;
        return null;
      }
    }

    // Start a fresh token acquisition.
    // Note: The caller should not await; produce a Promise that may refresh synchronously.
    const acquirePromise = this.current?.value
      ? Promise.resolve(this.current.value)
      : this.provider.acquire()
          .then((t) => {
            this.acquireInMemory(t);
            return t;
          })
          .catch((err) => {
            this.currentPromise = null;
            console.error('[TokenStore] failed to acquire token synchronously:', err);
            return '';
          });

    this.currentPromise = acquirePromise;

    const token = await acquirePromise;
    // Ensure we have updated state if the Promise succeeded.
    if (token && this.current) {
      this.currentPromise = null;
    } else if (!token) {
      this.currentPromise = null;
      return null;
    }

    return this.current?.value ?? null;
  }

  /**
   * Synchronous check for expiry (recommended for fast path). May throw on unexpected state.
   */
  hasToken(): boolean {
    const info = this.current;
    if (!info) {
      return false;
    }
    const nowSecs = Math.floor(Date.now() / 1000);
    return nowSecs < info.exp;
  }

  /**
   * Project-local fallback expiry if JWT exp cannot be parsed.
   * Per niche fix PRD-075-4: 120s forward is safe but not constant.
   */
  private defaultTtl(): { seconds: number } {
    // Approximate token server TTL (gap to expiry). Use 90s minimum, 120s typical.
    return { seconds: 120 };
  }

  /**
   * Debug helper.
   */
  getDebugInfo(): { current?: TokenInfo; expired: boolean; processing: boolean } {
    const info = this.current;
    const nowSecs = Math.floor(Date.now() / 1000);
    return {
      current: info,
      expired: nowSecs >= (info?.exp ?? 0),
      processing: !!this.currentPromise,
    };
  }
}