/**
 * AuthedHttpClient: Transparent 401-retry wrapper for authenticated HTTP requests.
 *
 * Wraps outbound requests with:
 * - Token acquisition from TokenStore (auto-refresh on expiry)
 * - Automatic single retry on 401 with fresh token
 * - Clear AuthError for double failures instead of silent null degradation
 */

import type { TokenStore, AuthError } from "./TokenStore.js";

export interface RequestOptions extends RequestInit {
  token?: string; // Optional manual token (overrides store)
}

/**
 * AuthedHttpClient options.
 */
export interface ClientOptions {
  /**
   * Execution ID for error context (must be provided by caller).
   */
  executionId: string;
  /**
   * TokenStore instance to use for token management.
   */
  tokenStore: TokenStore;
  /**
   * Base URL for all requests (optional).
   */
  baseUrl?: string;
  /**
   * Whether to include a "Bearer" header automatically if not provided.
   */
  autoIncludeBearer?: boolean;
}

export class AuthedHttpClient {
  private baseUrl: string;
  private autoIncludeBearer: boolean;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl ?? "";
    this.autoIncludeBearer = options.autoIncludeBearer ?? true;
  }

  /**
   * Execute a request with token lift, 401 retry, and clear error on second failure.
   * @throws AuthError if refresh succeeds but the core request fails.
   */
  async request<T>(resource: string, options: RequestOptions = {}): Promise<T> {
    // Track call context for errors.
    const operation = `${options.method ?? "GET"} ${resource}`;

    // Prepare the initial request with either provided token or from store.
    let requestInit: RequestInit = this.wrapRequestInit(resource, options);
    let response: Response;

    // First attempt.
    try {
      response = await this.executeRequest(requestInit);
      if (this.isSuccess(response.status)) {
        return this.parseJsonAware<T>(response);
      }
      if (response.status === 401) {
        // Second attempt: refresh token and retry.
        const refreshedToken = await this.refreshToken(operation);
        requestInit = this.wrapRequestInit(resource, { ...options, token: refreshedToken });
        response = await this.executeRequest(requestInit);

        if (this.isSuccess(response.status)) {
          return this.parseJsonAware<T>(response);
        }
      }
    } catch (err: unknown) {
      throw AuthError.fromUnknown(err, this.executionId, operation);
    }

    // Request did not succeed after retry.
    const message = `API failed after token refresh: ${response.status} ${response.statusText}`;
    throw new AuthError(message, this.executionId, operation, response.status);
  }

  /**
   * Execute a wrapped request.
   */
  private async executeRequest(requestInit: RequestInit): Promise<Response> {
    const url = requestInit.url ?? (requestInit.method === "GET" ? this.baseUrl + requestInit.path : requestInit.path);
    if (!url.startsWith("http")) {
      throw new Error("URL must be absolute or fully specified");
    }
    requestInit.url = url;

    if (requestInit.method === "GET" || !requestInit.method) {
      requestInit.method = "GET";
    }

    const fetchFn = requestInit.fetch ?? globalThis.fetch;
    if (typeof fetchFn !== "function") {
      throw new Error("No fetchFn available");
    }

    return await fetchFn(requestInit);
  }

  /**
   * Wrap RequestInit with token injection.
   */
  private wrapRequestInit(
    resource: string,
    options: RequestOptions
  ): RequestInit {
    const headers: HeadersInit = options.headers ?? {};
    const tokenValue = options.token ?? this.tokenStore.getTokenForHeader();

    if (tokenValue && (this.autoIncludeBearer || options.autoIncludeBearer ?? true)) {
      headers["Authorization"] = tokenValue;
    }

    return {
      method: options.method ?? "GET",
      headers,
      body: options.body,
      credentials: options.credentials,
      cache: options.cache,
      signal: options.signal,
      fetch: options.fetch,
    };
  }

  /**
   * Refresh the token via TokenStore and return the fresh value.
   */
  private async refreshToken(operation: string): Promise<string> {
    const token = await this.tokenStore.getToken();
    if (!token) {
      throw new AuthError(
        `Failed to refresh token (no token pending)`,
        this.executionId,
        operation,
        500
      );
    }
    return token;
  }

  /**
   * Check if a status code indicates success.
   */
  private isSuccess(status: number): boolean {
    return status >= 200 && status < 300;
  }

  /**
   * Parse JSON-aware response; throw AuthError on parse failure.
   */
  private async parseJsonAware<T>(response: Response): Promise<T> {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        return (await response.json()) as T;
      } catch (err: unknown) {
        throw new AuthError(
          `Failed to parse JSON response: ${String(err)}`,
          this.executionId,
          "parse",
          response.status
        );
      }
    }

    const text = await response.text();
    if (!response.ok) {
      throw new AuthError(
        `Response not JSON and not OK (${response.status} ${response.statusText}): ${text.slice(0, 200)}`,
        this.executionId,
        "response",
        response.status
      );
    }

    return {} as T;
  }
}

/**
 * AuthError utilities from TokenStore, lifted to this module for convenience.
 */
export class AuthError {
  constructor(
    public readonly message: string,
    public readonly executionId: string,
    public readonly operation: string,
    public readonly statusCode?: number
  ) {
    this.name = "AuthError";
  }

  /**
   * Create an AuthError from any unknown error.
   */
  static fromUnknown(err: unknown, executionId: string, operation: string, status?: number): never {
    if (err instanceof AuthError) {
      throw err;
    }
    let message = "Authentication failed";
    if (err instanceof Error) {
      message = err.message;
    } else if (typeof err === "string") {
      message = err;
    }
    throw new AuthError(message, executionId, operation, status);
  }

  /**
   * Serialize for logging.
   */
  toLogMessage(): string {
    return `AuthError [${executionId}] ${this.operation}: ${this.message}${this.statusCode ? ` (${this.statusCode})` : ""}`;
  }
}