/**
 * DOMAIN-GATED RELATIONS — object kinds whose kernel relations are a domain's
 * AUTHORISATION store, not a roster anybody in the tenant may edit.
 *
 * A board's memberships are its board-role gate (`application/creation/sessionAccess.ts`,
 * migration 1264), and a board's share links are invitations INTO it (an `edit` link is
 * redeemed as a board `editor` — `canvasInviteLinks.ts`). The generic
 * `/api/objects/:id/{members,shares}` surface only proves the object is in the caller's
 * tenant, so for these kinds:
 *
 *   - WRITES (add/remove member, mint/revoke share) are refused outright. They go
 *     through the domain's own owner-gated routes, which call the raw use cases.
 *   - READS (list members, list shares) require the domain's own read gate — for a
 *     board, any board role — injected by `src/index.ts` so the kernel never imports a
 *     domain. A gated kind with no injected gate fails closed.
 *
 * Enforced inside the registry FACADE (`createObjectRegistry`), not in the route, so
 * no caller of the port can step around it.
 */

/** The kinds. Adding one here closes its generic relation writes everywhere at once. */
export const DOMAIN_GATED_RELATION_KINDS: ReadonlySet<string> = new Set(['creation_session']);

export function relationsAreDomainGated(kind: string): boolean {
  return DOMAIN_GATED_RELATION_KINDS.has(kind);
}

/** The one refusal code every gated relation answers with. */
export const DOMAIN_GATED_RELATION_CODE = 'DOMAIN_GATED_RELATION';

export class DomainGatedRelationError extends Error {
  readonly code = DOMAIN_GATED_RELATION_CODE;
  constructor(readonly kind: string, readonly action: 'read' | 'write') {
    super(`relations of a ${kind} are managed by its own surface`);
    this.name = 'DomainGatedRelationError';
  }
}

/** "May this person read this gated object's relations?" — supplied per kind by the
 *  composition root. `refId` is the domain row's id (a board's session id). */
export type RelationReadGate = (input: { tenantId: number; refId: string; userId: string }) => Promise<boolean>;
export type RelationReadGates = Readonly<Partial<Record<string, RelationReadGate>>>;

/** Refuse a generic WRITE to a gated object's relations. A missing object passes —
 *  the caller's own not-found handling answers it. */
export function assertRelationsWritable(object: { kind: string } | null): void {
  if (object && relationsAreDomainGated(object.kind)) throw new DomainGatedRelationError(object.kind, 'write');
}

/** Refuse a generic READ of a gated object's relations unless its domain gate admits
 *  the viewer. Fails closed: no gate, or no viewer, is a refusal. */
export async function assertRelationsReadable(
  object: { kind: string; refId: string } | null,
  tenantId: number,
  viewerRef: string | null | undefined,
  gates: RelationReadGates,
): Promise<void> {
  if (!object || !relationsAreDomainGated(object.kind)) return;
  const gate = gates[object.kind];
  if (!gate || !viewerRef || !(await gate({ tenantId, refId: object.refId, userId: viewerRef }))) {
    throw new DomainGatedRelationError(object.kind, 'read');
  }
}
