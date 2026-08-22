/**
 * THE EMPLOYER DIRECTORY — companies, and what people said about them.
 *
 * ── WHY `companies` AND NOT A NEW `employers` TABLE ──────────────────────────
 * `companies` already exists (`schema/investor.ts`) and already carries name,
 * slug, website, sector, country, headcount and an `objectId` into the registry.
 * hired.video's `company_profiles` maps onto `party_role` in the coverage map —
 * i.e. "this company, in the role of employer" — which is the right split: the
 * COMPANY is one row wherever it appears, and being an employer is a role it
 * holds, exactly as being a portfolio company or a customer is. A second table
 * would give this platform two spellings of Acme and let them disagree.
 *
 * ── THE AGGREGATE IS ONE QUERY FOR THE WHOLE PAGE ────────────────────────────
 * A directory of forty employers each showing "4.3 ★ (12 reviews)" is the
 * textbook N+1: forty summary queries behind one list. {@link listEmployers}
 * groups every rating for the page in a single statement and stitches the
 * results in memory, so the cost is one query whatever the page size.
 *
 * ── A COMPANY MUST BE REGISTERED BEFORE IT CAN BE REVIEWED ───────────────────
 * A review is an `annotations` row keyed on `object_id`, which is a real foreign
 * key. So {@link employerObjectId} registers the company in the object registry
 * on first use rather than assuming somebody else did — a company created by the
 * CRM import has no reason to have been registered by the reviews feature.
 */

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { annotations, companies, partyRoles } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { registerObject } from '../kernel/ObjectRegistry';
import { RATING_KIND, summarise, type RatingSummary } from '../reviews/objectReviews';

/** The registry kind an employer is registered under. */
export const COMPANY_OBJECT_KIND = 'company';

/** The `party_roles.role` that says "this company is an employer". */
export const EMPLOYER_ROLE = 'employer';

export interface EmployerCard {
  id: number;
  objectId: string;
  name: string;
  slug: string | null;
  website: string | null;
  sector: string | null;
  country: string | null;
  headcount: number | null;
  rating: RatingSummary;
}

/**
 * Resolve — creating if needed — the registry id a company's reviews hang off.
 *
 * `companies.objectId` is nullable, so this both registers and back-fills the
 * column. Idempotent: `registerObject` upserts on `(tenant, kind, refId)`.
 */
export async function employerObjectId(
  db: Db, env: Env, tenantId: number, companyId: number,
): Promise<string | null> {
  const [row] = await db.select({ id: companies.id, objectId: companies.objectId, name: companies.name })
    .from(companies)
    .where(scopedToTenant(companies, tenantId, eq(companies.id, companyId)))
    .limit(1);
  if (!row) return null;
  if (row.objectId) return row.objectId;

  const object = await registerObject(db, env, {
    tenantId, kind: COMPANY_OBJECT_KIND, refId: row.id,
    domain: 'investor', title: row.name,
  });

  await db.update(companies)
    .set({ objectId: object.id, updatedAt: new Date() })
    .where(scopedToTenant(companies, tenantId, eq(companies.id, companyId)));

  return object.id;
}

/** Mark a company as an employer. The role is what makes it appear in the
 *  directory — a CRM vendor or a portfolio company is not one. */
export async function markAsEmployer(
  db: Db, tenantId: number, companyId: number,
): Promise<void> {
  await db.insert(partyRoles).values({
    tenantId, partyKind: 'company', partyRef: String(companyId),
    role: EMPLOYER_ROLE, status: 'active', startedAt: new Date(),
  }).onConflictDoNothing();
}

/**
 * The directory page.
 *
 * Employers only — companies holding the role — so the investor portfolio and
 * the CRM's vendor list do not turn up under "review your employer".
 */
export async function listEmployers(
  db: Db, env: Env,
  input: { tenantId: number; q?: string; limit?: number },
): Promise<EmployerCard[]> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const q = (input.q ?? '').trim().toLowerCase();

  const rows = await db.select({
    id: companies.id,
    objectId: companies.objectId,
    name: companies.name,
    slug: companies.slug,
    website: companies.website,
    sector: companies.sector,
    country: companies.country,
    headcount: companies.headcount,
  })
    .from(companies)
    .innerJoin(partyRoles, and(
      eq(partyRoles.tenantId, companies.tenantId),
      eq(partyRoles.partyKind, 'company'),
      eq(partyRoles.partyRef, sql`${companies.id}::text`),
      eq(partyRoles.role, EMPLOYER_ROLE),
      eq(partyRoles.status, 'active'),
    ))
    .where(scopedToTenant(
      companies, input.tenantId,
      q ? sql`lower(${companies.name}) like ${`%${q}%`}` : undefined,
    ))
    .orderBy(asc(companies.name))
    .limit(limit);

  if (rows.length === 0) return [];

  // Every company on the page needs an object id before its ratings can be
  // found. Rows registered already cost nothing; the rest are back-filled once.
  const withObjects = await Promise.all(rows.map(async (row) => ({
    ...row,
    objectId: row.objectId ?? await employerObjectId(db, env, input.tenantId, row.id),
  })));

  const objectIds = withObjects.map((r) => r.objectId).filter((id): id is string => !!id);
  const summaries = await ratingSummaries(db, input.tenantId, objectIds);

  return withObjects.flatMap((row) => (row.objectId ? [{
    id: row.id,
    objectId: row.objectId,
    name: row.name,
    slug: row.slug,
    website: row.website,
    sector: row.sector,
    country: row.country,
    headcount: row.headcount,
    rating: summaries.get(row.objectId) ?? summarise([]),
  }] : []));
}

/**
 * Count + mean + distribution for MANY subjects in one statement.
 *
 * This is the function that keeps the directory from being N+1. It groups by
 * `(object_id, value)` and the caller reduces — the same arithmetic
 * `ratingSummary` uses for one subject, from `summarise`, so a page and a detail
 * view can never report different averages for the same employer.
 */
export async function ratingSummaries(
  db: Db, tenantId: number, objectIds: string[],
): Promise<Map<string, RatingSummary>> {
  const result = new Map<string, RatingSummary>();
  if (objectIds.length === 0) return result;

  const rows = await db.select({
    objectId: annotations.objectId,
    value: annotations.value,
    n: sql<string>`count(*)`,
  })
    .from(annotations)
    .where(scopedToTenant(annotations, tenantId, and(
      inArray(annotations.objectId, objectIds),
      eq(annotations.kind, RATING_KIND),
      eq(annotations.status, 'published'),
      isNull(annotations.deletedAt),
    )!))
    .groupBy(annotations.objectId, annotations.value);

  const buckets = new Map<string, Array<{ score: number; n: number }>>();
  for (const row of rows) {
    const list = buckets.get(row.objectId) ?? [];
    list.push({ score: Math.round(Number(row.value ?? 0)), n: Number(row.n) });
    buckets.set(row.objectId, list);
  }

  for (const objectId of objectIds) {
    result.set(objectId, summarise(buckets.get(objectId) ?? []));
  }
  return result;
}

/** One employer, by id. */
export async function getEmployer(
  db: Db, env: Env, tenantId: number, companyId: number,
): Promise<EmployerCard | null> {
  const [row] = await db.select()
    .from(companies)
    .where(scopedToTenant(companies, tenantId, eq(companies.id, companyId)))
    .limit(1);
  if (!row) return null;

  const objectId = row.objectId ?? await employerObjectId(db, env, tenantId, companyId);
  if (!objectId) return null;

  const summaries = await ratingSummaries(db, tenantId, [objectId]);
  return {
    id: row.id,
    objectId,
    name: row.name,
    slug: row.slug,
    website: row.website,
    sector: row.sector,
    country: row.country,
    headcount: row.headcount,
    rating: summaries.get(objectId) ?? summarise([]),
  };
}
