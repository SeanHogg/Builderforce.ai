/**
 * Academy courses for a founder's business stage (epic #2545 A3).
 *
 * The `course` listing kind already exists in the marketplace registry. What it
 * did not have is a stage: a founder at `companies.business_stage = mvp` should
 * see course listings tagged `mvp`, and enrolling should land on the LMS table
 * that already records every other enrolment — `course_enrollments`, via
 * {@link enrollInCourse}. No second listing family, no `advisor` kind, no
 * marketplace enrolment table.
 *
 * The tag vocabulary is {@link BUSINESS_STAGES} from the contract package
 * (`idea | mvp | early_revenue | growth | scale`). It is not re-declared here,
 * and it is not the freelancer chip set (`start | grow | exit`, query key
 * `stage` — #2586 / #2637). Those tokens are ignored if they appear on a
 * listing. The column read is `companies.business_stage`, never `companies.stage`
 * (that one is the funding / stage-lookup vocabulary).
 */
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import {
  BUSINESS_STAGES,
  isBusinessStage,
  listingKindSpec,
  type BusinessStage,
} from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import { catalogItems, companies, courses } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { enrollInCourse, type CourseEnrollment } from '../learning/pathProgress';

/** Registry id of the existing course listing. Not a new kind. */
const COURSE_LISTING_KIND = listingKindSpec('course')?.id ?? 'course';

const LEARNER_REF_MAX = 64;

export interface StageCourseCard {
  id: string;
  tenantId: number | null;
  slug: string;
  name: string;
  summary: string | null;
  kind: string;
  tags: readonly string[];
  /** The {@link BUSINESS_STAGES} tokens on `tags`, in canonical order. */
  stages: readonly BusinessStage[];
  /** LMS `courses.id` when the listing body names one. Otherwise resolved at enrol. */
  courseId: number | null;
  visibility: string;
  published: boolean;
}

export type StageCourseRefusal = {
  ok: false;
  reason:
    | 'unknown_company'
    | 'no_business_stage'
    | 'unknown_listing'
    | 'not_a_course'
    | 'wrong_stage'
    | 'unpublished'
    | 'untenanted'
    | 'course_unbound'
    | 'learner_required'
    | 'not_published';
  detail: string;
};

/** BUSINESS_STAGES tokens on a listing's tags. Freelancer `start|grow|exit` drop out. */
export function stagesOnListing(tags: unknown): readonly BusinessStage[] {
  const list = Array.isArray(tags) ? tags : [];
  const seen = new Set<BusinessStage>();
  for (const tag of list) {
    if (isBusinessStage(tag)) seen.add(tag);
  }
  return BUSINESS_STAGES.filter((stage) => seen.has(stage));
}

/**
 * A public, published `course` listing whose tags include the founder's stage.
 *
 * `founderStage` is validated: `start` / `grow` / `exit` and anything else
 * outside {@link BUSINESS_STAGES} match nothing, rather than being treated as a
 * stage this module does not own.
 */
export function coursesForFounderStage<T extends {
  kind: string;
  tags: unknown;
  visibility?: string;
  published?: boolean;
}>(listings: readonly T[], founderStage: unknown): T[] {
  if (!isBusinessStage(founderStage)) return [];
  return listings.filter((listing) => courseVisibleAtStage(listing, founderStage));
}

function courseVisibleAtStage(
  listing: { kind: string; tags: unknown; visibility?: string; published?: boolean },
  founderStage: BusinessStage,
): boolean {
  if (listing.kind !== COURSE_LISTING_KIND) return false;
  if (listing.visibility !== undefined && listing.visibility !== 'public') return false;
  if (listing.published === false) return false;
  return stagesOnListing(listing.tags).includes(founderStage);
}

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/** Explicit LMS bind on a listing body. Absent means "resolve via the canvas object". */
export function lmsCourseIdOf(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  return positiveInt((body as { lmsCourseId?: unknown }).lmsCourseId);
}

function sourceObjectId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const source = (body as { source?: { objectId?: unknown } }).source;
  return typeof source?.objectId === 'string' && source.objectId.length > 0 ? source.objectId : null;
}

function asTags(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((tag): tag is string => typeof tag === 'string') : [];
}

interface ListingRow {
  id: string;
  tenantId: number | null;
  slug: string;
  name: string;
  summary: string | null;
  kind: string;
  tags: unknown;
  body: unknown;
  visibility: string;
  publishedAt: Date | string | null;
}

function toCard(row: ListingRow): StageCourseCard {
  return {
    id: row.id,
    tenantId: row.tenantId,
    slug: row.slug,
    name: row.name,
    summary: row.summary,
    kind: row.kind,
    tags: asTags(row.tags),
    stages: stagesOnListing(asTags(row.tags)),
    courseId: lmsCourseIdOf(row.body),
    visibility: row.visibility,
    published: row.publishedAt != null,
  };
}

/** The founder's product stage. `null` when the company is missing or the column is not a BUSINESS_STAGES value. */
export async function founderBusinessStage(
  db: Db,
  tenantId: number,
  companyId: number,
): Promise<{ ok: true; stage: BusinessStage } | StageCourseRefusal> {
  const [row] = await db
    .select({ businessStage: companies.businessStage })
    .from(companies)
    .where(scopedToTenant(companies, tenantId, eq(companies.id, companyId)))
    .limit(1);
  if (!row) {
    return { ok: false, reason: 'unknown_company', detail: 'that company is not in this workspace' };
  }
  if (!isBusinessStage(row.businessStage)) {
    return {
      ok: false,
      reason: 'no_business_stage',
      detail: `business_stage must be one of: ${BUSINESS_STAGES.join(', ')}`,
    };
  }
  return { ok: true, stage: row.businessStage };
}

/**
 * Course listings a founder at this company's business stage can see.
 *
 * The SQL predicate and {@link coursesForFounderStage} name the same tokens.
 * The in-memory pass is what a test can pin without Postgres, and it is also
 * what drops a row whose tags contain the stage only as a non-string, or whose
 * kind is not `course` if the kind filter were ever widened.
 */
export async function listAcademyCoursesForFounder(
  db: Db,
  tenantId: number,
  companyId: number,
): Promise<{ ok: true; stage: BusinessStage; courses: StageCourseCard[] } | StageCourseRefusal> {
  const founder = await founderBusinessStage(db, tenantId, companyId);
  if (!founder.ok) return founder;

  const rows = await db
    .select({
      id: catalogItems.id,
      tenantId: catalogItems.tenantId,
      slug: catalogItems.slug,
      name: catalogItems.name,
      summary: catalogItems.summary,
      kind: catalogItems.kind,
      tags: catalogItems.tags,
      body: catalogItems.body,
      visibility: catalogItems.visibility,
      publishedAt: catalogItems.publishedAt,
    })
    .from(catalogItems)
    .where(acrossTenants(
      catalogItems,
      'public_catalogue',
      eq(catalogItems.kind, COURSE_LISTING_KIND),
      eq(catalogItems.visibility, 'public'),
      isNotNull(catalogItems.publishedAt),
      // Closed vocabulary — `founder.stage` has already passed `isBusinessStage`.
      sql`${catalogItems.tags} @> ${JSON.stringify([founder.stage])}::jsonb`,
    ))
    .orderBy(desc(catalogItems.publishedAt))
    .limit(48);

  const courses = coursesForFounderStage(rows.map(toCard), founder.stage);
  return { ok: true, stage: founder.stage, courses };
}

async function resolveCourseId(
  db: Db,
  tenantId: number,
  body: unknown,
): Promise<number | null> {
  const named = lmsCourseIdOf(body);
  if (named !== null) return named;
  const objectId = sourceObjectId(body);
  if (!objectId) return null;
  const [row] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(scopedToTenant(courses, tenantId, and(
      eq(courses.objectId, objectId),
      eq(courses.kind, 'course'),
      eq(courses.status, 'published'),
    )))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Enrol the founder in one stage-tagged course listing.
 *
 * The listing must be a public published `course` whose tags include the
 * company's `business_stage`. The write goes to {@link enrollInCourse} in the
 * listing's own tenant — that is where the `courses` row lives — with the
 * founder as `learnerRef`. A stage that does not match never reaches that call.
 */
export async function enrolFounderInStageCourse(
  db: Db,
  input: { tenantId: number; companyId: number; listingId: string; learnerRef: string },
): Promise<{ ok: true; stage: BusinessStage; courseId: number; enrollment: CourseEnrollment } | StageCourseRefusal> {
  const learnerRef = input.learnerRef.trim();
  if (!learnerRef || learnerRef.length > LEARNER_REF_MAX) {
    return { ok: false, reason: 'learner_required', detail: 'a learner ref is required' };
  }

  const founder = await founderBusinessStage(db, input.tenantId, input.companyId);
  if (!founder.ok) return founder;

  const [row] = await db
    .select({
      id: catalogItems.id,
      tenantId: catalogItems.tenantId,
      slug: catalogItems.slug,
      name: catalogItems.name,
      summary: catalogItems.summary,
      kind: catalogItems.kind,
      tags: catalogItems.tags,
      body: catalogItems.body,
      visibility: catalogItems.visibility,
      publishedAt: catalogItems.publishedAt,
    })
    .from(catalogItems)
    .where(acrossTenants(catalogItems, 'public_catalogue', eq(catalogItems.id, input.listingId)))
    .limit(1);
  if (!row) {
    return { ok: false, reason: 'unknown_listing', detail: 'that listing is not in the catalogue' };
  }

  const card = toCard(row);
  if (card.kind !== COURSE_LISTING_KIND) {
    return { ok: false, reason: 'not_a_course', detail: 'only a course listing can be enrolled in here' };
  }
  if (card.visibility !== 'public' || !card.published) {
    return { ok: false, reason: 'unpublished', detail: 'a draft course listing cannot be enrolled in' };
  }
  if (!card.stages.includes(founder.stage)) {
    return {
      ok: false,
      reason: 'wrong_stage',
      detail: `this course is not tagged for ${founder.stage}`,
    };
  }
  if (card.tenantId === null) {
    return { ok: false, reason: 'untenanted', detail: 'a platform-owned listing has no LMS course to enrol in' };
  }

  const courseId = await resolveCourseId(db, card.tenantId, row.body);
  if (courseId === null) {
    return { ok: false, reason: 'course_unbound', detail: 'this listing is not bound to a published LMS course' };
  }

  const enrolled = await enrollInCourse(db, {
    tenantId: card.tenantId,
    courseId,
    learnerRef,
  });
  if (!enrolled.ok) {
    return enrolled.reason === 'not_a_course'
      ? { ok: false, reason: 'not_a_course', detail: enrolled.detail }
      : { ok: false, reason: 'not_published', detail: enrolled.detail };
  }
  return { ok: true, stage: founder.stage, courseId, enrollment: enrolled.enrollment };
}
