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
