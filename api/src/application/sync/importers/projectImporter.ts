/**
 * G17 — bounded project import use case.
 *
 * One entity kind, one function, no writer parameter. A future sync route
 * calls `importEntity` for a project event. It must not grow a generic
 * `importEntity(type, body, write)` that persists arbitrary payload jsonb.
 */

export const kind = 'project' as const;

export type BoundedImportRefusalCode = 'wrong_kind' | 'unbound_destination';

export class BoundedImportRefusal extends Error {
  readonly code: BoundedImportRefusalCode;

  constructor(code: BoundedImportRefusalCode) {
    super(code);
    this.name = 'BoundedImportRefusal';
    this.code = code;
  }
}

/** The only argument `importEntity` accepts. A writer callback is not part of this contract. */
export interface BoundedImportEvent {
  entityType?: unknown;
  destination?: { kind?: unknown } | null;
  clientEntityId?: unknown;
}

export interface AcceptedBoundedImport {
  readonly kind: typeof kind;
  readonly clientEntityId: string;
}

function refusal(code: BoundedImportRefusalCode): never {
  throw new BoundedImportRefusal(code);
}

/**
 * Accept a project event whose destination is already bound.
 * Any other kind — including a missing kind — throws `wrong_kind`.
 * An unbound or missing destination throws `unbound_destination`.
 */
export function importEntity(event: BoundedImportEvent | null | undefined): AcceptedBoundedImport {
  if (!event || typeof event !== 'object' || event.entityType !== kind) {
    refusal('wrong_kind');
  }
  const destination = event.destination;
  if (!destination || typeof destination !== 'object' || destination.kind !== 'bound') {
    refusal('unbound_destination');
  }
  const clientEntityId = typeof event.clientEntityId === 'string' ? event.clientEntityId : '';
  return Object.freeze({ kind, clientEntityId });
}
