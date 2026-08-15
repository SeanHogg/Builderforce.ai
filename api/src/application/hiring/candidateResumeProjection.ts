/**
 * The applicant's résumé, as the EMPLOYER's ATS sees it.
 *
 * ── WHY A PROJECTION AND NOT A JOIN ──────────────────────────────────────────────
 * A person's résumé is theirs: a Canvas object in their own workspace, holding an
 * immutable original and every variant they ever tailored — including the ones aimed at
 * this employer's competitors. An ATS that read it by joining across would therefore be
 * reading a private document store, and would show a recruiter revisions the candidate
 * never sent them.
 *
 * So applying COPIES one revision — the master — into the employer's tenant as a
 * `candidate_resumes` row. That is what the recruiter screens, what the matcher scores,
 * and what survives the candidate later deleting or restyling their résumé, because an
 * application is a record of what was actually submitted on the day it was submitted.
 *
 * This is the demand-side half of the split `application/career/index.ts` describes:
 * career owns the supply side and reasons about it, hiring owns the demand side, and
 * the two are joined by an id and a deliberate copy rather than a shared table.
 */
import { and, eq, sql } from 'drizzle-orm';
import { masterResumeRevision, type CanvasResumeDocument } from '@builderforce/creation-canvas-contract';
import { candidateResumes } from '../../infrastructure/database/schema';
import { readProfileResume } from '../resume/profileResume';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { Db } from '../../infrastructure/database/connection';

/** Years of experience implied by the earliest dated role — the ATS's coarsest filter. */
export function inferYearsOfExperience(document: CanvasResumeDocument, now = new Date()): number | null {
  const starts = (document.work ?? [])
    .map((entry) => (typeof entry.startDate === 'string' ? Number(entry.startDate.slice(0, 4)) : NaN))
    .filter((year) => Number.isFinite(year) && year > 1900 && year <= now.getFullYear());
  if (starts.length === 0) return null;
  const earliest = Math.min(...starts);
  // One decimal place, matching `candidate_resumes.years_exp` numeric(4,1).
  return Math.round(Math.min(60, now.getFullYear() - earliest) * 10) / 10;
}

/** The skill names an ATS filters on, deduplicated and bounded. */
export function resumeSkillNames(document: CanvasResumeDocument): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const skill of document.skills ?? []) {
    const name = typeof skill.name === 'string' ? skill.name.trim() : '';
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= 80) break;
  }
  return names;
}

/**
 * Copy the applicant's master résumé into the employer's tenant.
 *
 * Idempotent on `(tenant, candidate)`: re-applying refreshes the snapshot rather than
 * accumulating one row per application, because a recruiter wants the résumé this
 * person applies with, not a pile of near-identical copies.
 *
 * Never throws. An application must not fail because the applicant has no résumé — a
 * proposal with a cover note and no résumé is a legitimate application, and losing the
 * bid over a projection error would be the worst possible failure mode here.
 */
export async function projectResumeToCandidate(
  db: Db,
  args: { userId: string; tenantId: number; candidateRef: string },
): Promise<{ projected: boolean }> {
  try {
    const resume = await readProfileResume(db, args.userId);
    if (!resume) return { projected: false };
    const revision = masterResumeRevision(resume.family);
    const document = revision.document;
    if (!document) return { projected: false };

    const headline = typeof document.basics?.label === 'string' ? document.basics.label.slice(0, 300) : null;
    const skills = resumeSkillNames(document);
    const yearsExp = inferYearsOfExperience(document);

    await db.insert(candidateResumes)
      .values({
        tenantId: args.tenantId,
        candidateRef: args.candidateRef,
        headline,
        parsed: document,
        skills,
        yearsExp: yearsExp === null ? null : String(yearsExp),
        isPrimary: true,
        parsedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [candidateResumes.tenantId, candidateResumes.candidateRef],
        set: {
          headline: sql`excluded.headline`,
          parsed: sql`excluded.parsed`,
          skills: sql`excluded.skills`,
          yearsExp: sql`excluded.years_exp`,
          parsedAt: sql`excluded.parsed_at`,
          updatedAt: sql`now()`,
        },
      });
    return { projected: true };
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/hiring/candidateResumeProjection.ts',
      operation: 'projectResumeToCandidate',
      context: { userId: args.userId, tenantId: args.tenantId },
    });
    return { projected: false };
  }
}

/** The employer-side résumé snapshot for one candidate, or null. */
export async function readCandidateResume(
  db: Db,
  args: { tenantId: number; candidateRef: string },
): Promise<{ headline: string | null; skills: string[]; yearsExp: number | null; parsed: CanvasResumeDocument } | null> {
  const [row] = await db.select({
    headline: candidateResumes.headline,
    skills: candidateResumes.skills,
    yearsExp: candidateResumes.yearsExp,
    parsed: candidateResumes.parsed,
  }).from(candidateResumes)
    .where(and(
      eq(candidateResumes.tenantId, args.tenantId),
      eq(candidateResumes.candidateRef, args.candidateRef),
    ))
    .limit(1);
  if (!row?.parsed) return null;
  return {
    headline: row.headline ?? null,
    skills: Array.isArray(row.skills) ? (row.skills as string[]) : [],
    yearsExp: row.yearsExp === null ? null : Number(row.yearsExp),
    parsed: row.parsed as CanvasResumeDocument,
  };
}
