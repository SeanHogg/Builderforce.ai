import { describe, it, expect } from 'vitest';
import {
  analyzeSalary, compareOffers, compareOptions, compareResumeToJob, computeRunway,
  consolidateResumes, declaredRoleSkillTokens, draftListingFromResume, extractSkills,
  isSkillToken, listingReadiness, normalizeDateToken, optimizeResume, parseResume,
  planForTarget, postingTypesFor, profileBlocks, ROLE_PROFILES, resumeSentiment,
  screenCandidate, scoreResume, suggestTargets, summarizeResume, tailorResume,
  type CareerListing,
} from './index';

/**
 * The property under test throughout is REPRODUCIBILITY. Every reading in this domain is
 * a count over text rather than a model opinion, which is the whole reason a person can
 * act on it — so the tests assert the counts and the boundaries, not vibes.
 */

const RESUME = `Jane Rivera
jane.rivera@example.com | +1 555 0100 | https://github.com/jrivera

Summary
Senior engineer building payment systems.

Experience
Acme Payments — Staff Engineer
2021-03 - Present
- Led the migration of 14 services from Java to TypeScript, cutting p95 latency by 38%
- Built a reconciliation pipeline in Python on PostgreSQL processing 2.4M records nightly
- Responsible for the on-call rotation across three teams
- Mentored 6 engineers, four of whom were promoted

Bolt Retail — Senior Engineer
2018-01 - 2021-02
- Shipped a React and TypeScript checkout used by 400k customers
- Worked on internal tooling

Skills
TypeScript, React, Node.js, PostgreSQL, Docker, Kubernetes, Terraform, AWS

Education
BSc Computer Science
`;

const JOB = `Senior Platform Engineer

We are looking for a senior platform engineer to own our Kubernetes estate.
You will work with Kubernetes, Terraform and AWS daily, and improve our CI/CD.
Experience with Go and observability is required. Our platform team runs the
platform for 200 engineers, and platform reliability is the core of the role.
Kubernetes expertise is essential.

Requirements:
- Deep Kubernetes and Terraform experience
- Strong Go
- Built CI/CD pipelines at scale
`;

describe('resume parsing', () => {
  it('finds contact details, sections, bullets and dates', () => {
    const parsed = parseResume(RESUME);
    expect(parsed.contact.email).toBe('jane.rivera@example.com');
    expect(parsed.contact.phone).toBeTruthy();
    expect(parsed.contact.links).toContain('https://github.com/jrivera');
    expect(parsed.sections.map((s) => s.kind)).toEqual(
      expect.arrayContaining(['summary', 'experience', 'skills', 'education']),
    );
    expect(parsed.bullets.length).toBe(6);
    expect(parsed.dates.length).toBeGreaterThanOrEqual(2);
  });

  it('classifies each bullet as quantified / strong / weak', () => {
    const parsed = parseResume(RESUME);
    const led = parsed.bullets.find((b) => b.text.startsWith('Led the migration'));
    expect(led?.strongOpener).toBe(true);
    expect(led?.quantified).toBe(true);

    const responsible = parsed.bullets.find((b) => b.text.startsWith('Responsible for'));
    expect(responsible?.weakOpener).toBe('responsible for');
    expect(responsible?.quantified).toBe(false);

    const worked = parsed.bullets.find((b) => b.text.startsWith('Worked on'));
    expect(worked?.weakOpener).toBe('worked on');
  });

  it('normalises every date format to YYYY-MM, and Present', () => {
    expect(normalizeDateToken('2021-03')).toBe('2021-03');
    expect(normalizeDateToken('3/2021')).toBe('2021-03');
    expect(normalizeDateToken('Mar 2021')).toBe('2021-03');
    expect(normalizeDateToken('2021')).toBe('2021-01');
    expect(normalizeDateToken('Present')).toBe('Present');
    expect(normalizeDateToken('nonsense')).toBeNull();
    expect(normalizeDateToken(undefined)).toBeNull();
  });

  it('never throws on junk, and reports what it could read', () => {
    for (const junk of ['', '   ', 'x', '\n\n\n', '###', 'a'.repeat(5000)]) {
      const parsed = parseResume(junk);
      expect(parsed.wordCount).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(parsed.bullets)).toBe(true);
    }
  });
});

describe('resume scoring', () => {
  it('is deterministic — the same document always scores the same', () => {
    expect(scoreResume(RESUME).overall).toBe(scoreResume(RESUME).overall);
  });

  it('reports the count behind every category score', () => {
    const score = scoreResume(RESUME);
    expect(score.categories.map((c) => c.key)).toEqual(['ats', 'content', 'keywords', 'format', 'impact']);
    for (const category of score.categories) {
      expect(category.evidence.length).toBeGreaterThan(5);
      expect(category.score).toBeGreaterThanOrEqual(0);
      expect(category.score).toBeLessThanOrEqual(100);
    }
    expect(score.measured.bullets).toBe(6);
    expect(score.measured.weakOpeners).toBe(2);
  });

  it('penalises a document with no email and no structure', () => {
    const bare = 'I worked on things. I helped with stuff. I was responsible for a team.';
    expect(scoreResume(bare).overall).toBeLessThan(scoreResume(RESUME).overall);
    expect(scoreResume(bare).weaknesses.join(' ')).toContain('email');
  });

  it('flags mixed date formats as a formatting problem', () => {
    const mixed = RESUME.replace('2018-01 - 2021-02', 'Jan 2018 - Feb 2021');
    const score = scoreResume(mixed);
    expect(score.measured.dateStyles.length).toBeGreaterThan(1);
    expect(score.weaknesses.join(' ')).toMatch(/format/i);
  });
});

describe('optimize', () => {
  it('anchors every edit to text that exists in the document', () => {
    const { edits } = optimizeResume(RESUME);
    expect(edits.length).toBeGreaterThan(0);
    for (const edit of edits) {
      if (edit.kind === 'rewrite_bullet' || edit.kind === 'shorten_bullet' || edit.kind === 'quantify_bullet') {
        expect(RESUME).toContain(edit.target);
      }
    }
  });

  it('names the job description keywords the résumé lacks', () => {
    const { missingKeywords } = optimizeResume(RESUME, JOB);
    expect(missingKeywords).toContain('Go');
    expect(missingKeywords).not.toContain('Kubernetes'); // the résumé has it
  });

  it('orders high-priority edits first', () => {
    const priorities = optimizeResume(RESUME).edits.map((e) => e.priority);
    const rank = { high: 0, medium: 1, low: 2 } as const;
    for (let i = 1; i < priorities.length; i += 1) {
      expect(rank[priorities[i]!]).toBeGreaterThanOrEqual(rank[priorities[i - 1]!]);
    }
  });
});

describe('job match', () => {
  it('separates matched from missing skills', () => {
    const match = compareResumeToJob(RESUME, JOB);
    expect(match.overlap.matched).toEqual(expect.arrayContaining(['Kubernetes', 'Terraform', 'AWS']));
    expect(match.overlap.missing).toContain('Go');
    expect(match.score).toBeGreaterThan(0);
    expect(match.score).toBeLessThanOrEqual(100);
  });

  it('reports a neutral, self-declaring result when the posting names no skill', () => {
    const vague = 'We want a wonderful person who is passionate and hardworking and kind.';
    const match = compareResumeToJob(RESUME, vague);
    expect(match.evidence.requiredSkillCount).toBe(0);
    expect(match.score).toBe(50);
    expect(match.instruction).toContain('not a measurement');
  });

  it('gives the same score to both sides of the transaction', () => {
    // The seeker's "should I apply" and the employer's screening read must never quote
    // two different numbers for the same pair of documents.
    expect(screenCandidate(RESUME, JOB, 'Deep Kubernetes experience').match.score)
      .toBe(compareResumeToJob(RESUME, JOB).score);
  });
});

describe('screening', () => {
  it('refuses to recommend when the posting states no criteria', () => {
    const result = screenCandidate(RESUME, JOB, '');
    expect(result.recommendation).toBe('insufficient_criteria');
    expect(result.totalCount).toBe(0);
    expect(result.rationale).toContain('nothing to screen against');
  });

  it('judges each stated requirement and cites the evidence', () => {
    const result = screenCandidate(RESUME, JOB, '- Deep Kubernetes and Terraform experience\n- Strong Go\n');
    expect(result.totalCount).toBe(2);
    const k8s = result.criteria.find((c) => c.requirement.includes('Kubernetes'));
    expect(k8s?.met).toBe(true);
    const go = result.criteria.find((c) => c.requirement.includes('Go'));
    expect(go?.met).toBe(false);
    expect(go?.evidence).toBeNull();
  });
});

describe('tailoring', () => {
  it('leads with bullets that already carry the posting vocabulary, unchanged', () => {
    // This résumé's Kubernetes/Terraform/AWS live only in the Skills line, so there is
    // nothing to promote — see `claimedButUnevidenced` below, which is the finding that
    // matters here. A bullet that DOES carry the vocabulary must be promoted verbatim.
    const withEvidence = RESUME.replace(
      '- Worked on internal tooling',
      '- Ran the Kubernetes and Terraform estate for 40 services across three AWS accounts',
    );
    const leads = tailorResume(withEvidence, JOB).moves.filter((m) => m.kind === 'lead_with');
    expect(leads.length).toBeGreaterThan(0);
    for (const move of leads) expect(withEvidence).toContain(move.target);
  });

  it('catches the skill that is listed but never demonstrated', () => {
    // The document that passes the keyword filter and then has nothing to say in the
    // room: every skill the posting wants is in the Skills line and in no achievement.
    const plan = tailorResume(RESUME, JOB);
    expect(plan.claimedButUnevidenced).toEqual(expect.arrayContaining(['Kubernetes', 'Terraform']));
    const move = plan.moves.find((m) => m.kind === 'evidence_claim');
    expect(move?.requirement).toMatch(/take it out of the skills list/i);
  });

  it('never instructs adding an unverified skill without a confirmation step', () => {
    for (const move of tailorResume(RESUME, JOB).moves.filter((m) => m.kind === 'add_keyword')) {
      expect(move.requirement).toMatch(/ask whether|if no, do not add/i);
    }
  });
});

describe('skills', () => {
  it('groups skills and surfaces unrecognised repeated terms', () => {
    const extracted = extractSkills(JOB, 'job');
    expect(extracted.flat).toEqual(expect.arrayContaining(['Kubernetes', 'Terraform']));
    expect(extracted.groups.length).toBeGreaterThan(0);
    expect(extracted.unrecognisedTerms).toContain('platform');
  });
});

describe('consolidation', () => {
  it('keeps every bullet that exists in only one source', () => {
    const other = `Experience\n- Led the migration of 14 services from Java to TypeScript, cutting p95 latency by 38%\n- Negotiated a vendor contract saving $120k annually\n`;
    const merged = consolidateResumes([RESUME, other]);
    expect(merged.duplicateGroups.length).toBeGreaterThan(0);
    expect(merged.uniqueBullets.join(' ')).toContain('Negotiated a vendor contract');
  });
});

describe('sentiment and summary', () => {
  it('flags the passive lines by name', () => {
    const sentiment = resumeSentiment(RESUME);
    expect(sentiment.flagged.map((f) => f.text).join(' ')).toContain('Responsible for');
    expect(sentiment.score).toBeGreaterThanOrEqual(0);
  });

  it('assembles summary evidence without writing prose', () => {
    const summary = summarizeResume(RESUME);
    expect(summary.topSkills.length).toBeGreaterThan(3);
    expect(summary.yearsSpanned).toBeGreaterThan(0);
    for (const bullet of summary.evidenceBullets) expect(RESUME).toContain(bullet);
    expect(summary.brief.instruction).toContain('do not introduce');
  });
});

describe('compensation', () => {
  it('declares that the band is a model rather than market data', () => {
    const analysis = analyzeSalary({ discipline: 'developer', seniority: 'senior', location: 'London' });
    expect(analysis.basis).toContain('DECLARED MODEL');
    expect(analysis.assumptions.length).toBeGreaterThan(3);
    expect(analysis.band.low).toBeLessThan(analysis.band.median);
    expect(analysis.band.median).toBeLessThan(analysis.band.high);
  });

  it('moves the band with seniority and region', () => {
    const junior = analyzeSalary({ discipline: 'developer', seniority: 'junior' }).band.median;
    const senior = analyzeSalary({ discipline: 'developer', seniority: 'senior' }).band.median;
    const sf = analyzeSalary({ discipline: 'developer', seniority: 'senior', location: 'San Francisco' }).band.median;
    expect(senior).toBeGreaterThan(junior);
    expect(sf).toBeGreaterThan(senior);
  });

  it('ranks offers on total effective compensation, not base', () => {
    const result = compareOffers([
      { label: 'Higher base', base: 120_000, costsAnnual: 12_000 },
      { label: 'Lower base', base: 112_000, retirementAnnual: 8_000, benefitsAnnual: 6_000, costsAnnual: 0 },
    ]);
    expect(result.best).toBe('Lower base');
    expect(result.notCounted.join(' ')).toMatch(/tax/i);
  });

  it('says explicitly when no currency conversion was applied', () => {
    const result = compareOffers([
      { label: 'US', currency: 'USD', base: 120_000 },
      { label: 'UK', currency: 'GBP', base: 95_000 },
    ]);
    expect(result.notCounted[0]).toContain('NO exchange rate');
  });
});

describe('runway', () => {
  it('reports weeks to zero and the projection behind it', () => {
    const reading = computeRunway({ savings: 12_000, monthlyExpenses: 3_000 });
    expect(reading.netMonthlyBurn).toBe(3_000);
    expect(reading.monthsRemaining).toBe(4);
    expect(reading.weeksRemaining).toBe(17);
    expect(reading.projection.length).toBe(4);
    expect(reading.pressure).toBe('planning');
  });

  it('has no cliff when income covers expenses', () => {
    const reading = computeRunway({ savings: 5_000, monthlyExpenses: 2_000, monthlyIncome: 2_500 });
    expect(reading.weeksRemaining).toBeNull();
    expect(reading.pressure).toBe('none');
  });

  it('is deterministic — no hidden clock', () => {
    const input = { savings: 9_000, monthlyExpenses: 2_500 };
    expect(computeRunway(input)).toEqual(computeRunway(input));
  });

  it('values a contract that pays sooner over a salary that pays later', () => {
    const comparison = compareOptions(
      { savings: 6_000, monthlyExpenses: 3_000 },
      [
        { label: 'Contract now', kind: 'services', monthlyAmount: 4_000, startsInMonths: 0, durationMonths: 4 },
        { label: 'Salary in four months', kind: 'employment', monthlyAmount: 9_000, startsInMonths: 4 },
      ],
    );
    const contract = comparison.options.find((o) => o.label === 'Contract now')!;
    const salary = comparison.options.find((o) => o.label.startsWith('Salary'))!;
    expect(baselineWeeks(comparison)).toBe(8);
    expect(contract.weeksGained ?? 0).toBeGreaterThan(salary.weeksGained ?? 0);
    expect(contract.searchImpact).toMatch(/consumes/i);
    expect(salary.searchImpact).toMatch(/ends the search/i);
  });
});

function baselineWeeks(c: ReturnType<typeof compareOptions>): number {
  return c.baseline.weeksRemaining ?? -1;
}

describe('career 360', () => {
  it('only references skill tokens the shared lexicon knows', () => {
    // A role profile naming a token the lexicon cannot produce is a destination nobody
    // can ever be ready for — a silent, permanent zero.
    for (const token of declaredRoleSkillTokens()) {
      expect(isSkillToken(token), `role catalogue references unknown skill token "${token}"`).toBe(true);
    }
  });

  it('ranks destinations by what the résumé evidences', () => {
    const { suggestions } = suggestTargets(RESUME, 5);
    expect(suggestions.length).toBe(5);
    for (let i = 1; i < suggestions.length; i += 1) {
      expect(suggestions[i - 1]!.readiness).toBeGreaterThanOrEqual(suggestions[i]!.readiness);
    }
    expect(suggestions[0]!.readiness).toBeGreaterThan(0);
  });

  it('plans against a chosen destination and names the artifact each step produces', () => {
    const plan = planForTarget(RESUME, 'devops-engineer');
    expect('steps' in plan).toBe(true);
    if (!('steps' in plan)) return;
    expect(plan.target.id).toBe('devops-engineer');
    for (const step of plan.steps) expect(step.produces.length).toBeGreaterThan(0);
    expect(plan.steps.some((s) => s.produces === 'jobApplication')).toBe(true);
  });

  it('lists the real targets rather than failing silently on an unknown one', () => {
    const plan = planForTarget(RESUME, 'astronaut');
    expect('error' in plan).toBe(true);
    if ('error' in plan) expect(plan.availableTargets).toEqual(ROLE_PROFILES.map((r) => r.id));
  });
});

describe('listing — one listing, two kinds of demand', () => {
  const base: CareerListing = {
    headline: 'Staff engineer who ships payment systems that reconcile',
    bio: 'x'.repeat(200), discipline: 'developer', skills: ['TypeScript', 'React', 'AWS', 'Docker', 'PostgreSQL'],
    hourlyRateCents: 12_000, currency: 'USD', availability: 'open', location: 'London', timezone: 'GMT',
    published: true, slug: 'jane', avatarKey: 'a.png', resumeFilename: 'jane.pdf',
    seeking: 'both', targetRoles: ['Platform Engineer'], seniority: 'senior',
    desiredSalaryMinCents: 9_000_000, desiredSalaryMaxCents: 12_000_000,
    workMode: 'remote', noticePeriodDays: 30, openToRelocation: false,
  };

  it('offers the right posting types for each seeking mode', () => {
    expect(postingTypesFor('services')).toEqual(['project_bid', 'design']);
    expect(postingTypesFor('employment')).toEqual(['fte']);
    expect(postingTypesFor('both')).toEqual(['project_bid', 'design', 'fte']);
    expect(postingTypesFor('not_looking')).toEqual([]);
  });

  it('grades the two channels separately', () => {
    const readiness = listingReadiness(base);
    expect(readiness.channels.map((c) => c.channel)).toEqual(['services', 'employment']);
    expect(readiness.discoverable).toBe(true);
  });

  it('catches the listing that is strong for clients and invisible to employers', () => {
    // The exact defect the career fields exist to fix: a complete freelancer profile
    // that never says it wants a job, so an employment search never returns it.
    const servicesOnly: CareerListing = { ...base, targetRoles: [], seniority: null, resumeFilename: null };
    const employment = listingReadiness(servicesOnly).channels.find((c) => c.channel === 'employment')!;
    const services = listingReadiness(servicesOnly).channels.find((c) => c.channel === 'services')!;
    expect(services.blocking).toEqual([]);
    expect(employment.blocking.length).toBeGreaterThan(0);
    expect(employment.score).toBeLessThan(services.score);
  });

  it('says nothing is offered when the person is not looking', () => {
    const reading = listingReadiness({ ...base, seeking: 'not_looking' });
    expect(reading.channels).toEqual([]);
    expect(reading.discoverable).toBe(false);
    expect(reading.instruction).toContain('not offered to either demand channel');
  });

  it('derives listing fields from a résumé but never the public prose', () => {
    const draft = draftListingFromResume(RESUME, 'both');
    expect(draft.proposed.skills).toEqual(expect.arrayContaining(['TypeScript', 'Kubernetes']));
    expect(draft.proposed.seniority).toBeTruthy();
    expect(draft.evidence.strongestBullets.length).toBeGreaterThan(0);
    // Briefs, not text: a headline written about someone without sign-off is a
    // stranger's description of them on a public page.
    expect(draft.instruction).toContain('approval');
  });

  it('renders vendor blocks within each vendor limit and flags truncation', () => {
    const long: CareerListing = { ...base, headline: 'H'.repeat(400) };
    const wellfound = profileBlocks(long, 'wellfound');
    const headline = wellfound.blocks.find((b) => b.field === 'headline')!;
    expect(headline.content.length).toBeLessThanOrEqual(wellfound.limits.headline);
    expect(headline.truncated).toBe(true);
    const openTo = wellfound.blocks.find((b) => b.field === 'openTo')!;
    expect(openTo.content).toContain('employment');
    expect(openTo.content).toContain('contract');
  });
});
