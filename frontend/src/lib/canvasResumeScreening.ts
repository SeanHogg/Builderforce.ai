/**
 * Screening at RATIO — N résumés ranked against ONE posting, with the reason for each rank.
 *
 * ── WHAT THIS ADDS TO `canvasResumeAts.ts` ───────────────────────────────────────
 * `analyzeResumeAgainstJob(document, jobDescription)` takes ONE résumé and ONE job
 * description and returns one coverage score. That is the candidate's tool — "how does
 * my CV read against this ad" — and it is genuinely good at it. It is not the
 * recruiter's tool: a real screen is 200 résumés against one requisition, and it has to
 * come out ORDERED, with a defensible reason per position, because the output of a
 * screen is a set of rejections somebody may have to justify.
 *
 * This module is the N:1 half. It composes the existing analyzer rather than replacing
 * it — the keyword coverage stays exactly what it was, and is one of four signals
 * instead of the only one.
 *
 * ── WHY FOUR SIGNALS, AND WHY THEY ARE NAMED ─────────────────────────────────────
 * Keyword overlap alone produces the two failures that make an ATS score untrustworthy
 * to the person relying on it:
 *
 *   1. THE KEYWORD-STUFFED CV WINS. A skills section listing forty technologies covers
 *      every term in the ad and evidences none of them. `evidenceRatio` is the counter:
 *      a term that appears in a dated role's description is worth more than one that
 *      appears only in a list, because the first is a claim about work done.
 *   2. "5 YEARS OF A 3-YEAR-OLD LIBRARY." Seniority and recency are invisible to a bag
 *      of words, so a graduate who used a tool in a module ranks with a lead who ran it
 *      in production. `seniorityFit` reads the ad's stated level against the résumé's
 *      actual span; `recency` decays a match by how long ago the role using it ended.
 *
 * All four are reported separately and the weights are declared as data. That is the
 * whole design: a candidate asking "why was I rejected" gets four numbers and the terms
 * behind each, not one opaque percentage. Explainability was already the stated property
 * of the deterministic analyzer, and it is the property most easily lost when a score
 * gains signals.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────────────
 * It does not infer anything the résumé does not say, it does not read any field marked
 * `restricted`, and it does not decide. It ORDERS a pile so a human reads the top of it
 * first, and every row it emits carries the gaps as well as the evidence — because a
 * gap left unstated is how a ranking becomes an unexplained rejection.
 */

import { analyzeResumeAgainstJob, type ResumeAtsAnalysis } from './canvasResumeAts';
import type { CanvasResumeDocument } from './canvasResume';

/** One résumé entering the screen. `ref` is whatever the caller keys candidates by. */
export interface ScreeningCandidate {
  ref: string;
  name: string;
  document: CanvasResumeDocument;
}

/** A screening question whose wrong answer removes a candidate. */
export interface KnockoutQuestion {
  /** The question as it was asked, so a rejection can quote it. */
  question: string;
  /** Answers that PASS. Compared case-insensitively after trimming. */
  accept: readonly string[];
}

export interface ScreeningInput {
  jobDescription: string;
  /** Seniority the posting states — "senior", "staff", "graduate", "lead". Free text:
   *  it is matched by the years it implies, not by an enum every tenant would rename. */
  level?: string;
  knockouts?: readonly KnockoutQuestion[];
  /** `ref` → question → the candidate's answer. */
  answers?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export interface ScreeningSignals {
  /** The existing deterministic keyword coverage, 0-100. */
  coverage: number;
  /** Share of MATCHED terms that appear inside a dated role rather than only in a
   *  skills list, 0-100. The stuffed-CV counter. */
  evidenceRatio: number;
  /** How the résumé's demonstrated span compares to the level the posting asks for,
   *  0-100. 100 is at-or-above; it decays below, and is NOT penalised above — being
   *  over-qualified is a conversation, not a screening failure. */
  seniorityFit: number;
  /** How recently the matched skills were actually used, 0-100. */
  recency: number;
}

export interface ScreeningResult {
  rank: number;
  ref: string;
  candidate: string;
  score: number;
  signals: ScreeningSignals;
  /** What earned the score, in the résumé's own words. */
  evidence: string[];
  /** What the posting asked for and the résumé does not evidence. Required: a gap left
   *  unstated is how a ranking becomes an unexplained rejection. */
  gaps: string[];
  /** Set when a knockout removed them. Scored anyway, so the list can be re-read if the
   *  knockout turns out to have been wrong. */
  knockedOutBy?: { question: string; answer: string };
}

export interface ScreeningReport {
  ranked: ScreeningResult[];
  knockouts: Array<{ candidate: string; question: string; answer: string }>;
  reviewedCount: number;
  /** The method, in a paragraph a rejected candidate could be shown. Generated from the
   *  weights actually used, so it cannot describe a scoring run that did not happen. */
  method: string;
}

/**
 * How much each signal counts. DATA, not branches — changing the emphasis of a screen is
 * changing these four numbers, and `describeMethod` reads the same object, so the
 * explanation cannot drift from the arithmetic.
 */
export const SCREENING_WEIGHTS: Readonly<ScreeningSignals> = {
  coverage: 0.45,
  evidenceRatio: 0.25,
  seniorityFit: 0.2,
  recency: 0.1,
};

/**
 * Years a stated level implies. Deliberately coarse and deliberately overlapping-free:
 * this decides a decay curve, not a hiring bar, and false precision here would be worse
 * than the coarseness.
 */
const LEVEL_YEARS: Readonly<Record<string, number>> = {
  intern: 0, graduate: 0, junior: 1, associate: 2, mid: 3, midlevel: 3,
  senior: 5, lead: 7, staff: 8, principal: 10, director: 12, head: 12, vp: 15,
};

function levelYears(level: string | undefined): number | null {
  if (!level) return null;
  const normalized = level.toLowerCase().replace(/[^a-z]/g, '');
  for (const [key, years] of Object.entries(LEVEL_YEARS)) {
    if (normalized.includes(key)) return years;
  }
  return null;
}

/** The résumé's work history as {text, endYear}, whatever shape the document uses. */
function workEntries(document: CanvasResumeDocument): Array<{ text: string; endYear: number | null }> {
  const work = (document as unknown as Record<string, unknown>).work;
  if (!Array.isArray(work)) return [];
  return work.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const entry = raw as Record<string, unknown>;
    const text = [entry.position, entry.name, entry.summary, ...(Array.isArray(entry.highlights) ? entry.highlights : [])]
      .filter((part) => typeof part === 'string')
      .join(' ');
    // A missing end date on a role means CURRENT, which is the most recent thing a
    // résumé can say. Treating it as unknown-and-therefore-old inverts the signal.
    const end = typeof entry.endDate === 'string' && entry.endDate.trim() ? Number(entry.endDate.slice(0, 4)) : new Date().getFullYear();
    return [{ text, endYear: Number.isFinite(end) ? end : null }];
  });
}

/** Total demonstrated years across dated roles. Overlapping roles are not double
 *  counted — a contractor with three concurrent clients has not lived three careers. */
function demonstratedYears(document: CanvasResumeDocument): number {
  const work = (document as unknown as Record<string, unknown>).work;
  if (!Array.isArray(work)) return 0;
  const spans = work.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const entry = raw as Record<string, unknown>;
    const start = typeof entry.startDate === 'string' ? Number(entry.startDate.slice(0, 4)) : Number.NaN;
    const end = typeof entry.endDate === 'string' && entry.endDate.trim() ? Number(entry.endDate.slice(0, 4)) : new Date().getFullYear();
    return Number.isFinite(start) && Number.isFinite(end) && end >= start ? [[start, end] as const] : [];
  }).sort((a, b) => a[0] - b[0]);

  let total = 0;
  let cursor = -Infinity;
  for (const [start, end] of spans) {
    const from = Math.max(start, cursor);
    if (end > from) { total += end - from; cursor = end; }
  }
  return total;
}

function clamp100(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** The four signals for one résumé against one posting. */
export function screenOne(
  document: CanvasResumeDocument,
  input: ScreeningInput,
): { analysis: ResumeAtsAnalysis; signals: ScreeningSignals; score: number } {
  const analysis = analyzeResumeAgainstJob(document, input.jobDescription);
  const roles = workEntries(document);
  const rolesText = roles.map((role) => role.text.toLowerCase()).join('\n');

  const evidenced = analysis.matchedKeywords.filter((keyword) => rolesText.includes(keyword));
  const evidenceRatio = analysis.matchedKeywords.length
    ? (evidenced.length / analysis.matchedKeywords.length) * 100
    // No matched terms at all is not "perfectly evidenced" — it is nothing to evidence,
    // and a default of 100 would float an irrelevant résumé up the list.
    : 0;

  const wanted = levelYears(input.level);
  const has = demonstratedYears(document);
  const seniorityFit = wanted == null || wanted === 0
    ? 100
    : has >= wanted ? 100 : (has / wanted) * 100;

  const thisYear = new Date().getFullYear();
  // Recency is measured over the roles that actually evidence a matched term: the date
  // of an unrelated recent job says nothing about whether the required skill is current.
  const evidencingYears = roles
    .filter((role) => evidenced.some((keyword) => role.text.toLowerCase().includes(keyword)))
    .map((role) => role.endYear)
    .filter((year): year is number => year != null);
  const mostRecent = evidencingYears.length ? Math.max(...evidencingYears) : null;
  // Full marks within two years, then ten points a year. Six years out still scores 60:
  // stale is a discount, not a disqualification, and a hard cliff at an arbitrary year
  // would make the ranking flip on a rounding.
  const recency = mostRecent == null ? 0 : clamp100(100 - Math.max(0, thisYear - mostRecent - 2) * 10);

  const signals: ScreeningSignals = {
    coverage: clamp100(analysis.score),
    evidenceRatio: clamp100(evidenceRatio),
    seniorityFit: clamp100(seniorityFit),
    recency,
  };

  const score = clamp100(
    signals.coverage * SCREENING_WEIGHTS.coverage
    + signals.evidenceRatio * SCREENING_WEIGHTS.evidenceRatio
    + signals.seniorityFit * SCREENING_WEIGHTS.seniorityFit
    + signals.recency * SCREENING_WEIGHTS.recency,
  );

  return { analysis, signals, score };
}

function knockoutFor(
  candidate: ScreeningCandidate,
  input: ScreeningInput,
): { question: string; answer: string } | null {
  for (const knockout of input.knockouts ?? []) {
    const answer = input.answers?.[candidate.ref]?.[knockout.question];
    // An UNANSWERED knockout is not a failure. A screening question nobody was asked
    // cannot remove anybody, and treating silence as a wrong answer would reject every
    // sourced candidate — none of whom filled in an application form.
    if (answer == null || !answer.trim()) continue;
    const normalized = answer.trim().toLowerCase();
    const passes = knockout.accept.some((accepted) => accepted.trim().toLowerCase() === normalized);
    if (!passes) return { question: knockout.question, answer: answer.trim() };
  }
  return null;
}

/** The method paragraph, generated from the weights actually applied. */
export function describeMethod(input: ScreeningInput): string {
  const parts = [
    `keyword coverage against the posting (${Math.round(SCREENING_WEIGHTS.coverage * 100)}%)`,
    `whether matched terms appear in a dated role rather than only in a skills list (${Math.round(SCREENING_WEIGHTS.evidenceRatio * 100)}%)`,
    `demonstrated years against the level the posting states (${Math.round(SCREENING_WEIGHTS.seniorityFit * 100)}%)`,
    `how recently the matched skills were used (${Math.round(SCREENING_WEIGHTS.recency * 100)}%)`,
  ];
  const level = input.level ? ` The posting was read as "${input.level}".` : '';
  const knockouts = input.knockouts?.length
    ? ` ${input.knockouts.length} screening question(s) were applied; an unanswered question never removes anyone.`
    : '';
  return `Ranked on four declared signals: ${parts.join('; ')}.${level}${knockouts} No demographic, personal or inferred attribute was read, and nothing was added that the résumé does not state. This ordering is a reading order, not a decision.`;
}

/**
 * Rank a pile of résumés against one posting.
 *
 * Ties break on `evidenceRatio` and then on name, so the order is STABLE across runs —
 * a shortlist that reshuffles when nothing changed is a shortlist nobody trusts.
 */
export function screenCandidates(
  candidates: readonly ScreeningCandidate[],
  input: ScreeningInput,
): ScreeningReport {
  const scored = candidates.map((candidate) => {
    const { analysis, signals, score } = screenOne(candidate.document, input);
    const knockedOut = knockoutFor(candidate, input);
    return {
      ref: candidate.ref,
      candidate: candidate.name,
      score,
      signals,
      evidence: analysis.matchedKeywords.slice(0, 8),
      gaps: analysis.missingKeywords.slice(0, 8),
      ...(knockedOut ? { knockedOutBy: knockedOut } : {}),
    };
  });

  const ordered = [...scored].sort((a, b) => {
    // A knocked-out candidate sorts last whatever they scored: they are still shown, and
    // still scored, so the list can be re-read if the knockout turns out to be wrong.
    if (Boolean(a.knockedOutBy) !== Boolean(b.knockedOutBy)) return a.knockedOutBy ? 1 : -1;
    if (b.score !== a.score) return b.score - a.score;
    if (b.signals.evidenceRatio !== a.signals.evidenceRatio) return b.signals.evidenceRatio - a.signals.evidenceRatio;
    return a.candidate.localeCompare(b.candidate);
  });

  return {
    ranked: ordered.map((entry, index) => ({ rank: index + 1, ...entry })),
    knockouts: ordered.flatMap((entry) => (entry.knockedOutBy
      ? [{ candidate: entry.candidate, question: entry.knockedOutBy.question, answer: entry.knockedOutBy.answer }]
      : [])),
    reviewedCount: candidates.length,
    method: describeMethod(input),
  };
}
