import { describe, expect, it } from 'vitest';
import {
  GRADE_DISAGREEMENT_THRESHOLD,
  buildGradePrompt,
  buildXyzRewritePrompt,
  inventedNumbers,
  missingXyzParts,
  numericFingerprints,
  parseBulletMergeResponse,
  parseGradeResponse,
  parseXyzRewriteResponse,
  planBulletMerge,
  planXyzRewrite,
} from './resumeAiPrompts';
import { scoreResume } from './resumeAnalysis';

/**
 * What these tests defend is the ONE property that separates a résumé tool people can
 * use from one that gets them caught out in an interview: the model may choose words and
 * may not choose facts.
 *
 * Every generative capability in this domain runs its answer back through the verifier in
 * `resumeAiPrompts` before anybody sees it, so the verifier is the thing worth testing —
 * and it is testable without a model precisely because the model call was kept out of it.
 * A fabricated metric is asserted here as a REJECTED rewrite, not as a lower-probability
 * one, because "usually does not lie" is not a property a job seeker can act on.
 */

const RESUME = [
  'Jane Doe',
  'jane@example.com | +1 555 0100',
  '',
  'Summary',
  'Backend engineer working on payments infrastructure.',
  '',
  'Experience',
  'Acme Corp — Senior Engineer, 2021-03 – Present',
  '- Responsible for the payments service and its on-call rotation',
  '- Worked on migrating the billing pipeline',
  '- Reduced checkout latency by 40% by moving settlement off the request path',
  '',
  'Skills',
  'TypeScript, PostgreSQL, Terraform, Kubernetes',
].join('\n');

describe('numeric fingerprints', () => {
  it('reads separators and currency as the same fact as the bare number', () => {
    expect([...numericFingerprints('$1,200 saved')]).toEqual(['1200']);
    expect([...numericFingerprints('40%')]).toEqual(['40']);
  });

  it('does not treat a reworded but unchanged figure as a new claim', () => {
    expect(inventedNumbers('Cut build times 40%', ['Reduced build time by 40%'])).toEqual([]);
  });

  it('names the figure a rewrite added', () => {
    expect(inventedNumbers('Reduced build time by 40%', ['Reduced build time'])).toEqual(['40']);
  });
});

describe('the XYZ reading of a bullet', () => {
  it('flags a passive line as missing all three parts', () => {
    expect(missingXyzParts('Responsible for the payments service')).toEqual(['X', 'Y', 'Z']);
  });

  it('passes a line that owns the verb, carries a number and names the method', () => {
    expect(missingXyzParts('Reduced checkout latency by 40% by moving settlement off the request path')).toEqual([]);
  });

  it('is the SAME reading for an original and a rewrite — one definition, not two', () => {
    const original = 'Worked on migrating the billing pipeline';
    const rewrite = 'Migrated the billing pipeline by splitting it into idempotent stages';
    expect(missingXyzParts(original)).toContain('X');
    expect(missingXyzParts(rewrite)).toEqual(['Y']);
  });
});

describe('planXyzRewrite — the deterministic pass', () => {
  it('sends only the bullets that fail, and leaves a complete one alone', () => {
    const brief = planXyzRewrite(RESUME);
    const originals = brief.candidates.map((candidate) => candidate.original);
    expect(originals.some((text) => text.startsWith('Responsible for'))).toBe(true);
    expect(originals.some((text) => text.startsWith('Reduced checkout latency'))).toBe(false);
    expect(brief.alreadyStrong).toBeGreaterThanOrEqual(1);
  });

  it('leads with the weak opener, because that is the line a screener stops at', () => {
    expect(planXyzRewrite(RESUME).candidates[0]?.original).toContain('Responsible for');
  });

  it('collects every number in the document as the evidence a rewrite may use', () => {
    expect(planXyzRewrite(RESUME).evidence).toContain('40');
  });

  it('grounds the prompt on the measured impact score rather than a model opinion', () => {
    const brief = planXyzRewrite(RESUME);
    const { user } = buildXyzRewritePrompt(brief);
    expect(user).toContain(`${brief.score.measured.quantifiedBullets} of ${brief.score.measured.bullets} bullets carry a number`);
  });
});

describe('parseXyzRewriteResponse — the verification pass', () => {
  const brief = planXyzRewrite(RESUME);
  const weak = brief.candidates.find((candidate) => candidate.original.startsWith('Responsible for'))!;

  it('REFUSES a rewrite that invents a metric, and leaves the original standing', () => {
    const reply = JSON.stringify({
      rewrites: [{ id: weak.id, rewritten: 'Cut payment failures by 62% by rebuilding the retry path', missing: [] }],
    });
    const result = parseXyzRewriteResponse(reply, brief);
    const rewrite = result.rewrites.find((entry) => entry.id === weak.id)!;

    expect(rewrite.accepted).toBe(false);
    expect(rewrite.refusedBecause).toBe('invented_metric');
    expect(rewrite.inventedNumbers).toEqual(['62']);
    expect(rewrite.rewritten).toBe('');
    expect(result.refusedForInventedMetric).toBe(1);
    expect(result.instruction).toContain('Ask the person for those numbers');
  });

  it('accepts a rewrite that reuses a figure the résumé already states', () => {
    const reply = JSON.stringify({
      rewrites: [{ id: weak.id, rewritten: 'Owned the payments service and its on-call rotation, cutting latency 40% by re-sequencing settlement', missing: [] }],
    });
    const rewrite = parseXyzRewriteResponse(reply, brief).rewrites.find((entry) => entry.id === weak.id)!;
    expect(rewrite.accepted).toBe(true);
    expect(rewrite.missing).toEqual([]);
  });

  it('re-measures `missing` instead of believing the model\'s claim about it', () => {
    // The model says it supplied the measure. It did not.
    const reply = JSON.stringify({
      rewrites: [{ id: weak.id, rewritten: 'Owned the payments service by running its on-call rotation', missing: [] }],
    });
    const rewrite = parseXyzRewriteResponse(reply, brief).rewrites.find((entry) => entry.id === weak.id)!;
    expect(rewrite.accepted).toBe(true);
    expect(rewrite.missing).toEqual(['Y']);
  });

  it('treats a malformed reply as a refusal, not a crash', () => {
    const result = parseXyzRewriteResponse('I would be happy to help with that!', brief);
    expect(result.accepted).toBe(0);
    expect(result.rewrites.every((rewrite) => rewrite.refusedBecause === 'not_answered')).toBe(true);
    expect(result.rewrites.every((rewrite) => rewrite.ask.length > 0)).toBe(true);
  });
});

describe('bullet consolidation', () => {
  const A = ['Experience', '- Led the migration of the billing pipeline to event sourcing', '- Ran the weekly release train'].join('\n');
  const B = ['Experience', '- Led migration of billing pipeline onto event sourcing', '- Mentored two junior engineers'].join('\n');

  it('groups only what the deterministic consolidation grouped', () => {
    const brief = planBulletMerge([A, B]);
    expect(brief.groups).toHaveLength(1);
    expect(brief.groups[0]?.variants).toHaveLength(2);
  });

  it('carries through the bullets that exist in one source only', () => {
    const result = parseBulletMergeResponse('{}', planBulletMerge([A, B]));
    expect(result.uniqueBullets).toContain('Ran the weekly release train');
    expect(result.uniqueBullets).toContain('Mentored two junior engineers');
  });

  it('refuses a merged line that adds a number no variant contained', () => {
    const brief = planBulletMerge([A, B]);
    const reply = JSON.stringify({ merged: [{ id: 0, merged: 'Led the migration of the billing pipeline to event sourcing in 6 weeks' }] });
    const merged = parseBulletMergeResponse(reply, brief).merged[0]!;
    expect(merged.accepted).toBe(false);
    expect(merged.inventedNumbers).toEqual(['6']);
    expect(merged.fallback.length).toBeGreaterThan(0);
  });

  it('accepts a merge built only from what the variants say', () => {
    const brief = planBulletMerge([A, B]);
    const reply = JSON.stringify({ merged: [{ id: 0, merged: 'Led the migration of the billing pipeline onto event sourcing' }] });
    const merged = parseBulletMergeResponse(reply, brief).merged[0]!;
    expect(merged.accepted).toBe(true);
    expect(merged.merged).toContain('event sourcing');
  });
});

describe('the graded read', () => {
  const score = scoreResume(RESUME);

  it('holds the model to the same five categories the counts already use', () => {
    const { system } = buildGradePrompt(score);
    for (const key of ['ats', 'content', 'keywords', 'format', 'impact']) expect(system).toContain(key);
  });

  it('returns BOTH scores per category rather than an average', () => {
    const reply = JSON.stringify({
      overall: 70,
      categories: [{ key: 'impact', score: score.categories.find((c) => c.key === 'impact')!.score, gaps: [{ gap: 'Two of three bullets describe presence.', costsPoints: 12, evidence: 'Responsible for the payments service' }] }],
    });
    const grade = parseGradeResponse(reply, score);
    const impact = grade.categories.find((category) => category.key === 'impact')!;

    expect(impact.measuredScore).toBe(score.categories.find((c) => c.key === 'impact')!.score);
    expect(impact.modelScore).toBe(impact.measuredScore);
    expect(impact.delta).toBe(0);
    expect(impact.gaps[0]?.gap).toContain('describe presence');
  });

  it('says so plainly when the two readings disagree', () => {
    const measuredAts = score.categories.find((category) => category.key === 'ats')!.score;
    const reply = JSON.stringify({
      overall: Math.max(0, score.overall - GRADE_DISAGREEMENT_THRESHOLD - 5),
      categories: [{ key: 'ats', score: Math.max(0, measuredAts - GRADE_DISAGREEMENT_THRESHOLD - 1), gaps: [] }],
    });
    const grade = parseGradeResponse(reply, score);

    expect(grade.categories.find((category) => category.key === 'ats')?.disagrees).toBe(true);
    expect(grade.disagreements).toHaveLength(1);
    expect(grade.verdict).toContain('disagree');
  });

  it('keeps the measured reading when the model returns nothing usable', () => {
    const grade = parseGradeResponse('', score);
    expect(grade.measured.overall).toBe(score.overall);
    expect(grade.modelOverall).toBeNull();
    expect(grade.categories.every((category) => category.modelScore === null && !category.disagrees)).toBe(true);
    expect(grade.verdict).toContain('only the measured reading stands');
  });
});
