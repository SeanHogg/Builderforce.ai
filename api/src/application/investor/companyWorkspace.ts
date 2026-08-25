/**
 * The company as a place, not a row (IN-1, IN-3).
 *
 * `companies` has been a registered kind since migration 0422, which gave it
 * generic create/read/update through `domainRoutes` and a seat in the entity
 * browser. What it did not give it was a DESTINATION: a table viewer answers
 * "what columns does this row have", and the founder's question is "what is the
 * state of my raise" — which projects are building this, which investors are in,
 * which diligence answers are still missing, and which seat closes each one.
 *
 * ── WHAT IN-1 ADDED, AND WHY IT IS READ HERE ────────────────────────────────
 * `projects.company_id` (migration 1120). Before it, nothing in `schema/delivery.ts`
 * named a company, so the one-company-to-many-projects edge did not exist and the
 * three things that depend on it could not be built: a pack that enumerates what
 * is being built, a diligence answer that cites the project behind it, and a
 * portfolio that rolls delivery up. {@link linkProjectToCompany} is the write —
 * an explicit act, never a name match — and {@link companyDetail} is the read.
 *
 * ── THE DILIGENCE GAP IS THE RETENTION MECHANIC ─────────────────────────────
 * A REQUIRED `due_diligence_documents` row sitting at `requested` is a hole in
 * the raise, and its checklist's `category` names the seat that closes it. That
 * is the whole loop the buyer framing rests on: the founder meets the CFO seat
 * because an investor asked for a P&L, not because a menu offered one. So a gap
 * is returned with the DOMAIN and SEAT that owns it, from
 * {@link SEAT_FOR_CATEGORY}, rather than as a category string a surface has to
 * re-map — two mappings is how the panel and the pack come to disagree about who
 * owns "commercial".
 *
 * Every read here is tenant-scoped and batched: the list is four queries whatever
 * the company count is, for the same reason `listDataRooms` is four — a per-company
 * fan-out is the N+1 that only shows up once a workspace holds a portfolio.
 */

import { desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  companies,
  dataRooms,
  dueDiligenceChecklists,
  dueDiligenceDocuments,
  investmentOpportunities,
  projects,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { recordActivity, type ActorIdentity } from '../activity/activityLog';
import { registerObject } from '../kernel/ObjectRegistry';
import type { Domain } from '../kernel/ObjectRegistry';

export class CompanyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'CompanyError';
  }
}

/** Verbs this module writes. Named once so a later analytics read and these
 *  writes cannot drift — the failure that leaves a dashboard reading zero. */
export const COMPANY_VERBS = {
  created: 'company.created',
  projectLinked: 'company.project_linked',
  projectUnlinked: 'company.project_unlinked',
} as const;

const TARGET_TYPE = 'company';

/**
 * Which seat closes a diligence gap, by the checklist's own `category`.
 *
 * The five categories are the schema's (`financial | legal | technical |
 * commercial | people`) and the five domains are the roster's, so this is a total
 * function with no default seat — an unrecognised category returns null and is
 * rendered as an unowned gap rather than quietly filed under whichever seat
 * happened to be first.
 *
 * `technical` maps to DELIVERY rather than to governance because a technical
 * diligence question is about the thing being built — the architecture, the
 * release history, the code behind the claim — and `projects`/`releases` are
 * where that evidence lives. Security's `governance` seat owns controls and
 * findings, which is the SOC 2 question, and that arrives as its own checklist.
 */
export const SEAT_FOR_CATEGORY: Readonly<Record<string, { domain: Domain; seat: string }>> = {
  financial:  { domain: 'finance',  seat: 'CFO' },
  legal:      { domain: 'legal',    seat: 'Counsel' },
  technical:  { domain: 'delivery', seat: 'Manager' },
  commercial: { domain: 'revenue',  seat: 'CRO' },
  people:     { domain: 'people',   seat: 'HR' },
};

// ---------------------------------------------------------------------------
// The company's registry identity
// ---------------------------------------------------------------------------

/**
 * The company's `objects` row, created if this row has never had one.
 *
 * `EntityService.afterWrite` registers a company on every entity-layer write but
 * writes the id into `objects`, not back onto `companies.object_id` — so a
 * company created before that path, or through a direct insert, has a registry
 * row and a null column. Everything that hangs off a company as an OBJECT (the
 * company-level investor grant in `companyInvestorAccess.ts`, its memberships,
 * its activity) needs that uuid, and needs it to be the SAME uuid every time.
 *
 * `registerObject` is idempotent on `(tenant, kind, ref)`, so this both resolves
 * and repairs: one insert-or-update, then the column is filled in so the next
 * read is a plain select.
 */
export async function companyObjectId(db: Db, env: Env, tenantId: number, companyId: number): Promise<string> {
  const [row] = await db
    .select({ objectId: companies.objectId, name: companies.name })
    .from(companies)
    .where(scopedToTenant(companies, tenantId, eq(companies.id, companyId)))
    .limit(1);
  if (!row) throw new CompanyError('No company with that id in this workspace.', 404);
  if (row.objectId) return row.objectId;

  const registered = await registerObject(db, env, {
    tenantId,
    kind: 'company',
    refId: companyId,
    domain: 'investor',
    title: row.name,
  });
  await db
    .update(companies)
    .set({ objectId: registered.id, updatedAt: new Date() })
    .where(scopedToTenant(companies, tenantId, eq(companies.id, companyId)));
  return registered.id;
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

export interface CompanySummary {
  id: number;
  objectId: string | null;
  name: string;
  slug: string | null;
  website: string | null;
  stage: string | null;
  sector: string | null;
  country: string | null;
  headcount: number | null;
  arr: string | null;
  valuation: string | null;
  currency: string;
  isPortfolio: boolean;
  /** IN-1: how much delivery this company owns. Zero is a real answer — most
   *  projects predate any company row and were deliberately not backfilled. */
  projectCount: number;
  dataRoomCount: number;
  /** REQUIRED diligence documents still at `requested`. The hole in the raise. */
  openGaps: number;
  /** The live round, when one is open. */
  openRound: CompanyRound | null;
  updatedAt: string;
}

export interface CompanyRound {
  id: number;
  name: string;
  round: string | null;
  askAmount: string | null;
  preMoney: string | null;
  currency: string;
  status: string;
  leadRef: string | null;
  decidedAt: string | null;
  updatedAt: string;
}

/** A round is still being raised while it has not been decided either way. */
const OPEN_ROUND_STATUSES = ['sourced', 'screening', 'diligence', 'ic'] as const;

/**
 * Every company in the workspace, with the four counts a card needs.
 *
 * FIVE queries whatever the company count is — the companies, their projects,
 * their rooms, their open gaps and their open rounds. Each of the four is a
 * grouped read over an indexed path rather than a per-company follow-up.
 */
export async function listCompanies(
  db: Db,
  tenantId: number,
  options: { ids?: readonly number[] } = {},
): Promise<CompanySummary[]> {
  // `ids` narrows the SAME read rather than filtering its result, so reading one
  // company back after a create cannot miss it because the workspace already holds
  // more companies than this list's own limit.
  const narrow = options.ids?.length ? inArray(companies.id, [...options.ids]) : undefined;
  const rows = await db
    .select({
      id: companies.id,
      objectId: companies.objectId,
      name: companies.name,
      slug: companies.slug,
      website: companies.website,
      stage: companies.stage,
      sector: companies.sector,
      country: companies.country,
      headcount: companies.headcount,
      arr: companies.arr,
      valuation: companies.valuation,
      currency: companies.currency,
      isPortfolio: companies.isPortfolio,
      updatedAt: companies.updatedAt,
    })
    .from(companies)
    .where(scopedToTenant(companies, tenantId, narrow))
    .orderBy(desc(companies.updatedAt))
    .limit(200);
  if (!rows.length) return [];

  const ids = rows.map((row) => row.id);
  const [projectCounts, roomCounts, gapCounts, rounds] = await Promise.all([
    db
      .select({ companyId: projects.companyId, count: sql<number>`count(*)::int` })
      .from(projects)
      .where(scopedToTenant(projects, tenantId, inArray(projects.companyId, ids)))
      .groupBy(projects.companyId),
    db
      .select({ companyId: dataRooms.companyId, count: sql<number>`count(*)::int` })
      .from(dataRooms)
      .where(scopedToTenant(dataRooms, tenantId, inArray(dataRooms.companyId, ids)))
      .groupBy(dataRooms.companyId),
    db
      .select({ companyId: dueDiligenceChecklists.companyId, count: sql<number>`count(*)::int` })
      .from(dueDiligenceDocuments)
      .innerJoin(dueDiligenceChecklists, eq(dueDiligenceChecklists.id, dueDiligenceDocuments.checklistId))
      .where(scopedToTenant(
        dueDiligenceDocuments,
        tenantId,
        inArray(dueDiligenceChecklists.companyId, ids),
        eq(dueDiligenceDocuments.required, true),
        eq(dueDiligenceDocuments.status, 'requested'),
      ))
      .groupBy(dueDiligenceChecklists.companyId),
    db
      .select({
        id: investmentOpportunities.id,
        companyId: investmentOpportunities.companyId,
        name: investmentOpportunities.name,
        round: investmentOpportunities.round,
        askAmount: investmentOpportunities.askAmount,
        preMoney: investmentOpportunities.preMoney,
        currency: investmentOpportunities.currency,
        status: investmentOpportunities.status,
        leadRef: investmentOpportunities.leadRef,
        decidedAt: investmentOpportunities.decidedAt,
        updatedAt: investmentOpportunities.updatedAt,
      })
      .from(investmentOpportunities)
      .where(scopedToTenant(
        investmentOpportunities,
        tenantId,
        inArray(investmentOpportunities.companyId, ids),
        inArray(investmentOpportunities.status, [...OPEN_ROUND_STATUSES]),
      ))
      .orderBy(desc(investmentOpportunities.updatedAt))
      .limit(400),
  ]);

  const byCompany = (list: Array<{ companyId: number | null; count: number }>) =>
    new Map(list.filter((row) => row.companyId != null).map((row) => [row.companyId as number, row.count]));
  const projectsBy = byCompany(projectCounts);
  const roomsBy = byCompany(roomCounts);
  const gapsBy = byCompany(gapCounts);
  // Most recently touched wins when a company has several open opportunities —
  // the list is already ordered, so the first hit is that one.
  const roundBy = new Map<number, CompanyRound>();
  for (const row of rounds) {
    if (row.companyId == null || roundBy.has(row.companyId)) continue;
    roundBy.set(row.companyId, toRound(row));
  }

  return rows.map((row) => ({
    id: row.id,
    objectId: row.objectId,
    name: row.name,
    slug: row.slug,
    website: row.website,
    stage: row.stage,
    sector: row.sector,
    country: row.country,
    headcount: row.headcount,
    arr: row.arr,
    valuation: row.valuation,
    currency: row.currency,
    isPortfolio: row.isPortfolio,
    projectCount: projectsBy.get(row.id) ?? 0,
    dataRoomCount: roomsBy.get(row.id) ?? 0,
    openGaps: gapsBy.get(row.id) ?? 0,
    openRound: roundBy.get(row.id) ?? null,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

function toRound(row: {
  id: number; name: string; round: string | null; askAmount: string | null; preMoney: string | null;
  currency: string; status: string; leadRef: string | null; decidedAt: Date | null; updatedAt: Date;
}): CompanyRound {
  return {
    id: row.id,
    name: row.name,
    round: row.round,
    askAmount: row.askAmount,
    preMoney: row.preMoney,
    currency: row.currency,
    status: row.status,
    leadRef: row.leadRef,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Creating one
// ---------------------------------------------------------------------------

export interface CreateCompanyInput {
  name: string;
  website?: string | null;
  stage?: string | null;
  sector?: string | null;
  country?: string | null;
  headcount?: number | null;
  arr?: string | null;
  valuation?: string | null;
  currency?: string | null;
  isPortfolio?: boolean;
  actor: ActorIdentity;
}

/**
 * Create a company and register it in one act.
 *
 * The generic entity path can create a `companies` row too, and does — this is
 * not a second writer of the same fact, it is the same write with the registry
 * step made unconditional. A company created here always has an `object_id`,
 * because everything IN-2 hangs off the company hangs off that uuid, and a
 * grant that cannot find its object is a grant that cannot be minted.
 */
export async function createCompany(db: Db, env: Env, tenantId: number, input: CreateCompanyInput): Promise<CompanySummary> {
  const name = input.name?.trim();
  if (!name) throw new CompanyError('A company needs a name.', 400);
  if (name.length > 255) throw new CompanyError('That name is longer than the column allows (255).', 400);

  const [existing] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(scopedToTenant(companies, tenantId, eq(companies.name, name)))
    .limit(1);
  // `uq_companies_name` would reject this anyway; saying so beats a 500 with a
  // constraint name in it.
  if (existing) throw new CompanyError('This workspace already has a company with that name.', 409);

  const [row] = await db
    .insert(companies)
    .values({
      tenantId,
      name,
      slug: slugify(name),
      website: input.website?.trim() || null,
      stage: input.stage?.trim() || null,
      sector: input.sector?.trim() || null,
      country: input.country?.trim().toUpperCase().slice(0, 2) || null,
      headcount: Number.isFinite(input.headcount) ? (input.headcount as number) : null,
      arr: input.arr ?? null,
      valuation: input.valuation ?? null,
      currency: input.currency?.trim().toUpperCase() || 'USD',
      isPortfolio: input.isPortfolio ?? false,
    })
    .returning({ id: companies.id });
  if (!row) throw new CompanyError('The company could not be created.', 500);

  const objectId = await companyObjectId(db, env, tenantId, row.id);
  await recordActivity(env, db, {
    tenantId,
    actor: input.actor,
    verb: COMPANY_VERBS.created,
    targetType: TARGET_TYPE,
    targetId: String(row.id),
    targetLabel: name,
    objectId,
  });

  const [created] = await listCompanies(db, tenantId, { ids: [row.id] });
  if (!created) throw new CompanyError('The company could not be read back.', 500);
  return created;
}

const slugify = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 200) || 'company';

// ---------------------------------------------------------------------------
// One company, in full
// ---------------------------------------------------------------------------

export interface CompanyProject {
  id: number;
  publicId: string;
  key: string;
  name: string;
  description: string | null;
  status: string;
  updatedAt: string;
}

export interface DiligenceGap {
  documentId: number;
  checklistId: number;
  checklistName: string;
  label: string;
  category: string;
  /** The domain that closes this gap — `null` for a category outside the five,
   *  which renders as unowned rather than being filed under a default seat. */
  domain: Domain | null;
  seat: string | null;
  note: string | null;
  dueAt: string | null;
}

export interface CompanyDetail extends CompanySummary {
  projects: CompanyProject[];
  rooms: Array<{ id: number; name: string; status: string; purpose: string | null; ndaRequired: boolean; watermark: boolean }>;
  rounds: CompanyRound[];
  /** Every REQUIRED document still at `requested`, with the seat that closes it. */
  gaps: DiligenceGap[];
  /** Required documents accepted or provided, over required documents — the
   *  raise's readiness. 0 when nothing is required: an unprepared room, not a
   *  complete one, which is the same call `listDataRooms` makes. */
  readiness: number;
}

export async function companyDetail(db: Db, tenantId: number, companyId: number): Promise<CompanyDetail> {
  const [summary] = await listCompanies(db, tenantId, { ids: [companyId] });
  if (!summary) throw new CompanyError('No company with that id in this workspace.', 404);

  const [projectRows, roomRows, roundRows, documentRows] = await Promise.all([
    db
      .select({
        id: projects.id,
        publicId: projects.publicId,
        key: projects.key,
        name: projects.name,
        description: projects.description,
        status: projects.status,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .where(scopedToTenant(projects, tenantId, eq(projects.companyId, companyId)))
      .orderBy(desc(projects.updatedAt))
      .limit(200),
    db
      .select({
        id: dataRooms.id,
        name: dataRooms.name,
        status: dataRooms.status,
        purpose: dataRooms.purpose,
        ndaRequired: dataRooms.ndaRequired,
        watermark: dataRooms.watermark,
      })
      .from(dataRooms)
      .where(scopedToTenant(dataRooms, tenantId, eq(dataRooms.companyId, companyId)))
      .orderBy(desc(dataRooms.updatedAt))
      .limit(50),
    db
      .select({
        id: investmentOpportunities.id,
        companyId: investmentOpportunities.companyId,
        name: investmentOpportunities.name,
        round: investmentOpportunities.round,
        askAmount: investmentOpportunities.askAmount,
        preMoney: investmentOpportunities.preMoney,
        currency: investmentOpportunities.currency,
        status: investmentOpportunities.status,
        leadRef: investmentOpportunities.leadRef,
        decidedAt: investmentOpportunities.decidedAt,
        updatedAt: investmentOpportunities.updatedAt,
      })
      .from(investmentOpportunities)
      .where(scopedToTenant(investmentOpportunities, tenantId, eq(investmentOpportunities.companyId, companyId)))
      .orderBy(desc(investmentOpportunities.updatedAt))
      .limit(50),
    // Every REQUIRED document on this company's checklists, in one read: the gaps
    // are the `requested` ones and the readiness denominator is all of them, so
    // asking twice would be two queries that can disagree about what is required.
    db
      .select({
        documentId: dueDiligenceDocuments.id,
        checklistId: dueDiligenceChecklists.id,
        checklistName: dueDiligenceChecklists.name,
        label: dueDiligenceDocuments.label,
        category: dueDiligenceChecklists.category,
        status: dueDiligenceDocuments.status,
        note: dueDiligenceDocuments.note,
        dueAt: dueDiligenceChecklists.dueAt,
        position: dueDiligenceDocuments.position,
      })
      .from(dueDiligenceDocuments)
      .innerJoin(dueDiligenceChecklists, eq(dueDiligenceChecklists.id, dueDiligenceDocuments.checklistId))
      .where(scopedToTenant(
        dueDiligenceDocuments,
        tenantId,
        eq(dueDiligenceChecklists.companyId, companyId),
        eq(dueDiligenceDocuments.required, true),
      ))
      .orderBy(dueDiligenceChecklists.category, dueDiligenceDocuments.position)
      .limit(500),
  ]);

  const gaps: DiligenceGap[] = documentRows
    .filter((row) => row.status === 'requested')
    .map((row) => {
      const owner = SEAT_FOR_CATEGORY[row.category];
      return {
        documentId: row.documentId,
        checklistId: row.checklistId,
        checklistName: row.checklistName,
        label: row.label,
        category: row.category,
        domain: owner?.domain ?? null,
        seat: owner?.seat ?? null,
        note: row.note,
        dueAt: row.dueAt ? row.dueAt.toISOString() : null,
      };
    });

  const settled = documentRows.filter((row) => row.status === 'accepted' || row.status === 'provided' || row.status === 'waived');

  return {
    ...summary,
    projects: projectRows.map((row) => ({
      id: row.id,
      publicId: row.publicId,
      key: row.key,
      name: row.name,
      description: row.description,
      status: row.status,
      updatedAt: row.updatedAt.toISOString(),
    })),
    rooms: roomRows,
    rounds: roundRows.map(toRound),
    gaps,
    readiness: documentRows.length ? Math.round((settled.length / documentRows.length) * 100) : 0,
  };
}

// ---------------------------------------------------------------------------
// IN-1's write — a project belongs to a company because somebody said so
// ---------------------------------------------------------------------------

/**
 * Attach a project to a company, or detach it (`companyId: null`).
 *
 * Both sides are checked in this tenant before the write: a project id from
 * another workspace and a company id from another workspace must both fail as
 * "not here" rather than silently writing a pointer across a tenant boundary,
 * which is the one thing a nullable integer with no Drizzle `.references()` does
 * not stop on its own. The database's own FK stops a dangling id; only this stops
 * a WRONG-TENANT id.
 */
export async function linkProjectToCompany(
  db: Db,
  env: Env,
  tenantId: number,
  input: { projectId: number; companyId: number | null; actor: ActorIdentity },
): Promise<void> {
  const [project] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(scopedToTenant(projects, tenantId, eq(projects.id, input.projectId)))
    .limit(1);
  if (!project) throw new CompanyError('No project with that id in this workspace.', 404);

  let objectId: string | null = null;
  let companyName: string | null = null;
  if (input.companyId != null) {
    const [company] = await db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(scopedToTenant(companies, tenantId, eq(companies.id, input.companyId)))
      .limit(1);
    if (!company) throw new CompanyError('No company with that id in this workspace.', 404);
    companyName = company.name;
    objectId = await companyObjectId(db, env, tenantId, company.id);
  }

  await db
    .update(projects)
    .set({ companyId: input.companyId, updatedAt: new Date() })
    .where(scopedToTenant(projects, tenantId, eq(projects.id, input.projectId)));

  await recordActivity(env, db, {
    tenantId,
    actor: input.actor,
    verb: input.companyId == null ? COMPANY_VERBS.projectUnlinked : COMPANY_VERBS.projectLinked,
    targetType: TARGET_TYPE,
    targetId: input.companyId == null ? String(input.projectId) : String(input.companyId),
    targetLabel: companyName ?? project.name,
    ...(objectId ? { objectId } : {}),
    metadata: { projectId: project.id, projectName: project.name, companyId: input.companyId },
  });
}

/**
 * Projects with no company yet — what the "attach a project" picker offers.
 *
 * Deliberately excludes the IDE-storage rows: those exist purely as the backing
 * of a canvas session and are hidden from every other project list, so offering
 * them here would put a founder's scratch board in a fundraising pack.
 */
export async function unassignedProjects(db: Db, tenantId: number): Promise<CompanyProject[]> {
  const rows = await db
    .select({
      id: projects.id,
      publicId: projects.publicId,
      key: projects.key,
      name: projects.name,
      description: projects.description,
      status: projects.status,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(scopedToTenant(
      projects,
      tenantId,
      sql`${projects.companyId} IS NULL`,
      eq(projects.isIdeStorage, false),
    ))
    .orderBy(desc(projects.updatedAt))
    .limit(100);
  return rows.map((row) => ({
    id: row.id,
    publicId: row.publicId,
    key: row.key,
    name: row.name,
    description: row.description,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/**
 * The company's projects, as the pack's evidence (IN-4).
 *
 * Exported separately from {@link companyDetail} because the pack wants only this
 * — and wants it filtered the same way the picker is, so a scratch board that is
 * hidden from the project list cannot appear in a document sent to an investor.
 */
export async function companyProjects(db: Db, tenantId: number, companyId: number): Promise<CompanyProject[]> {
  const rows = await db
    .select({
      id: projects.id,
      publicId: projects.publicId,
      key: projects.key,
      name: projects.name,
      description: projects.description,
      status: projects.status,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(scopedToTenant(
      projects,
      tenantId,
      eq(projects.companyId, companyId),
      eq(projects.isIdeStorage, false),
      isNotNull(projects.companyId),
    ))
    .orderBy(desc(projects.updatedAt))
    .limit(100);
  return rows.map((row) => ({
    id: row.id,
    publicId: row.publicId,
    key: row.key,
    name: row.name,
    description: row.description,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/** Guard a company id from a path segment. Shared so a route cannot hand a NaN
 *  to a query and get "no rows" instead of "that is not an id". */
export function companyIdFrom(raw: string): number {
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) throw new CompanyError('That is not a company id.', 400);
  return Math.floor(id);
}
