/**
 * The deep pass, as tests.
 *
 * Two things must hold or the hook is worse than not having one: the score can
 * only move DOWN (an agent that failed to look hard enough must never report a
 * project as healthier than its file tree does), and a clean pass must still be
 * recorded as a distinct fact from "nobody has looked yet".
 */
import { describe, expect, it } from 'vitest';
import { mergeAuditFindings } from './auditDeepPass';
import { privacyContentSignals, selectPrivacyProbeFiles } from './auditScanners';
import type { ToolResult } from './toolTypes';

const base: ToolResult = {
  headline: 'Defined — 3.0 / 5',
  summary: 'First-pass signals from the repo tree.',
  score: 3,
  scoreLabel: 'Defined',
  metrics: [{ label: 'Automated tests', value: '100%', tier: 5 }],
  recommendations: [{ title: 'Wire CI', detail: 'Add a CI workflow.' }],
};

describe('mergeAuditFindings', () => {
  it('lowers the score by severity and re-labels the headline to match', () => {
    const merged = mergeAuditFindings(base, [
      { title: 'Secrets in the repo', severity: 'critical', recommendation: 'Rotate and purge history.' },
    ], { auditName: 'SOC 2 Readiness' });

    expect(merged.score).toBe(2);
    // The label and the number come from ONE derivation — a headline that says
    // "Defined" beside a 2.0 is the drift `levelName` is exported to prevent.
    expect(merged.headline).toBe('Managed — 2.0 / 5');
    expect(merged.scoreLabel).toBe('Managed');
  });

  it('never raises a score, however clean the pass', () => {
    const merged = mergeAuditFindings(base, [], { auditName: 'SOC 2 Readiness' });
    expect(merged.score).toBe(3);
    // …but it IS a different report: "somebody looked and found nothing" is not
    // the same fact as "nobody has looked", and only one of them is reassuring.
    expect(merged.summary).toContain('no additional issues');
  });

  it('lets an `info` finding be recorded without moving the number', () => {
    // Otherwise an agent learns to withhold context to protect a score.
    const merged = mergeAuditFindings(base, [
      { title: 'Uses a deprecated lint preset', severity: 'info' },
    ], { auditName: 'Quality' });
    expect(merged.score).toBe(3);
    expect(merged.metrics[0]?.label).toBe('Uses a deprecated lint preset');
  });

  it('floors at 1 rather than going negative on a pile of findings', () => {
    const merged = mergeAuditFindings(base, Array.from({ length: 6 }, (_, i) => ({
      title: `Critical ${i}`, severity: 'critical' as const,
    })), { auditName: 'SOC 2 Readiness' });
    expect(merged.score).toBe(1);
  });

  it('keeps an unscored first pass unscored instead of inventing a number', () => {
    // A repo nobody could read scores nothing. Subtracting from nothing must stay
    // nothing — a deep pass that turned "not scored yet" into a 5 minus penalties
    // would publish a rating derived from no evidence at all.
    const unscored: ToolResult = { ...base, score: null, scoreLabel: null, headline: 'Not scored yet' };
    const merged = mergeAuditFindings(unscored, [{ title: 'X', severity: 'high' }], { auditName: 'Quality' });
    expect(merged.score).toBeNull();
    expect(merged.headline).toBe('Not scored yet');
  });

  it('ranks findings worst-first and puts their recommendations above the first pass', () => {
    const merged = mergeAuditFindings(base, [
      { title: 'Low thing', severity: 'low', recommendation: 'Tidy it.' },
      { title: 'Critical thing', severity: 'critical', recommendation: 'Fix it now.' },
    ], { auditName: 'SOC 2 Readiness' });

    expect(merged.metrics.map((m) => m.label).slice(0, 2)).toEqual(['Critical thing', 'Low thing']);
    // Evidence from the code outranks an inference from a file tree, and a reader
    // works top-down.
    expect(merged.recommendations[0]?.title).toBe('Critical thing');
    expect(merged.recommendations.at(-1)?.title).toBe('Wire CI');
  });

  it('treats an unknown severity as medium rather than dropping the finding', () => {
    const merged = mergeAuditFindings(base, [
      { title: 'Odd', severity: 'catastrophic' as never },
    ], { auditName: 'Quality' });
    expect(merged.score).toBe(2.7);
  });

  it('does not list the same recommendation twice when the deep pass repeats a first-pass gap', () => {
    const merged = mergeAuditFindings(base, [
      { title: 'Wire CI', severity: 'medium', recommendation: 'No workflow file runs the tests.' },
    ], { auditName: 'Quality' });
    expect(merged.recommendations.filter((r) => r.title === 'Wire CI')).toHaveLength(1);
    // The deep pass wins the collision: it read the repo.
    expect(merged.recommendations[0]?.detail).toBe('No workflow file runs the tests.');
  });
});

describe('privacy content signals', () => {
  it('confirms a deletion route only when it actually deletes', () => {
    expect(privacyContentSignals([
      { path: 'src/routes/delete-account.ts', content: 'await db.update(users).set({ deleted: true })' },
    ])).toEqual({ deletionRemovesData: false });

    expect(privacyContentSignals([
      { path: 'src/routes/delete-account.ts', content: 'await db.delete(users).where(eq(users.id, id))' },
    ])).toEqual({ deletionRemovesData: true });
  });

  it('says nothing at all about a signal it had no file for', () => {
    // Absent and `false` are different facts: one is "we looked and it is not
    // there", the other is "nobody looked", and the score treats them
    // differently on purpose.
    expect(privacyContentSignals([
      { path: 'src/routes/delete-account.ts', content: 'db.delete(users)' },
    ])).not.toHaveProperty('unsubscribeSuppresses');
  });

  it('confirms an unsubscribe handler only when the answer is durable', () => {
    expect(privacyContentSignals([
      { path: 'app/unsubscribe/page.tsx', content: 'return <p>You have been unsubscribed.</p>' },
    ]).unsubscribeSuppresses).toBe(true);
    expect(privacyContentSignals([
      { path: 'app/unsubscribe/page.tsx', content: 'return <p>Thanks, all done.</p>' },
    ]).unsubscribeSuppresses).toBe(false);
  });

  it('confirms retention only when the purge is bounded by an age', () => {
    expect(privacyContentSignals([
      { path: 'jobs/retention.ts', content: 'await db.delete(logs).where(lt(logs.createdAt, cutoff))' },
    ]).retentionPurges).toBe(true);
    expect(privacyContentSignals([
      { path: 'jobs/retention.ts', content: 'export const RETENTION_DAYS = 90;' },
    ]).retentionPurges).toBe(false);
  });
});

describe('selectPrivacyProbeFiles', () => {
  it('takes one candidate per signal before spending the budget on seconds', () => {
    // A repo with fifty unsubscribe templates must not consume the whole
    // allowance proving one control and leave the other four unverified.
    const paths = [
      ...Array.from({ length: 20 }, (_, i) => `app/unsubscribe/${i}.tsx`),
      'src/routes/delete-account.ts',
      'jobs/retention.ts',
    ];
    const chosen = selectPrivacyProbeFiles(paths);
    expect(chosen).toContain('src/routes/delete-account.ts');
    expect(chosen).toContain('jobs/retention.ts');
  });

  it('ignores files it cannot read a proof out of', () => {
    // A PNG named `delete-account.png` proves nothing and costs a request.
    expect(selectPrivacyProbeFiles(['docs/delete-account.png', 'docs/unsubscribe.pdf'])).toEqual([]);
  });

  it('never exceeds its per-repo read budget', () => {
    const paths = Array.from({ length: 200 }, (_, i) => `src/consent/banner-${i}.ts`);
    expect(selectPrivacyProbeFiles(paths).length).toBeLessThanOrEqual(8);
  });
});
