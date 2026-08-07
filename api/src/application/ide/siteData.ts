/**
 * The published site's backend — a place for a form on a live page to post to.
 *
 * A site shipped from the Designer was a brochure: `mode` only ever wrote
 * `'static'`, there was no server-rendered route, no API and no per-site store,
 * so the first thing anyone wants after "my site is live" — *let people sign
 * up* — was impossible. This module is that store.
 *
 * SHAPE
 *   collection  a named public write endpoint, served at
 *               `https://<site-host>/__api/collections/<name>`
 *   record      one submission
 *
 * WRITES ARE PUBLIC, READS ARE NOT. A GET on the public endpoint would hand
 * every visitor the whole submission list, so there isn't one: the owner reads
 * records back through the authenticated project API. That asymmetry is the
 * whole security model and is deliberately not configurable.
 *
 * ZERO SETUP. Publishing auto-provisions a `signups` collection (the same
 * best-effort pattern that already auto-provisions a QA target), so a form on a
 * freshly-published page works with no dashboard visit at all — and, when the
 * collection is linked to an audience, a submission becomes a marketable
 * contact in the same request.
 */

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { siteCollections, siteRecords } from '../../infrastructure/database/schema';
import { isSendableEmail, normalizeEmail } from '../shared/dnsVerification';
import { addAudienceMembers } from '../marketing/campaignEngine';

/** The collection every published site gets for free. */
export const DEFAULT_COLLECTION = 'signups';

/** Max JSON bytes accepted in one submission. Generous for a form, far below
 *  anything that could be used to park data in our database. */
export const MAX_PAYLOAD_BYTES = 16 * 1024;

/** Max fields, and max length of any single string value. */
export const MAX_FIELDS = 50;
export const MAX_VALUE_LENGTH = 4_000;

/** Default per-collection daily write ceiling when the collection sets none. */
export const DEFAULT_DAILY_WRITE_CAP = 2_000;

/** Collection names are URL segments: lowercase alnum + hyphen, 1–64 chars. */
const COLLECTION_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/**
 * Normalize a collection name to its URL form, or null when unusable. Shared by
 * the create path and the public write path so a collection can never be
 * created under a name the router cannot address.
 */
export function normalizeCollectionName(raw: string): string | null {
  const slug = String(raw ?? '')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  if (!slug || !COLLECTION_RE.test(slug)) return null;
  return slug;
}

/** Outcome of sanitizing a submitted body. */
export type PayloadResult =
  | { ok: true; payload: Record<string, unknown>; email: string | null; honeypot: boolean }
  | { ok: false; error: string };

/**
 * Validate and clean one submission.
 *
 * Rules, in the order a hostile caller would hit them: total size, field count,
 * per-value length. Keys beginning `_` are control fields, never stored —
 * `_gotcha` is the honeypot (a field a human never sees and never fills, so a
 * value in it means a bot). A honeypot hit is reported to the caller so it can
 * answer 200-and-discard: telling a spam bot it failed just teaches it.
 */
export function sanitizeSubmission(body: unknown): PayloadResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Submission must be a JSON object.' };
  }
  const raw = body as Record<string, unknown>;

  let serialized: string;
  try {
    serialized = JSON.stringify(raw);
  } catch {
    return { ok: false, error: 'Submission is not serializable.' };
  }
  if (serialized.length > MAX_PAYLOAD_BYTES) {
    return { ok: false, error: `Submission is larger than ${MAX_PAYLOAD_BYTES} bytes.` };
  }

  const entries = Object.entries(raw);
  if (entries.length > MAX_FIELDS) {
    return { ok: false, error: `Submission has more than ${MAX_FIELDS} fields.` };
  }

  const honeypot = typeof raw._gotcha === 'string' && raw._gotcha.trim().length > 0;
  const payload: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (key.startsWith('_')) continue;
    if (typeof value === 'string') {
      payload[key] = value.slice(0, MAX_VALUE_LENGTH);
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      payload[key] = value;
    } else {
      // Nested objects/arrays are stored as their JSON text rather than rejected
      // — a form that posts a multi-select should still work.
      payload[key] = JSON.stringify(value).slice(0, MAX_VALUE_LENGTH);
    }
  }

  const emailField = payload.email ?? payload.Email ?? payload.EMAIL;
  const email = isSendableEmail(emailField) ? normalizeEmail(emailField) : null;
  return { ok: true, payload, email, honeypot };
}

export interface SubmitInput {
  db: Db;
  siteId: number;
  tenantId: number;
  collectionName: string;
  body: unknown;
  ipHash?: string | null;
  userAgent?: string | null;
  referrer?: string | null;
}

export type SubmitResult =
  | { ok: true; recordId: number | null; accepted: true; audienceAdded: boolean }
  | { ok: false; status: 400 | 404 | 429; error: string };

/**
 * Store one public submission.
 *
 * Everything a hostile internet can reach is bounded here: the collection must
 * exist AND accept public writes, the body is sanitized, and the collection's
 * daily ceiling is enforced with a counted window (the ceiling is per
 * collection, so one abused form cannot exhaust another site's).
 */
export async function submitSiteRecord(input: SubmitInput): Promise<SubmitResult> {
  const { db, siteId, tenantId } = input;
  const name = normalizeCollectionName(input.collectionName);
  if (!name) return { ok: false, status: 404, error: 'Unknown collection.' };

  const [collection] = await db
    .select({
      id: siteCollections.id,
      acceptsPublicWrites: siteCollections.acceptsPublicWrites,
      audienceId: siteCollections.audienceId,
      dailyWriteCap: siteCollections.dailyWriteCap,
      tenantId: siteCollections.tenantId,
    })
    .from(siteCollections)
    .where(and(eq(siteCollections.siteId, siteId), eq(siteCollections.name, name), eq(siteCollections.tenantId, tenantId)))
    .limit(1);
  if (!collection) return { ok: false, status: 404, error: 'Unknown collection.' };
  if (!collection.acceptsPublicWrites) {
    return { ok: false, status: 404, error: 'Unknown collection.' };
  }

  const sanitized = sanitizeSubmission(input.body);
  if (!sanitized.ok) return { ok: false, status: 400, error: sanitized.error };

  // Honeypot: accept, discard, and look identical to a success from outside.
  if (sanitized.honeypot) return { ok: true, recordId: null, accepted: true, audienceAdded: false };

  const cap = collection.dailyWriteCap > 0 ? collection.dailyWriteCap : DEFAULT_DAILY_WRITE_CAP;
  const since = new Date(Date.now() - 86_400_000);
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(siteRecords)
    .where(and(
      eq(siteRecords.collectionId, collection.id),
      eq(siteRecords.tenantId, tenantId),
      gte(siteRecords.createdAt, since),
    ));
  if (Number(count) >= cap) {
    return { ok: false, status: 429, error: 'This form has reached its limit for today.' };
  }

  const [record] = await db
    .insert(siteRecords)
    .values({
      collectionId: collection.id,
      tenantId,
      payload: sanitized.payload,
      email: sanitized.email,
      ipHash: input.ipHash ?? null,
      userAgent: input.userAgent?.slice(0, 500) ?? null,
      referrer: input.referrer?.slice(0, 1000) ?? null,
    })
    .returning({ id: siteRecords.id });

  await db
    .update(siteCollections)
    .set({ recordCount: sql`${siteCollections.recordCount} + 1`, updatedAt: sql`NOW()` })
    .where(and(eq(siteCollections.id, collection.id), eq(siteCollections.tenantId, tenantId)));

  // Close the loop: a signup on the site becomes a marketable contact with no
  // export step. Best-effort — the submission itself has already succeeded and
  // must not be lost because the audience write failed.
  let audienceAdded = false;
  if (collection.audienceId && sanitized.email) {
    const name = typeof sanitized.payload.name === 'string' ? sanitized.payload.name : '';
    const added = await addAudienceMembers(db, tenantId, collection.audienceId, [
      { email: sanitized.email, name, source: 'site-form' },
    ]).catch(() => ({ added: 0, updated: 0 }));
    audienceAdded = added.added > 0;
  }

  return { ok: true, recordId: record?.id ?? null, accepted: true, audienceAdded };
}

// ---------------------------------------------------------------------------
// Owner-side management
// ---------------------------------------------------------------------------

export interface CollectionView {
  id: number;
  name: string;
  acceptsPublicWrites: boolean;
  audienceId: number | null;
  recordCount: number;
  dailyWriteCap: number;
  createdAt: Date;
}

export async function listCollections(
  db: Db,
  tenantId: number,
  siteId: number,
): Promise<CollectionView[]> {
  return db
    .select({
      id: siteCollections.id,
      name: siteCollections.name,
      acceptsPublicWrites: siteCollections.acceptsPublicWrites,
      audienceId: siteCollections.audienceId,
      recordCount: siteCollections.recordCount,
      dailyWriteCap: siteCollections.dailyWriteCap,
      createdAt: siteCollections.createdAt,
    })
    .from(siteCollections)
    .where(and(eq(siteCollections.siteId, siteId), eq(siteCollections.tenantId, tenantId)))
    .orderBy(desc(siteCollections.createdAt));
}

export type CreateCollectionResult =
  | { ok: true; collection: CollectionView }
  | { ok: false; status: 400 | 409; error: string };

export async function createCollection(
  db: Db,
  tenantId: number,
  siteId: number,
  projectId: number,
  rawName: string,
): Promise<CreateCollectionResult> {
  const name = normalizeCollectionName(rawName);
  if (!name) {
    return { ok: false, status: 400, error: 'Use lowercase letters, numbers and hyphens.' };
  }
  const [existing] = await db
    .select({ id: siteCollections.id })
    .from(siteCollections)
    .where(and(eq(siteCollections.siteId, siteId), eq(siteCollections.name, name), eq(siteCollections.tenantId, tenantId)))
    .limit(1);
  if (existing) return { ok: false, status: 409, error: `"${name}" already exists.` };

  const [row] = await db
    .insert(siteCollections)
    .values({ siteId, tenantId, projectId, name })
    .returning({
      id: siteCollections.id,
      name: siteCollections.name,
      acceptsPublicWrites: siteCollections.acceptsPublicWrites,
      audienceId: siteCollections.audienceId,
      recordCount: siteCollections.recordCount,
      dailyWriteCap: siteCollections.dailyWriteCap,
      createdAt: siteCollections.createdAt,
    });
  return { ok: true, collection: row! };
}

/**
 * Create the default collection for a freshly-published site if it has none.
 *
 * `ON CONFLICT DO NOTHING` against the (site, name) unique index rather than a
 * read-then-write, so two concurrent publishes cannot both create it.
 */
export async function ensureDefaultCollection(
  db: Db,
  tenantId: number,
  siteId: number,
  projectId: number,
): Promise<void> {
  await db
    .insert(siteCollections)
    .values({ siteId, tenantId, projectId, name: DEFAULT_COLLECTION })
    .onConflictDoNothing();
}

export interface RecordView {
  id: number;
  payload: unknown;
  email: string | null;
  referrer: string | null;
  createdAt: Date;
}

/** Owner-side read of a collection's submissions, newest first. */
export async function listRecords(
  db: Db,
  tenantId: number,
  collectionId: number,
  limit = 50,
  beforeId?: number,
): Promise<RecordView[]> {
  const bounded = Math.min(Math.max(1, Math.trunc(limit)), 200);
  const filters = [eq(siteRecords.collectionId, collectionId), eq(siteRecords.tenantId, tenantId)];
  if (beforeId && Number.isFinite(beforeId)) {
    filters.push(sql`${siteRecords.id} < ${beforeId}` as never);
  }
  return db
    .select({
      id: siteRecords.id,
      payload: siteRecords.payload,
      email: siteRecords.email,
      referrer: siteRecords.referrer,
      createdAt: siteRecords.createdAt,
    })
    .from(siteRecords)
    .where(and(...filters))
    .orderBy(desc(siteRecords.id))
    .limit(bounded);
}

export type UpdateCollectionResult =
  | { ok: true; collection: CollectionView }
  | { ok: false; status: 404; error: string };

/** Toggle public writes / link an audience / set the daily cap. */
export async function updateCollection(
  db: Db,
  tenantId: number,
  collectionId: number,
  patch: { acceptsPublicWrites?: boolean; audienceId?: number | null; dailyWriteCap?: number },
): Promise<UpdateCollectionResult> {
  const set: Record<string, unknown> = { updatedAt: sql`NOW()` };
  if (typeof patch.acceptsPublicWrites === 'boolean') set.acceptsPublicWrites = patch.acceptsPublicWrites;
  if (patch.audienceId !== undefined) set.audienceId = patch.audienceId;
  if (typeof patch.dailyWriteCap === 'number' && Number.isFinite(patch.dailyWriteCap)) {
    set.dailyWriteCap = Math.max(0, Math.trunc(patch.dailyWriteCap));
  }

  const [row] = await db
    .update(siteCollections)
    .set(set)
    .where(and(eq(siteCollections.id, collectionId), eq(siteCollections.tenantId, tenantId)))
    .returning({
      id: siteCollections.id,
      name: siteCollections.name,
      acceptsPublicWrites: siteCollections.acceptsPublicWrites,
      audienceId: siteCollections.audienceId,
      recordCount: siteCollections.recordCount,
      dailyWriteCap: siteCollections.dailyWriteCap,
      createdAt: siteCollections.createdAt,
    });
  if (!row) return { ok: false, status: 404, error: 'Collection not found.' };
  return { ok: true, collection: row };
}
