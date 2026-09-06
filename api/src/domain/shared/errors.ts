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

/** Thrown when a request lacks valid credentials. */
export class UnauthorizedError extends DomainError {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/** Thrown when a required platform dependency cannot safely complete an operation. */
export class ServiceUnavailableError extends DomainError {
  constructor(message = 'Service temporarily unavailable') {
    super(message);
    this.name = 'ServiceUnavailableError';
  }
}

/** One field-level problem with a request, as the client should see it. */
export interface RequestValidationIssue {
  /** Dotted path into the body (`"items.0.id"`), `""` for the whole body. */
  path: string;
  message: string;
}

/**
 * Thrown when a request BODY or QUERY does not match the schema its route declared
 * (see `presentation/routes/requestBody.ts`). A {@link ValidationError} for the
 * global handler's `instanceof` chain, plus the per-field issues so the answer is
 * "field X is wrong" rather than one opaque sentence.
 */
export class RequestValidationError extends ValidationError {
  readonly issues: readonly RequestValidationIssue[];
  constructor(issues: readonly RequestValidationIssue[], message = 'Invalid request') {
    super(message);
    this.name = 'RequestValidationError';
    this.issues = issues;
  }
}

/** The status each {@link DomainError} subclass answers with. Checked most-specific first. */
const DOMAIN_ERROR_STATUS: ReadonlyArray<readonly [new (...args: never[]) => DomainError, number]> = [
  [ValidationError, 400],
  [UnauthorizedError, 401],
  [ForbiddenError, 403],
  [NotFoundError, 404],
  [ConflictError, 409],
  [ServiceUnavailableError, 503],
];

/** `true` for a 4xx — the caller's mistake, never reported as a defect. */
export function isClientError(status: number): boolean {
  return status >= 400 && status < 500;
}

/**
 * THE one place an error becomes an HTTP status.
 *
 *   1. A {@link DomainError} subclass → its status (a {@link RequestValidationError}
 *      is a {@link ValidationError}, so 400).
 *   2. Any error carrying an integer `status` in 400–599 → that status. This is what
 *      the ~40 application error classes (`PublisherError`, `AtsError`,
 *      `ConnectorServiceError`, …) already declare, so a route never re-decides
 *      whether "already sent" is a 400 or a 409.
 *   3. Anything else → 500: an invariant failure, reported and answered generically.
 *
 * `statusOf` is what `errorHandler` and `failResponse` both run on. Seven route
 * files used to each carry their own `fail()` mapping the same `.status` field and
 * disagreeing about whether an unknown error's message may leak; now none of them
 * decide anything.
 */
export function statusOf(error: unknown): number {
  for (const [klass, status] of DOMAIN_ERROR_STATUS) {
    if (error instanceof klass) return status;
  }
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599) return status;
  return 500;
}
