import { describe, expect, it } from 'vitest';
import { describeMethod, screenCandidates, screenOne, SCREENING_WEIGHTS, type ScreeningCandidate } from './canvasResumeScreening';
import type { CanvasResumeDocument } from './canvasResume';

const THIS_YEAR = new Date().getFullYear();

/** A résumé whose skills are EVIDENCED inside dated roles. */
function evidenced(name: string, opts: { startYear: number; endYear?: number } = { startYear: THIS_YEAR - 8 }): ScreeningCandidate {
  return {
    ref: name,
    name,
    document: {
      basics: { name, summary: 'Engineer' },
      work: [{
        name: 'Acme',
        position: 'Senior React Engineer',
        startDate: `${opts.startYear}-01`,
        ...(opts.endYear ? { endDate: `${opts.endYear}-01` } : {}),
        summary: 'Built and shipped React and TypeScript services on Kubernetes',
        highlights: ['Led the GraphQL migration', 'Owned the React design system'],
      }],
    } as unknown as CanvasResumeDocument,
  };
}

/** A résumé that LISTS the same skills and evidences none of them. */
function stuffed(name: string): ScreeningCandidate {
  return {
    ref: name,
    name,
    document: {
      basics: { name, summary: 'React TypeScript Kubernetes GraphQL Postgres Terraform Kafka' },
      skills: [{ name: 'React' }, { name: 'TypeScript' }, { name: 'Kubernetes' }, { name: 'GraphQL' }],
      work: [],
    } as unknown as CanvasResumeDocument,
  };
}

const JOB = `Senior React Engineer
We need deep React and TypeScript experience, GraphQL, and Kubernetes in production.`;

describe('screenOne', () => {
  it('reports four signals rather than one opaque score', () => {
    const { signals, score } = screenOne(evidenced('Ada').document, { jobDescription: JOB, level: 'senior' });
    expect(Object.keys(signals).sort()).toEqual(['coverage', 'evidenceRatio', 'recency', 'seniorityFit']);
    for (const value of Object.values(signals)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
    expect(score).toBeGreaterThan(0);
  });

  it('scores an evidenced résumé above a keyword-stuffed one', () => {
    // The failure that makes an ATS score untrustworthy to the person relying on it: a
    // skills section listing forty technologies covers every term and evidences none.
    const real = screenOne(evidenced('Ada').document, { jobDescription: JOB, level: 'senior' });
    const stuffedScore = screenOne(stuffed('Bob').document, { jobDescription: JOB, level: 'senior' });
    expect(real.signals.evidenceRatio).toBeGreaterThan(stuffedScore.signals.evidenceRatio);
    expect(real.score).toBeGreaterThan(stuffedScore.score);
  });

  it('does not treat "no matched terms" as perfectly evidenced', () => {
    const irrelevant: CanvasResumeDocument = { basics: { name: 'Cy' }, work: [] } as unknown as CanvasResumeDocument;
    expect(screenOne(irrelevant, { jobDescription: JOB }).signals.evidenceRatio).toBe(0);
  });

  it('discounts stale experience without disqualifying it', () => {
    const current = screenOne(evidenced('Now').document, { jobDescription: JOB, level: 'senior' });
    const stale = screenOne(
      evidenced('Then', { startYear: THIS_YEAR - 14, endYear: THIS_YEAR - 8 }).document,
      { jobDescription: JOB, level: 'senior' },
    );
    expect(stale.signals.recency).toBeLessThan(current.signals.recency);
    // Stale is a discount, not a cliff: six years out still scores meaningfully.
    expect(stale.signals.recency).toBeGreaterThan(0);
  });

  it('penalises under-seniority and never penalises over-seniority', () => {
    const junior = screenOne(evidenced('Jun', { startYear: THIS_YEAR - 1 }).document, { jobDescription: JOB, level: 'staff' });
    const over = screenOne(evidenced('Vet', { startYear: THIS_YEAR - 20 }).document, { jobDescription: JOB, level: 'junior' });
    expect(junior.signals.seniorityFit).toBeLessThan(100);
    expect(over.signals.seniorityFit).toBe(100);
  });

  it('does not double-count overlapping roles', () => {
    const contractor: CanvasResumeDocument = {
      basics: { name: 'Dee' },
      work: [
        { name: 'A', position: 'React Engineer', startDate: `${THIS_YEAR - 3}-01`, endDate: `${THIS_YEAR}-01`, summary: 'React TypeScript' },
        { name: 'B', position: 'React Engineer', startDate: `${THIS_YEAR - 3}-01`, endDate: `${THIS_YEAR}-01`, summary: 'React TypeScript' },
      ],
    } as unknown as CanvasResumeDocument;
    // Three concurrent clients is three years of experience, not nine.
    expect(screenOne(contractor, { jobDescription: JOB, level: 'senior' }).signals.seniorityFit).toBeLessThan(100);
  });
});

describe('screenCandidates', () => {
  it('returns a stable, dense ranking with evidence and gaps on every row', () => {
    const report = screenCandidates([stuffed('Bob'), evidenced('Ada')], { jobDescription: JOB, level: 'senior' });
    expect(report.ranked.map((row) => row.rank)).toEqual([1, 2]);
    expect(report.ranked[0]?.candidate).toBe('Ada');
    expect(report.reviewedCount).toBe(2);
    for (const row of report.ranked) {
      expect(Array.isArray(row.evidence)).toBe(true);
      // A gap left unstated is how a ranking becomes an unexplained rejection.
      expect(Array.isArray(row.gaps)).toBe(true);
    }
  });

  it('is deterministic — the same board screened twice gives the same order', () => {
    const input = { jobDescription: JOB, level: 'senior' };
    const first = screenCandidates([evidenced('Ada'), stuffed('Bob')], input);
    const second = screenCandidates([stuffed('Bob'), evidenced('Ada')], input);
    expect(first.ranked.map((row) => row.candidate)).toEqual(second.ranked.map((row) => row.candidate));
  });

  it('sorts a knocked-out candidate last but still scores and shows them', () => {
    const report = screenCandidates([evidenced('Ada'), stuffed('Bob')], {
      jobDescription: JOB,
      knockouts: [{ question: 'Right to work in the EU?', accept: ['yes'] }],
      answers: { Ada: { 'Right to work in the EU?': 'no' } },
    });
    expect(report.ranked.at(-1)?.candidate).toBe('Ada');
    expect(report.ranked.at(-1)?.knockedOutBy?.question).toBe('Right to work in the EU?');
    // Still scored, so the list can be re-read if the knockout turns out to be wrong.
    expect(report.ranked.at(-1)?.score).toBeGreaterThan(0);
    expect(report.knockouts).toHaveLength(1);
  });

  it('never removes somebody who was not asked the question', () => {
    // A sourced candidate has filled in no application form. Treating silence as a wrong
    // answer would reject every one of them.
    const report = screenCandidates([evidenced('Ada')], {
      jobDescription: JOB,
      knockouts: [{ question: 'Right to work in the EU?', accept: ['yes'] }],
    });
    expect(report.knockouts).toHaveLength(0);
    expect(report.ranked[0]?.knockedOutBy).toBeUndefined();
  });
});

describe('describeMethod', () => {
  it('states every weight actually applied, so the explanation cannot drift', () => {
    const method = describeMethod({ jobDescription: JOB, level: 'senior' });
    for (const weight of Object.values(SCREENING_WEIGHTS)) {
      expect(method).toContain(String(Math.round(weight * 100)));
    }
    expect(method).toContain('senior');
    expect(method).toMatch(/reading order, not a decision/i);
    expect(method).toMatch(/No demographic/i);
  });
});
