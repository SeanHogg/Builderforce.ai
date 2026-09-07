/**
 * Creation-session model helpers — the request-free rules a canvas session obeys.
 *
 * These lived at the top of the 2,949-line `creationSessionRoutes`, above a
 * Hono router, which is why that file sat in `application/` while importing
 * `authMiddleware`, `scope` and `relayToRoom` from `presentation/` — an inverted
 * dependency arrow (see `check-application-layering`). The router moved to
 * `presentation/routes/creationSessionRoutes.ts`, where it belongs; the rules that
 * never needed a request stayed behind, here, where their real consumers are: the
 * marketplace listing projection, the public `/api/v1` canvas service, and the
 * claim-failure diagnostics.
 */
import { CREATION_UUID_RE as UUID_RE, creationObjectSearchText, uuidKey, validCreationGraph, type GraphConnectionInput, type GraphObjectInput } from './creationGraphWriter';
import type { CreationObjectKind } from '@builderforce/creation-canvas-contract';

// Re-exported because they MOVED, not because they changed: `creationListings.ts`,
// the public `/api/v1` canvas service and this module's own tests import them from
// here, and a move is not a reason to make every caller change its import.
export { creationObjectSearchText, validCreationGraph };

export function creationKindForModality(modality: string): CreationObjectKind {
  // An IDE project is one Builder object regardless of the studio it opens.
  // Mapping modalities to website/video/voice/etc. produced preview cards, but
  // discarded the IDE binding and made its actual tools unreachable.
  void modality;
  return 'build';
}

export function creationSessionSearchStatus(raw: unknown): 'active' | 'archived' | 'all' {
  return raw === 'archived' || raw === 'all' ? raw : 'active';
}

/**
 * What a Postgres error was actually about, as far as the driver will say.
 *
 * `db.batch` on neon-http reports ONE message for the whole batch and no
 * statement index, so a `duplicate key value violates unique constraint
 * "creation_session_objects_pkey"` arriving from a six-statement claim names the
 * TABLE and nothing else — not which row, not how many were in flight, not
 * whether the ids the caller sent were even distinct. That is exactly the report
 * the register had to reason about by inference, and inference is how a fix gets
 * declared for a path nobody proved was taken.
 *
 * The constraint name is the only handle the driver gives, so it is extracted
 * rather than guessed at, and the caller maps it back onto its own labelled
 * inventory of what it was about to write.
 */
export function pgFailureDetail(error: unknown): { code: string | null; constraint: string | null } {
  const detail = error && typeof error === 'object'
    ? error as { code?: unknown; constraint?: unknown; message?: unknown }
    : null;
  const text = [detail?.message, error instanceof Error ? error.message : String(error)]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  const named = typeof detail?.constraint === 'string' && detail.constraint
    ? detail.constraint
    : /unique constraint "([^"]+)"|violates [a-z ]*constraint "([^"]+)"/i.exec(text)?.slice(1).find(Boolean) ?? null;
  return {
    code: typeof detail?.code === 'string' ? detail.code : null,
    constraint: named,
  };
}

/**
 * How many of `values` are distinct once case is ignored.
 *
 * The claim's own primary-key collision had exactly this shape: `UUID_RE` accepts
 * either case, the `uuid` column does not distinguish them, and a validator using
 * a case-SENSITIVE Set therefore passed two ids that Postgres then rejected as
 * one. Reporting BOTH counts is what makes the next occurrence readable — equal
 * counts rule that cause out, unequal counts confirm it, and a guess does neither.
 */
export function distinctIdCounts(values: readonly string[]): { total: number; distinct: number; distinctCaseless: number } {
  return {
    total: values.length,
    distinct: new Set(values).size,
    distinctCaseless: new Set(values.map((value) => value.toLowerCase())).size,
  };
}

/** One write the claim was about to make, with enough about it to say which one
 *  failed when the driver reports only a constraint name. */
export interface PlannedClaimWrite {
  table: string;
  rows: number;
  statement: unknown;
}

/**
 * Map a batch failure back onto the inventory that produced it.
 *
 * Postgres names the CONSTRAINT, and every index this schema creates is named
 * after its table (creation_session_objects_pkey, uq_creation_events_revision).
 * That is enough to recover the statement index the driver drops — and when it is
 * not, the report says the index is unknown rather than asserting one, because a
 * wrong index sends the next reader to the wrong statement.
 */
export function describeClaimBatchFailure(
  error: unknown,
  planned: readonly PlannedClaimWrite[],
): Record<string, unknown> {
  const { code, constraint } = pgFailureDetail(error);
  const index = constraint
    ? planned.findIndex((write) => constraint.toLowerCase().includes(write.table.toLowerCase()))
    : -1;
  return {
    pgCode: code,
    constraint,
    statementIndex: index >= 0 ? index : null,
    statementTable: index >= 0 ? planned[index]!.table : null,
    statementRows: index >= 0 ? planned[index]!.rows : null,
    statementCount: planned.length,
    plan: planned.map((write) => `${write.table}:${write.rows}`),
  };
}

export type CreationCommentAnchor = {
  kind: 'resume-field'; revisionId: string; section: string; entryId?: string; field?: string;
};

/** Bound, semantic anchors only; never persist arbitrary client JSON beside a comment. */
export function cleanCommentAnchor(raw: unknown): CreationCommentAnchor | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.kind !== 'resume-field' || typeof value.revisionId !== 'string' || !value.revisionId.trim()
    || typeof value.section !== 'string' || !value.section.trim()) return null;
  const bounded = (candidate: unknown, max: number) => typeof candidate === 'string' && candidate.trim() ? candidate.trim().slice(0, max) : undefined;
  return {
    kind: 'resume-field', revisionId: value.revisionId.trim().slice(0, 128), section: value.section.trim().slice(0, 64),
    ...(bounded(value.entryId, 128) ? { entryId: bounded(value.entryId, 128) } : {}),
    ...(bounded(value.field, 64) ? { field: bounded(value.field, 64) } : {}),
  };
}

/**
 * Browser-local graph ids are only identities inside that draft. The database
 * primary keys are global, so carrying a local id across the claim boundary can
 * collide with an object from an earlier session (for example, a locally saved
 * copy of a durable canvas). Give every claimed row a new durable identity and
 * rewrite the edge endpoints as one graph operation.
 */
export function durableCreationGraph(
  objects: GraphObjectInput[],
  connections: GraphConnectionInput[],
  newId: () => string = () => crypto.randomUUID(),
): { objects: GraphObjectInput[]; connections: GraphConnectionInput[] } {
  // Keyed case-insensitively for the same reason `validCreationGraph` is: an
  // edge that spells its endpoint in a different case than the object does is
  // still pointing at that object, and a case-sensitive map would resolve it to
  // `undefined` and violate the connection's NOT NULL / foreign key instead.
  const objectIds = new Map(objects.map((object) => [uuidKey(object.id), newId()]));
  return {
    objects: objects.map((object) => ({ ...object, id: objectIds.get(uuidKey(object.id))! })),
    connections: connections.map((edge) => ({
      ...edge,
      id: newId(),
      sourceObjectId: objectIds.get(uuidKey(edge.sourceObjectId))!,
      targetObjectId: objectIds.get(uuidKey(edge.targetObjectId))!,
    })),
  };
}

/**
 * Claim-only: a connection's client-supplied `id` never survives {@link
 * durableCreationGraph} above — it is always discarded and re-minted — so
 * `validCreationGraph`'s UUID-shape check on it protects nothing at the claim
 * boundary, unlike `sourceObjectId`/`targetObjectId`, which genuinely have to
 * resolve, or the `PUT /:id/graph` save path, which inserts `edge.id` as the
 * real primary key and needs the strict check to keep a malformed value out
 * of the database.
 *
 * A browser build (2026-08 and earlier) that shipped `pickObject`'s connection
 * id as `` `${fromNodeId}-${node.id}` `` instead of a fresh UUID left drafts
 * sitting in visitors' local storage with that malformed id baked in — the
 * fix stops NEW drafts from getting a bad id, but does nothing for one already
 * written before the fix shipped, and `claim` rejected it forever (`Invalid
 * connection id: …`) with no way for that visitor to ever get past it. Since
 * the id is thrown away regardless, replace a non-UUID one with a fresh UUID
 * before validation rather than let a legacy client bug permanently block the
 * one thing claiming exists to do — hand the visitor's own work to their new
 * account.
 */
export function sanitizeClaimConnectionIds(connections: GraphConnectionInput[]): GraphConnectionInput[] {
  return connections.map((edge) => (UUID_RE.test(edge.id) ? edge : { ...edge, id: crypto.randomUUID() }));
}
