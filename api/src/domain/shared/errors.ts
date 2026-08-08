/** Base class for all domain errors. */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

/** Thrown when a requested entity does not exist. */
export class NotFoundError extends DomainError {
  constructor(entity: string, id: number | string) {
    super(`${entity} '${id}' not found`);
    this.name = 'NotFoundError';
  }
}

/** Thrown when a unique constraint would be violated. */
export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/** Thrown when invariants on a domain object are violated. */
export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Thrown when the caller lacks permission to perform an action. */
export class ForbiddenError extends DomainError {
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Machine-readable reason a 401 was raised.
 *
 * A bare `401 {error: "..."}` forces every client to string-match the prose to
 * decide what to do next, and the two outcomes are opposites: an EXPIRED token
 * should be silently refreshed and the request retried, while a REVOKED one must
 * send the user back through sign-in. Clients branch on this code instead.
 *
 * - `token_expired`   — credential aged out; refreshing is expected to succeed.
 * - `token_revoked`   — credential (or its session) was deliberately killed; do NOT retry.
 * - `token_invalid`   — malformed/unverifiable signature; do NOT retry.
 * - `token_missing`   — no credential presented at all.
 * - `session_invalid` — force-logout bumped `session_version`; re-authenticate.
 */
export type AuthErrorCode =
  | 'token_expired'
  | 'token_revoked'
  | 'token_invalid'
  | 'token_missing'
  | 'session_invalid';

/** Auth codes for which a client SHOULD attempt a refresh and retry once. */
const REFRESHABLE_AUTH_CODES: ReadonlySet<AuthErrorCode> = new Set<AuthErrorCode>(['token_expired']);

/** Thrown when a request lacks valid credentials. */
export class UnauthorizedError extends DomainError {
  /** Machine-readable cause, surfaced to clients as `code` on the 401 body. */
  readonly code?: AuthErrorCode;

  constructor(message = 'Unauthorized', code?: AuthErrorCode) {
    super(message);
    this.name = 'UnauthorizedError';
    this.code = code;
  }

  /**
   * Whether a client holding a refresh credential should try to refresh and
   * replay the request rather than bouncing the user to sign-in.
   */
  get refreshable(): boolean {
    return this.code !== undefined && REFRESHABLE_AUTH_CODES.has(this.code);
  }
}

/** Thrown when a required platform dependency cannot safely complete an operation. */
export class ServiceUnavailableError extends DomainError {
  constructor(message = 'Service temporarily unavailable') {
    super(message);
    this.name = 'ServiceUnavailableError';
  }
}
