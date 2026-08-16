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
 * every visitor the whole submission list, so there isn't one. Records are read
 * back two ways, both server-side: the owner through the authenticated project
 * API, and the project's own handlers through {@link listSiteRecordsForHandler}
 * — a spec the tenant wrote, deciding exactly which fields reach the page. That
 * asymmetry is the whole security model and is deliberately not configurable.
 *
 * ZERO SETUP. Publishing auto-provisions a `signups` collection (the same
 * best-effort pattern that already auto-provisions a QA target), so a form on a
 * freshly-published page works with no dashboard visit at all — and, when the
 * collection is linked to an audience, a submission becomes a marketable
 * contact in the same request.
 */

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { siteCollections, siteRecords } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { isSendableEmail, normalizeEmail } from '../shared/dnsVerification';
import { addAudienceMembers } from '../marketing/campaignEngine';
import { raiseTicketForSiteRecord } from './siteTicketBridge';

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
  /**
   * The signed-in end user (`site_users`) who submitted this, when there was one.
   *
   * Null keeps the anonymous form post exactly as it was — that path is unchanged
   * and still the default. A non-null owner is what makes an owner-scoped read
   * possible at all: {@link listOwnedSiteRecords} hands back only rows whose
   * owner matches the caller, and a null-owner row belongs to nobody and is
   * therefore never returned to anyone but the tenant.
   */
  siteUserId?: number | null;
  /**
   * Present only from the live HTTP path (never from a test). Needed to raise a
   * board ticket when the collection has `raisesTickets` set — {@link
   * raiseTicketForSiteRecord} needs it to fire the lane-entry funnel. Omitting it
   * simply skips the ticket side effect, same as omitting `ipHash`.
   */
  env?: Env;
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
      projectId: siteCollections.projectId,
      raisesTickets: siteCollections.raisesTickets,
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
      siteUserId: input.siteUserId ?? null,
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

  // Close the OTHER loop (0920, R10): a submission to a collection the tenant
  // flagged as feedback becomes a ticket the workforce can act on. Best-effort
  // for the same reason as the audience add just above — the submission has
  // already succeeded and must not be lost because ticket creation failed.
  if (collection.raisesTickets && input.env && record?.id != null) {
    await raiseTicketForSiteRecord(input.env, db, {
      tenantId,
      projectId: collection.projectId,
      collectionName: name,
      recordId: record.id,
      payload: sanitized.payload,
      email: sanitized.email,
    }).catch((error) => {
      reportCaughtError(error, { source: 'application/ide/siteData.ts', operation: 'raiseTicketForSiteRecord' });
    });
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
  /** Does a submission here open a board ticket (0920, R10)? */
  raisesTickets: boolean;
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
      raisesTickets: siteCollections.raisesTickets,
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
      raisesTickets: siteCollections.raisesTickets,
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

// ---------------------------------------------------------------------------
// Server-side read, for handlers only
// ---------------------------------------------------------------------------

/** One record as a handler template sees it. The payload is FLATTENED so a spec
 *  reads `{{steps.recent.records[0].name}}` rather than `…records[0].payload.name`;
 *  `id`/`email`/`createdAt` are applied last so a submitted field cannot shadow
 *  the record's own identity. */
export interface HandlerRecordView extends Record<string, unknown> {
  id: number;
  email: string | null;
  createdAt: string;
}

export interface HandlerCollectionRead {
  collection: string;
  count: number;
  records: HandlerRecordView[];
  /** Set when the collection does not exist — a template can branch on it, and
   *  the outcome list shows the author why their page is empty. */
  error?: string;
}

/** Hard ceiling on rows a single handler step may pull back. A handler runs
 *  inside a webhook's latency budget and its output is rendered into a reply. */
const HANDLER_READ_MAX = 100;

/**
 * Read a collection's records for a HANDLER.
 *
 * This is the read half of the site datastore, and it exists only here: the
 * public `/__api/collections/<name>` endpoint is write-only on purpose (a signup
 * form anyone can enumerate is a leak). A handler is not the internet — it runs
 * server-side against a spec the tenant authored, so it is the intended way to
 * build a page out of collected data.
 *
 * Scoped by BOTH tenant and project: the handler's project id comes from the
 * resolved backend, so a spec cannot name another project's collection.
 */
export async function listSiteRecordsForHandler(args: {
  db: Db;
  tenantId: number;
  projectId: number;
  collectionName: string;
  limit?: number;
  /** Optional single-field equality filter over the stored payload. */
  match?: { field: string; value: string } | undefined;
}): Promise<HandlerCollectionRead> {
  const name = normalizeCollectionName(args.collectionName);
  if (!name) return { collection: String(args.collectionName ?? ''), count: 0, records: [], error: 'Invalid collection name.' };

  const [collection] = await args.db
    .select({ id: siteCollections.id })
    .from(siteCollections)
    .where(and(
      eq(siteCollections.tenantId, args.tenantId),
      eq(siteCollections.projectId, args.projectId),
      eq(siteCollections.name, name),
    ))
    .limit(1);
  if (!collection) return { collection: name, count: 0, records: [], error: `No collection named "${name}".` };

  const limit = Math.min(Math.max(1, Math.trunc(args.limit ?? 20)), HANDLER_READ_MAX);
  const filters = [eq(siteRecords.collectionId, collection.id), eq(siteRecords.tenantId, args.tenantId)];
  // Parameterised on both sides: the field name is interpolated as a VALUE into
  // the `->>` operator, not concatenated into the statement.
  if (args.match?.field) {
    filters.push(sql`${siteRecords.payload}->>${args.match.field} = ${args.match.value}` as never);
  }

  const rows = await args.db
    .select({
      id: siteRecords.id,
      payload: siteRecords.payload,
      email: siteRecords.email,
      createdAt: siteRecords.createdAt,
    })
    .from(siteRecords)
    .where(and(...filters))
    .orderBy(desc(siteRecords.id))
    .limit(limit);

  const records: HandlerRecordView[] = rows.map((r) => ({
    ...(r.payload && typeof r.payload === 'object' && !Array.isArray(r.payload)
      ? (r.payload as Record<string, unknown>)
      : {}),
    id: r.id,
    email: r.email,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  }));
  return { collection: name, count: records.length, records };
}

export type UpdateCollectionResult =
  | { ok: true; collection: CollectionView }
  | { ok: false; status: 404; error: string };

/** Toggle public writes / link an audience / set the daily cap / raise tickets. */
export async function updateCollection(
  db: Db,
  tenantId: number,
  collectionId: number,
  patch: { acceptsPublicWrites?: boolean; audienceId?: number | null; dailyWriteCap?: number; raisesTickets?: boolean },
): Promise<UpdateCollectionResult> {
  const set: Record<string, unknown> = { updatedAt: sql`NOW()` };
  if (typeof patch.acceptsPublicWrites === 'boolean') set.acceptsPublicWrites = patch.acceptsPublicWrites;
  if (patch.audienceId !== undefined) set.audienceId = patch.audienceId;
  if (typeof patch.dailyWriteCap === 'number' && Number.isFinite(patch.dailyWriteCap)) {
    set.dailyWriteCap = Math.max(0, Math.trunc(patch.dailyWriteCap));
  }
  if (typeof patch.raisesTickets === 'boolean') set.raisesTickets = patch.raisesTickets;

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
      raisesTickets: siteCollections.raisesTickets,
      createdAt: siteCollections.createdAt,
    });
  if (!row) return { ok: false, status: 404, error: 'Collection not found.' };
  return { ok: true, collection: row };
}

// ---------------------------------------------------------------------------
// Owner-scoped reads — the half a generated app with accounts needs
// ---------------------------------------------------------------------------

/**
 * Rows a SIGNED-IN END USER may read back: their own, in one collection, and
 * only when the collection's owner has opted the collection in.
 *
 * ── WHY THIS IS NARROW ──────────────────────────────────────────────────────
 * The module's opening rule stands unchanged: there is no public GET, because
 * one would hand every visitor the whole submission list. This does not add one.
 * It adds the strictly smaller thing an app with accounts actually needs — "show
 * me MY orders" — and it is gated three ways at once. The collection must be set
 * to `read_policy = 'owner'` (the default is `none`, so nothing that exists today
 * starts returning data). The caller must hold a redeemed session for THIS site.
 * And the filter is on `site_user_id`, so a row written anonymously — owner null
 * — is returned to nobody, ever.
 *
 * There is deliberately no `all` policy. A read-everything option is the failure
 * this module was written to prevent, and offering it as one setting among three
 * is how it eventually gets chosen by someone who did not read this comment.
 */
export interface OwnedRecordView {
  id: number;
  payload: Record<string, unknown>;
  createdAt: string;
}

export type OwnedRecordsResult =
  | { ok: true; records: OwnedRecordView[] }
  | { ok: false; status: 403 | 404; error: string };

export async function listOwnedSiteRecords(args: {
  db: Db;
  siteId: number;
  tenantId: number;
  collectionName: string;
  siteUserId: number;
  limit?: number;
}): Promise<OwnedRecordsResult> {
  const { db, siteId, tenantId, siteUserId } = args;
  const name = normalizeCollectionName(args.collectionName);
  if (!name) return { ok: false, status: 404, error: 'Unknown collection.' };

  const [collection] = await db
    .select({ id: siteCollections.id, readPolicy: siteCollections.readPolicy })
    .from(siteCollections)
    .where(and(eq(siteCollections.siteId, siteId), eq(siteCollections.name, name), eq(siteCollections.tenantId, tenantId)))
    .limit(1);
  if (!collection) return { ok: false, status: 404, error: 'Unknown collection.' };
  if (collection.readPolicy !== 'owner') {
    // 404, not 403: whether a collection allows reads is not something an
    // unauthorised caller should be able to enumerate.
    return { ok: false, status: 404, error: 'Unknown collection.' };
  }

  const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 200);
  const rows = await db
    .select({ id: siteRecords.id, payload: siteRecords.payload, createdAt: siteRecords.createdAt })
    .from(siteRecords)
    .where(scopedToTenant(siteRecords, tenantId, eq(siteRecords.collectionId, collection.id), eq(siteRecords.siteUserId, siteUserId)))
    .orderBy(desc(siteRecords.createdAt))
    .limit(limit);

  return {
    ok: true,
    records: rows.map((row) => ({
      id: Number(row.id),
      payload: (row.payload ?? {}) as Record<string, unknown>,
      createdAt: new Date(row.createdAt).toISOString(),
    })),
  };
}

/**
 * EVERYTHING THIS PERSON PUT INTO THIS APP — the abandonment remedy.
 *
 * ── WHY IT IGNORES `readPolicy`, WHICH NOTHING ELSE MAY DO ───────────────────────
 * `listOwnedSiteRecords` above refuses a collection whose owner has not opted into
 * owner-scoped reads, and that is right: normally the person who built the app
 * decides what its users may read back, and a platform that overrode them would be
 * handing out data on somebody else's behalf.
 *
 * That reasoning has one exception and this is it. When a hosted listing reaches
 * `released` — the seller stopped operating it, the grace window passed and the
 * read-only window passed too — there is no longer an owner exercising a policy;
 * there is a subscriber who paid for a service that no longer exists and whose data
 * is sitting inside it. The hosted lifecycle promises them an export, and a promise
 * that any collection's default setting can silently void is not a promise.
 *
 * So: NOT a general endpoint, and deliberately not reachable through the normal data
 * routes. The single caller is the subscriber-remedy path, which reaches it only
 * after `resolveHostedLifecycle` says `subscriberMayExport`. Rows belonging to nobody
 * (`site_user_id IS NULL` — an anonymous form post) are never included, because they
 * are not this person's to take.
 *
 * ONE query across every collection, not one per collection: an app with forty forms
 * is forty round-trips otherwise, and this runs while somebody waits for a download.
 */
export interface ExportedCollection {
  collection: string;
  records: OwnedRecordView[];
}

/** Bounded: an export is a courtesy, not a replication channel, and an unbounded
 *  read here is a way to make the worker fetch a table. */
const EXPORT_ROW_CAP = 5_000;

export async function exportOwnedSiteRecords(args: {
  db: Db;
  siteId: number;
  tenantId: number;
  siteUserId: number;
}): Promise<ExportedCollection[]> {
  const { db, siteId, tenantId, siteUserId } = args;
  const rows = await db
    .select({
      collection: siteCollections.name,
      id: siteRecords.id,
      payload: siteRecords.payload,
      createdAt: siteRecords.createdAt,
    })
    .from(siteRecords)
    .innerJoin(siteCollections, eq(siteCollections.id, siteRecords.collectionId))
    .where(scopedToTenant(
      siteRecords,
      tenantId,
      eq(siteCollections.siteId, siteId),
      eq(siteRecords.siteUserId, siteUserId),
    ))
    .orderBy(desc(siteRecords.createdAt))
    .limit(EXPORT_ROW_CAP);

  const byCollection = new Map<string, OwnedRecordView[]>();
  for (const row of rows) {
    const list = byCollection.get(row.collection) ?? [];
    list.push({
      id: Number(row.id),
      payload: (row.payload ?? {}) as Record<string, unknown>,
      createdAt: new Date(row.createdAt).toISOString(),
    });
    byCollection.set(row.collection, list);
  }
  return [...byCollection.entries()].map(([collection, records]) => ({ collection, records }));
}

/** Set a collection's read policy. Owner-side; the tenant decides, never the app. */
export async function setCollectionReadPolicy(
  db: Db,
  tenantId: number,
  collectionId: number,
  policy: 'none' | 'owner',
): Promise<boolean> {
  const updated = await db
    .update(siteCollections)
    .set({ readPolicy: policy, updatedAt: sql`NOW()` })
    .where(and(eq(siteCollections.id, collectionId), eq(siteCollections.tenantId, tenantId)))
    .returning({ id: siteCollections.id });
  return updated.length > 0;
}
