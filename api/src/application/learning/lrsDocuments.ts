/**
 * THE xAPI DOCUMENT RESOURCES — State, Activity Profile and Agent Profile.
 *
 * Three resources in the specification, ONE table and one module here, because
 * they differ only in which parts of the address they use:
 *
 *   state             activity + agent + registration + stateId
 *   activity_profile  activity                        + profileId
 *   agent_profile               agent                 + profileId
 *
 * `lrs_documents` is a KEEP in the coverage map and already carried every one of
 * those columns. What it did NOT carry was a working key: the unique index spanned
 * two NULLABLE columns, and two NULLs are DISTINCT in a Postgres unique index — so
 * the constraint whose entire job is to make a PUT idempotent silently permitted a
 * second row for every Activity Profile and every Agent Profile. Migration 1114
 * makes the three addressing columns `NOT NULL DEFAULT ''` and folds
 * `registration` into the key, so "absent" is a value the index can compare.
 *
 * ── CONCURRENCY IS THE POINT OF THIS RESOURCE ───────────────────────────────
 * A State document is written by a running course, repeatedly, from whichever tab
 * the learner has open. The specification's answer is RFC 7232 preconditions, and
 * it is prescriptive: a PUT to a document that already exists and carries neither
 * `If-Match` nor `If-None-Match` must be REFUSED with 409, because the client that
 * sent it cannot know what it is overwriting. That rule is implemented here rather
 * than at the route, so it cannot be forgotten by the second caller.
 *
 * The ETag is `sha256(content)`, which makes it a function of the document rather
 * than of a counter — two writers that store identical bytes agree, and a restore
 * from backup does not invalidate a client's cached copy.
 *
 * ── WHY THE SINGLE-DOCUMENT READ IS NOT CACHED ─────────────────────────────
 * It is one unique-index lookup, and it is the read whose bytes the ETag is
 * computed from: putting a cross-isolate cache in front of the value a
 * precondition is checked against turns a stale entry into a lost write. The
 * LISTING is cached — that one is read on every course launch and changes only
 * when a document is created or deleted, both of which are here.
 */

import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { lrsDocuments } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { sha256Hex } from '../../infrastructure/crypto/digest';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';

export const DOCUMENT_SCOPES = ['state', 'activity_profile', 'agent_profile'] as const;
export type DocumentScope = (typeof DOCUMENT_SCOPES)[number];

/**
 * Where a document lives. Every field is a string and never null — see the
 * migration note above. `''` means "this scope does not use that dimension", and
 * {@link addressFor} is the only thing that builds one, so no caller can invent a
 * half-filled address that reads back as a different document than it wrote.
 */
export interface DocumentAddress {
  scope: DocumentScope;
  activityId: string;
  agentKey: string;
  registration: string;
  documentId: string;
}

export interface LrsDocument {
  documentId: string;
  contentType: string;
  /** The document as it was stored. A JSON body round-trips as itself; any other
   *  content type round-trips as the text that arrived. */
  content: unknown;
  /** Unquoted, 64 hex. The route quotes it — a quoted value in the database is a
   *  transport detail leaking into storage. */
  etag: string;
  updatedAt: string;
}

/** RFC 7232, as the specification requires them. `ifNoneMatch: '*'` means "only
 *  if it does not exist yet"; `ifMatch` means "only if it is still this". */
export interface Precondition {
  ifMatch?: string | null;
  ifNoneMatch?: string | null;
}

export type DocumentRefusal =
  | { ok: false; status: 400; detail: string }
  | { ok: false; status: 409; detail: string }
  | { ok: false; status: 412; detail: string };

export const JSON_CONTENT_TYPE = 'application/json';

const listCacheKey = (tenantId: number, scope: string, activityId: string, agentKey: string) =>
  `lrs:docs:${tenantId}:${scope}:${activityId}:${agentKey}`;

/**
 * Build an address, refusing the combinations the specification does not define.
 *
 * A State with no activity, or an Agent Profile with no agent, is not an under-
 * specified request that can be defaulted — it addresses nothing. Refusing here is
 * what keeps `''` meaning "this scope has no such dimension" rather than "the
 * caller forgot".
 */
export function addressFor(input: {
  scope: DocumentScope;
  activityId?: string | null;
  agentKey?: string | null;
  registration?: string | null;
  documentId?: string | null;
}): { ok: true; address: DocumentAddress } | DocumentRefusal {
  const activityId = (input.activityId ?? '').trim().slice(0, 320);
  const agentKey = (input.agentKey ?? '').trim().slice(0, 320);
  const registration = (input.registration ?? '').trim().slice(0, 64);
  const documentId = (input.documentId ?? '').trim().slice(0, 255);

  if (!documentId) return { ok: false, status: 400, detail: 'a document id is required' };
  if (input.scope !== 'agent_profile' && !activityId) {
    return { ok: false, status: 400, detail: 'activityId is required for this resource' };
  }
  if (input.scope !== 'activity_profile' && !agentKey) {
    return { ok: false, status: 400, detail: 'agent is required for this resource' };
  }

  return {
    ok: true,
    address: {
      scope: input.scope,
      // Cleared rather than carried: an Activity Profile that stored the agent it
      // happened to be written by would be a different document per learner, which
      // is precisely what an activity-wide profile is not.
      activityId: input.scope === 'agent_profile' ? '' : activityId,
      agentKey: input.scope === 'activity_profile' ? '' : agentKey,
      registration: input.scope === 'state' ? registration : '',
      documentId,
    },
  };
}

/** One document, or null. */
export async function getDocument(
  db: Db, tenantId: number, address: DocumentAddress,
): Promise<LrsDocument | null> {
  const [row] = await db.select()
    .from(lrsDocuments)
    .where(scopedToTenant(lrsDocuments, tenantId, addressPredicate(address))!)
    .limit(1);
  return row ? toDocument(row) : null;
}

/**
 * Store a document, replacing whatever was there.
 *
 * The precondition check and the write are one statement, not a read followed by
 * a write: `WHERE etag = …` inside the UPDATE is what makes two concurrent PUTs
 * with the same `If-Match` resolve to one winner. The read that follows a failed
 * update exists only to tell 409 (nothing was there / no precondition given) from
 * 412 (something was there and it had moved on).
 */
export async function putDocument(
  db: Db, env: Env,
  tenantId: number,
  address: DocumentAddress,
  body: { contentType: string; content: unknown },
  precondition: Precondition = {},
): Promise<{ ok: true; etag: string; created: boolean } | DocumentRefusal> {
  const contentType = (body.contentType || JSON_CONTENT_TYPE).slice(0, 128);
  const stored = wrap(contentType, body.content);
  const etag = await etagFor(stored);

  const existing = await getDocument(db, tenantId, address);
  const guard = checkPrecondition(existing, precondition);
  if (!guard.ok) return guard;

  if (!existing) {
    // `onConflictDoNothing` rather than a plain insert: two first writes race, and
    // the loser must be told to retry with a precondition rather than handed a
    // unique-violation stack trace.
    const inserted = await db.insert(lrsDocuments).values({
      tenantId,
      scope: address.scope,
      activityId: address.activityId,
      agentKey: address.agentKey,
      registration: address.registration,
      documentId: address.documentId,
      contentType,
      content: stored,
      etag,
    }).onConflictDoNothing().returning({ id: lrsDocuments.id });

    if (inserted.length === 0) {
      return { ok: false, status: 409, detail: 'the document was created concurrently — retry with If-Match' };
    }
    await invalidateListing(env, tenantId, address);
    return { ok: true, etag, created: true };
  }

  const updated = await db.update(lrsDocuments)
    .set({ contentType, content: stored, etag, updatedAt: new Date() })
    .where(scopedToTenant(lrsDocuments, tenantId, and(
      addressPredicate(address),
      eq(lrsDocuments.etag, existing.etag),
    ))!)
    .returning({ id: lrsDocuments.id });

  if (updated.length === 0) {
    return { ok: false, status: 412, detail: 'the document changed while this write was in flight' };
  }
  return { ok: true, etag, created: false };
}

/**
 * Merge into a document, the way the specification defines POST.
 *
 * Both sides must be JSON OBJECTS. Anything else — an array, a scalar, a
 * `text/plain` body, or an existing document that is not an object — is a 400
 * rather than a silent replacement, because "merge" has no meaning there and
 * quietly overwriting is the failure mode a course author would never see.
 *
 * The merge is TOP-LEVEL only, which is what the specification says: a nested
 * object is replaced whole. Deep-merging would make it impossible for a client to
 * delete a nested key.
 */
export async function postDocument(
  db: Db, env: Env,
  tenantId: number,
  address: DocumentAddress,
  body: { contentType: string; content: unknown },
  precondition: Precondition = {},
): Promise<{ ok: true; etag: string; created: boolean } | DocumentRefusal> {
  const existing = await getDocument(db, tenantId, address);
  if (!existing) return putDocument(db, env, tenantId, address, body, precondition);

  if (!isJsonType(body.contentType) || !isJsonType(existing.contentType)) {
    return { ok: false, status: 400, detail: 'only application/json documents can be merged — use PUT' };
  }
  if (!isPlainObject(body.content) || !isPlainObject(existing.content)) {
    return { ok: false, status: 400, detail: 'only JSON objects can be merged — use PUT' };
  }

  return putDocument(
    db, env, tenantId, address,
    { contentType: JSON_CONTENT_TYPE, content: { ...existing.content, ...body.content } },
    precondition,
  );
}

/** Delete a document. Idempotent — the specification's DELETE returns 204 whether
 *  or not anything was there, and a caller that has to distinguish is a caller
 *  that will race. */
export async function deleteDocument(
  db: Db, env: Env, tenantId: number, address: DocumentAddress,
  precondition: Precondition = {},
): Promise<{ ok: true } | DocumentRefusal> {
  const existing = await getDocument(db, tenantId, address);
  if (!existing) return { ok: true };

  // Only `If-Match` is meaningful on a delete; `If-None-Match: *` on something
  // that exists is checked by the same helper and refuses, which is correct.
  const guard = checkPrecondition(existing, precondition);
  if (!guard.ok) return guard;

  await db.delete(lrsDocuments)
    .where(scopedToTenant(lrsDocuments, tenantId, and(
      addressPredicate(address),
      eq(lrsDocuments.etag, existing.etag),
    ))!);
  await invalidateListing(env, tenantId, address);
  return { ok: true };
}

/**
 * The document ids under one address prefix, oldest first — the listing every
 * document resource offers, and the one read on every course launch.
 *
 * Cached, keyed by the prefix. `since` is applied AFTER the cache rather than
 * inside its key, because the parameter is a moving timestamp and would make the
 * keyspace unbounded for a listing that is at most a few dozen ids.
 */
export async function listDocumentIds(
  db: Db, env: Env,
  tenantId: number,
  prefix: { scope: DocumentScope; activityId: string; agentKey: string },
  since?: Date | null,
): Promise<string[]> {
  const rows = await getOrSetCached(
    env,
    listCacheKey(tenantId, prefix.scope, prefix.activityId, prefix.agentKey),
    async () => db.select({ documentId: lrsDocuments.documentId, updatedAt: lrsDocuments.updatedAt })
      .from(lrsDocuments)
      .where(scopedToTenant(lrsDocuments, tenantId, and(
        eq(lrsDocuments.scope, prefix.scope),
        eq(lrsDocuments.activityId, prefix.activityId),
        eq(lrsDocuments.agentKey, prefix.agentKey),
      ))!)
      .orderBy(asc(lrsDocuments.updatedAt))
      .limit(500),
    { kvTtlSeconds: 60 },
  );

  return rows
    .filter((r) => !since || new Date(r.updatedAt) > since)
    .map((r) => r.documentId);
}

/**
 * The precondition rules, in one place because they are the part that is easy to
 * get subtly wrong and impossible to notice.
 *
 * Exported for the test: the case that matters is the LAST one — an existing
 * document and NO precondition at all is a 409, not a permitted overwrite.
 */
export function checkPrecondition(
  existing: { etag: string } | null,
  precondition: Precondition,
): { ok: true } | DocumentRefusal {
  const ifMatch = normaliseEtag(precondition.ifMatch);
  const ifNoneMatch = normaliseEtag(precondition.ifNoneMatch);

  if (ifNoneMatch === '*') {
    return existing
      ? { ok: false, status: 412, detail: 'the document already exists' }
      : { ok: true };
  }
  if (ifMatch) {
    if (!existing) return { ok: false, status: 412, detail: 'no such document' };
    return ifMatch === existing.etag
      ? { ok: true }
      : { ok: false, status: 412, detail: 'the document has changed' };
  }
  if (ifNoneMatch && existing && ifNoneMatch === existing.etag) {
    return { ok: false, status: 412, detail: 'the document has not changed' };
  }
  if (existing && !ifMatch && !ifNoneMatch) {
    return {
      ok: false,
      status: 409,
      detail: 'this document exists — send If-Match with its ETag, or If-None-Match: * to create',
    };
  }
  return { ok: true };
}

/** `"abc"` / `W/"abc"` / `abc` all mean the same entity tag. Weak validators are
 *  accepted and compared as strong ones: this LRS only ever issues one ETag per
 *  byte sequence, so the distinction has nothing to express. */
export function normaliseEtag(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^W\//i, '').replace(/^"|"$/g, '').trim();
  return trimmed || null;
}

/** The entity tag for a stored body. A function of the bytes, never of a
 *  revision counter — see the header. */
export async function etagFor(stored: unknown): Promise<string> {
  return sha256Hex(JSON.stringify(stored ?? null));
}

function addressPredicate(address: DocumentAddress) {
  return and(
    eq(lrsDocuments.scope, address.scope),
    eq(lrsDocuments.activityId, address.activityId),
    eq(lrsDocuments.agentKey, address.agentKey),
    eq(lrsDocuments.registration, address.registration),
    eq(lrsDocuments.documentId, address.documentId),
  );
}

async function invalidateListing(env: Env, tenantId: number, address: DocumentAddress): Promise<void> {
  await invalidateCached(env, listCacheKey(tenantId, address.scope, address.activityId, address.agentKey));
}

export function isJsonType(contentType: string): boolean {
  return /^application\/(?:[\w.+-]+\+)?json\b/i.test(contentType.trim());
}

/**
 * The column is `jsonb`, and a document is not always JSON.
 *
 * A non-JSON body is stored as `{ text: … }` rather than as a bare JSON string,
 * so the stored shape says what it is: a reader that finds an object with one
 * `text` key knows it is looking at a wrapper, where a bare string would be
 * indistinguishable from a JSON document that genuinely was a string.
 */
function wrap(contentType: string, content: unknown): unknown {
  if (isJsonType(contentType)) return content ?? null;
  return { text: typeof content === 'string' ? content : String(content ?? '') };
}

function unwrap(contentType: string, stored: unknown): unknown {
  if (isJsonType(contentType)) return stored;
  return isPlainObject(stored) && typeof stored.text === 'string' ? stored.text : '';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toDocument(row: typeof lrsDocuments.$inferSelect): LrsDocument {
  const contentType = row.contentType ?? JSON_CONTENT_TYPE;
  return {
    documentId: row.documentId,
    contentType,
    content: unwrap(contentType, row.content),
    etag: row.etag ?? '',
    updatedAt: row.updatedAt.toISOString(),
  };
}
