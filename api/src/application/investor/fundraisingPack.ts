/**
 * The fundraising pack — the RFP pipeline, entered from the founder's side (IN-4).
 *
 * ── WHY THIS IS NOT A NEW GENERATOR ─────────────────────────────────────────
 * `rfpService.ts` already produces the right SHAPE: a freshness-gated,
 * portfolio-matched, narrative-and-risks document with a P&L, a co-branded
 * self-contained render, and a deterministic fallback for every LLM step. What it
 * did not have was a founder-facing entry point or company-scoped inputs — it is
 * reached as `/projects?tab=rfp` and is addressed to a buyer answering a tender.
 *
 * So this file is a COMPOSER, not a generator. It builds an `rfp_requests` row
 * from the company (IN-1's projects, the open round, the diligence state) and
 * hands it to `generateRfpResponse` unchanged. Forking the pipeline would give
 * the platform two documents that quote different numbers from the same data,
 * which is the failure `renderRfpDocHtml`/`renderRfpDocPdf` already share one body
 * to avoid, one level up.
 *
 * ── THE CLAIM-TO-PROOF LINE, IN THE CODE ────────────────────────────────────
 * No accounting adapter has run against live production data. The P&L this
 * pipeline builds is grounded on the project's historical LLM spend and on
 * DECLARED inputs — effort, blended rate, margin — and it is not read from the
 * founder's books. {@link PACK_GROUNDING} states that in one place, is written
 * into the brief the narrative is generated from, and is returned to the caller so
 * the surface renders it rather than restating it in copy that can drift. Nothing
 * here may describe a number as computed from a ledger until an adapter has run.
 *
 * Nothing here is described as MIGRATED either: no BurnRateOS source rows have
 * moved, and this composes rows this platform wrote.
 */

import { desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { rfpRequests, rfpResponses } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { generateRfpResponse, type RfpGenerateDeps } from '../rfp/rfpService';
import { recordActivity, type ActorIdentity } from '../activity/activityLog';
import {
  CompanyError,
  companyDetail,
  companyObjectId,
  companyProjects,
  SEAT_FOR_CATEGORY,
  type CompanyDetail,
} from './companyWorkspace';

/**
 * What the pack's financial section is actually built from, stated once.
 *
 * Read by the brief the narrative is written from AND returned to the caller, so
 * the document and the surface cannot describe the grounding differently. When an
 * accounting adapter has run against live production data this sentence changes
 * here and changes everywhere.
 */
export const PACK_GROUNDING = {
  /** 'declared' until an accounting adapter has run against live production data. */
  financials: 'declared' as const,
  notice:
    'The financial section is built from declared inputs and from spend this workspace has observed. It is not read from connected accounting books — that grounding is planned, not available.',
} as const;

export const PACK_VERBS = {
  requested: 'company.pack_requested',
} as const;

/** The title every company pack carries, so the RFP list reads as a pack rather
 *  than as a tender response that happens to name a company. */
const packTitle = (companyName: string): string => `Fundraising pack — ${companyName}`;

export interface BuildPackInput {
  companyId: number;
  /** Which project grounds the capability roster. Defaults to the company's most
   *  recently updated project (IN-1); null forces the greenfield path. */
  projectId?: number | null;
  /** Who the pack is addressed to — the lead fund, when there is one. */
  audience?: string | null;
  /** Anything the founder wants the narrative to lead with. */
  emphasis?: string | null;
  actor: ActorIdentity;
  createdBy?: string | null;
}

export interface BuiltPack {
  requestId: string;
  responseId: string | null;
  companyId: number;
  companyName: string;
  /** The project the roster was grounded on, or null on the greenfield path. */
  groundedOnProjectId: number | null;
  /** How many of the company's projects the brief enumerated. */
  projectsCited: number;
  /** REQUIRED diligence documents still at `requested` when the pack was built —
   *  the holes an investor will find, surfaced before they do. */
  openGaps: number;
  grounding: typeof PACK_GROUNDING;
}

/**
 * Compose the brief the pack is generated from.
 *
 * Deliberately a BRIEF and not a template: `rfpService` writes the executive
 * summary, the phase plan and the risks from `requirements`, so what belongs here
 * is the company's own facts in a form the narrative step can read — never a
 * second copy of the document's structure.
 *
 * Every number in it comes off a row. Where a row is empty the line is OMITTED
 * rather than filled with a placeholder: a pack that says "ARR: —" has told an
 * investor something false-looking about a company that simply has not entered it.
 */
export function packBrief(
  company: CompanyDetail,
  projects: Array<{ key: string; name: string; description: string | null; status: string }>,
  emphasis: string | null,
): string {
  const lines: string[] = [];
  lines.push(`${company.name} is raising. This document is the fundraising pack: what the company is, what it is building, and what an investor's diligence will ask for.`);
  lines.push('');

  lines.push('## The company');
  const facts: string[] = [];
  if (company.stage) facts.push(`Stage: ${company.stage}`);
  if (company.sector) facts.push(`Sector: ${company.sector}`);
  if (company.country) facts.push(`Country: ${company.country}`);
  if (company.headcount != null) facts.push(`Headcount: ${company.headcount}`);
  if (company.arr) facts.push(`ARR (declared): ${company.currency} ${company.arr}`);
  if (company.valuation) facts.push(`Valuation (declared): ${company.currency} ${company.valuation}`);
  if (company.website) facts.push(`Website: ${company.website}`);
  lines.push(facts.length ? facts.map((fact) => `- ${fact}`).join('\n') : '- No company facts have been entered yet.');
  lines.push('');

  const round = company.rounds.find((entry) => entry.status !== 'passed' && entry.status !== 'committed') ?? company.rounds[0];
  if (round) {
    lines.push('## The round');
    const terms: string[] = [`- ${round.name}${round.round ? ` (${round.round})` : ''} — status ${round.status}`];
    if (round.askAmount) terms.push(`- Ask: ${round.currency} ${round.askAmount}`);
    if (round.preMoney) terms.push(`- Pre-money (declared): ${round.currency} ${round.preMoney}`);
    lines.push(terms.join('\n'));
    lines.push('');
  }

  if (projects.length) {
    lines.push('## What is being built');
    lines.push(projects
      .map((project) => `- ${project.name} (${project.key}, ${project.status})${project.description ? ` — ${project.description.slice(0, 240)}` : ''}`)
      .join('\n'));
    lines.push('');
  }

  if (company.gaps.length) {
    lines.push('## Diligence still open');
    lines.push('Each line is a REQUIRED document an investor has asked for and has not received. The seat named is the one that closes it.');
    lines.push(company.gaps
      .slice(0, 40)
      .map((gap) => {
        const owner = gap.seat ?? SEAT_FOR_CATEGORY[gap.category]?.seat ?? 'unassigned';
        return `- ${gap.label} (${gap.category}) — ${owner}`;
      })
      .join('\n'));
    lines.push('');
  }

  lines.push('## Grounding');
  lines.push(PACK_GROUNDING.notice);

  if (emphasis?.trim()) {
    lines.push('');
    lines.push('## What to lead with');
    lines.push(emphasis.trim().slice(0, 2000));
  }

  return lines.join('\n');
}

/**
 * Build the pack for one company.
 *
 * The request row is UPSERTED per company rather than accumulated: a founder
 * regenerating the pack after filling a diligence gap wants the same document
 * refreshed, not a seventh row in a list. The RESPONSES still accumulate — every
 * generation is kept, because "what did we send them in March" is a question a
 * raise asks — which is the same split `rfp_requests`/`rfp_responses` already
 * draws for a tender.
 */
export async function buildFundraisingPack(
  deps: RfpGenerateDeps,
  tenantId: number,
  userId: string,
  input: BuildPackInput,
): Promise<BuiltPack> {
  const { db, env } = deps;
  const company = await companyDetail(db, tenantId, input.companyId);
  const projects = await companyProjects(db, tenantId, input.companyId);

  // The grounding project. `undefined` means "pick one"; explicit `null` means the
  // founder chose the greenfield path, and those are different answers.
  const chosen = input.projectId === null
    ? null
    : input.projectId != null
      ? projects.find((project) => project.id === input.projectId) ?? null
      : projects[0] ?? null;
  if (input.projectId != null && !chosen) {
    throw new CompanyError('That project does not belong to this company. Attach it first, or leave the choice out.', 400);
  }

  const requirements = packBrief(company, projects, input.emphasis ?? null);
  const title = packTitle(company.name);

  const [existing] = await db
    .select({ id: rfpRequests.id })
    .from(rfpRequests)
    .where(scopedToTenant(rfpRequests, tenantId, eq(rfpRequests.title, title)))
    .orderBy(desc(rfpRequests.updatedAt))
    .limit(1);

  const values = {
    title,
    // Who it is addressed to. `null` reads as "prospective investors" in the
    // document rather than being invented here.
    requesterOrgName: input.audience?.trim() || null,
    requirements,
    sourceMode: (chosen ? 'existing_project' : 'new') as 'existing_project' | 'new',
    basedOnProjectId: chosen?.id ?? null,
    updatedAt: new Date(),
  };

  let requestId: string;
  if (existing) {
    await db
      .update(rfpRequests)
      .set(values)
      .where(scopedToTenant(rfpRequests, tenantId, eq(rfpRequests.id, existing.id)));
    requestId = existing.id;
  } else {
    const [created] = await db
      .insert(rfpRequests)
      .values({ tenantId, ...values, status: 'draft', createdBy: input.createdBy ?? null })
      .returning({ id: rfpRequests.id });
    if (!created) throw new CompanyError('The pack could not be created.', 500);
    requestId = created.id;
  }

  // The one generator. Every failure inside it degrades to a deterministic path
  // rather than throwing, which is why there is no fallback branch here.
  const result = await generateRfpResponse(deps, { tenantId, requestId, userId });

  const objectId = await companyObjectId(db, env, tenantId, company.id);
  await recordActivity(env, db, {
    tenantId,
    actor: input.actor,
    verb: PACK_VERBS.requested,
    targetType: 'company',
    targetId: String(company.id),
    targetLabel: company.name,
    objectId,
    metadata: {
      requestId,
      responseId: result?.responseId ?? null,
      groundedOnProjectId: chosen?.id ?? null,
      projectsCited: projects.length,
      openGaps: company.gaps.length,
      // The grounding posture travels with the audit trail, so "what was this
      // number read from" is answerable about a document already sent.
      financialsGrounding: PACK_GROUNDING.financials,
    },
  });

  return {
    requestId,
    responseId: result?.responseId ?? null,
    companyId: company.id,
    companyName: company.name,
    groundedOnProjectId: chosen?.id ?? null,
    projectsCited: projects.length,
    openGaps: company.gaps.length,
    grounding: PACK_GROUNDING,
  };
}

export interface PackSummary {
  requestId: string;
  companyId: number;
  title: string;
  status: string;
  updatedAt: string;
  responses: Array<{ id: string; status: string; createdAt: string }>;
  grounding: typeof PACK_GROUNDING;
}

/**
 * The packs built for one company, newest generation first.
 *
 * Matched by the request's TITLE, which this module owns and writes — the same
 * key {@link buildFundraisingPack} upserts on. `rfp_requests` has no company
 * column and does not get one: it is Commerce's table, the pack is one caller of
 * it, and a `company_id` there would put an investor concern inside a pre-sales
 * row for every tenant that never raises.
 */
export async function listCompanyPacks(db: Db, tenantId: number, companyId: number): Promise<PackSummary[]> {
  const company = await companyDetail(db, tenantId, companyId);
  const title = packTitle(company.name);

  const requests = await db
    .select({ id: rfpRequests.id, title: rfpRequests.title, status: rfpRequests.status, updatedAt: rfpRequests.updatedAt })
    .from(rfpRequests)
    .where(scopedToTenant(rfpRequests, tenantId, eq(rfpRequests.title, title)))
    .orderBy(desc(rfpRequests.updatedAt))
    .limit(20);
  if (!requests.length) return [];

  const responses = await db
    .select({ id: rfpResponses.id, requestId: rfpResponses.requestId, status: rfpResponses.status, createdAt: rfpResponses.createdAt })
    .from(rfpResponses)
    .where(scopedToTenant(rfpResponses, tenantId))
    .orderBy(desc(rfpResponses.createdAt))
    .limit(200);

  return requests.map((request) => ({
    requestId: request.id,
    companyId,
    title: request.title,
    status: request.status,
    updatedAt: request.updatedAt.toISOString(),
    responses: responses
      .filter((response) => response.requestId === request.id)
      .map((response) => ({ id: response.id, status: response.status, createdAt: response.createdAt.toISOString() })),
    grounding: PACK_GROUNDING,
  }));
}
