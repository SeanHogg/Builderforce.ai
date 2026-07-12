/**
 * AuthedHttpClient: Transparent 401-retry wrapper for authenticated HTTP requests.
 *
 * Wraps outbound requests with:
 * - Token acquisition from TokenStore (auto-refresh on expiry)
 * - Automatic single retry on 401 with fresh token
 * - Clear AuthError for double failures instead of silent null degradation
 */

import type { TokenStore as TokenStoreType } from "./TokenStore.js";

export interface RequestOptions extends RequestInit {
  token?: string; // Optional manual token (overrides store)
  path?: string;
  url?: string;
  fetch?: (input: RequestInit & { url?: string; path?: string }) => Promise<Response>;
  autoIncludeBearer?: boolean;
}

/**
 * AuthedHttpClient options.
 */
export interface ClientOptions {
  executionId: string;
  tokenStore: TokenStoreType;
  baseUrl?: string;
  autoIncludeBearer?: boolean;
  fetchImpl?: (req: RequestInit & { url?: string; path?: string }) => Promise<Response>;
}

export class AuthError extends Error {
  public name = "AuthError";
  constructor(
    message: string,
    public readonly executionId: string,
    public readonly operation: string,
    public readonly statusCode?: number
  ) {
    super(message);
  }

  static fromUnknown(err: unknown, executionId: string, operation: string, status?: number): AuthError {
    if (err instanceof AuthError) {
      return err;
    }
    let message = "Authentication failed";
    if (err instanceof Error) {
      message = err.message;
    } else if (typeof err === "string") {
      message = err;
    }
    return new AuthError(message, executionId, operation, status);
  }
}

export class AuthedHttpClient {
  public readonly executionId: string;
  constructor(
    private readonly options: ClientOptions
  ) {
    this.executionId = options.executionId;
  }

  /**
   * Execute a request with token lift, 401 retry, and clear error on second failure.
   * @throws AuthError if refresh succeeds but the core request fails.
   */
  async request<T>(resource: string, options: RequestOptions = {}): Promise<T> {
    const operation = `${options.method ?? "GET"} ${resource}`;
    const fetchImpl = options.fetch ?? this.options.fetchImpl ?? globalThis.fetch as unknown as typeof options.fetch;

    if (typeof fetchImpl !== "function") {
      throw AuthError.fromUnknown(new Error("no fetch implementation available"), this.executionId, operation);
    }

    const baseUrl = this.options.baseUrl ?? "";
    const url = resource.startsWith("http") ? resource : `${baseUrl}${resource}`;

    const tokenValue = (options.token as string) ?? this.options.tokenStore.getTokenForHeader() ?? undefined;

    const baseHeaders: Record<string, string> = {};
    if (options.headers) {
      for (const [k, v] of Object.entries(options.headers as Record<string, string>)) {
        baseHeaders[k] = v;
      }
    }
    const autoBearer = options.autoIncludeBearer ?? this.options.autoIncludeBearer ?? true;
    if (tokenValue && autoBearer) {
      baseHeaders["Authorization"] = tokenValue.startsWith("Bearer ") ? tokenValue : `Bearer ${tokenValue}`;
    }

    const execOnce = async (opts: RequestInit & { headers: Record<string, string> }): Promise<Response> => {
      return await (fetchImpl as (r: string, init: RequestInit) => Promise<Response>)(url, opts);
    };

    // First attempt
    let response: Response;
    try {
      response = await execOnce({
        method: options.method ?? "GET",
        headers: baseHeaders,
        body: options.body ?? undefined,
        signal: options.signal,
      });
    } catch (err) {
      throw AuthError.fromUnknown(err, this.executionId, operation);
    }

    if (response.status !== 401) {
      if (response.ok) {
        return await this.parseJsonAware<T>(response, operation);
      }
      // non-401 failure without retry
      const text = await safeText(response);
      throw new AuthError(
        `Request failed ${response.status} ${response.statusText} on ${operation}${text ? `: ${text.slice(0, 400)}` : ""}`,
        this.executionId,
        operation,
        response.status
      );
    }

    // 401 -> try refresh once, then retry
    console.warn(
      `[AuthedHttpClient] received 401 for ${operation} (execution=${this.executionId}); refreshing and retrying once`
    );

    let refreshedToken: string | null = null;
    try {
      refreshedToken = await this.options.tokenStore.getToken();
    } catch (err) {
      console.error(
        `[AuthedHttpClient] token refresh failure for execution=${this.executionId} operation=${operation}:`,
        err
      );
      throw AuthError.fromUnknown(err, this.executionId, operation, 401);
    }

    if (!refreshedToken) {
      throw new AuthError(
        `Token revoked or expired (no token after refresh) for execution=${this.executionId} operation=${operation}`,
        this.executionId,
        operation,
        401
      );
    }

    const retryHeaders: Record<string, string> = { ...baseHeaders };
    retryHeaders["Authorization"] = refreshedToken.startsWith("Bearer ")
      ? refreshedToken
      : `Bearer ${refreshedToken}`;

    try {
      response = await execOnce({
        method: options.method ?? "GET",
        headers: retryHeaders,
        body: options.body ?? undefined,
        signal: options.signal,
      });
    } catch (err) {
      throw AuthError.fromUnknown(err, this.executionId, operation);
    }

    if (response.ok) {
      return await this.parseJsonAware<T>(response, operation);
    }

    const text = await safeText(response);
    // Second attempt also not 2xx -> throw, never silent null
    throw new AuthError(
      `Request failed after retry: ${response.status} ${response.statusText} on ${operation}${text ? `: ${text.slice(0, 400)}` : ""}`,
      this.executionId,
      operation,
      response.status
    );
  }

  private async parseJsonAware<T>(response: Response, operation: string): Promise<T> {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        return (await response.json()) as T;
      } catch (err: unknown) {
        throw new AuthError(
          `Failed to parse JSON response for ${operation}: ${String(err)}`,
          this.executionId,
          operation,
          response.status
        );
      }
    }
    // No content-type or non-JSON success: try JSON, fallback to text-as-unknown
    try {
      return (await response.json()) as T;
    } catch {
      // empty body etc.
      return {} as unknown as T;
    }
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
