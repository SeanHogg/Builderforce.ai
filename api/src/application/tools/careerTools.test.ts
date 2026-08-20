/**
 * The career analyzers, pinned at the two seams that actually break.
 *
 * 1. THE ARTICLE CONTRACT. Fifty-six posts ported from hired.video link to these
 *    URLs by slug. A renamed id does not fail a typecheck and does not fail a
 *    render — it 404s a reader who followed a call to action, which is the exact
 *    failure this whole port exists to end. So the slugs are asserted here as
 *    literals, and changing one is a deliberate act with a redirect attached.
 *
 * 2. EVERY ANALYZER SURVIVES ANY INPUT. These read prose a stranger pastes.
 *    Empty, whitespace, a novel, a single character — none may throw, because a
 *    500 on a public no-account tool is indistinguishable from the product being
 *    broken.
 */
import { describe, it, expect } from 'vitest';
import { CAREER_TOOLS } from './careerTools';
import { getTool, TOOLS } from './toolDefinitions';
import { toDefinition } from './toolTypes';

/** The ids the ported articles link to. Kept as literals deliberately. */
const ARTICLE_SLUGS = [
  'ai-resume-scorer',
  'resume-optimizer',
  'resume-tailor',
  'job-resume-match',
  'skill-extractor',
  'sentiment-analysis',
  'summarize-resume',
  'value-proposition',
  'resume-consolidator',
  'pdf-to-json',
  'profile-audit',
  'career-360',
  'salary-calculator',
  'employer-research',
  'interview-prep',
  'vendor-sync',
] as const;

const SAMPLE_RESUME = `Dana Okafor
Senior Product Manager · Austin, TX

Experience
Fintech Co, 2021–present
- Responsible for managing the payments roadmap across three squads.
- Led migration from a monolith to service-oriented billing, cutting settlement time 40%.
- Ran discovery interviews and shipped a self-serve onboarding flow.

Skills
SQL, product strategy, roadmapping, stakeholder management

Education
BSc Computer Science, 2017`;

const SAMPLE_JOB = `Senior Product Manager, Payments
You will own the payments roadmap end to end, partnering across engineering, risk
and finance. Strong stakeholder management is essential. Experience with ledger
design, chargebacks and PCI scope reduction preferred. Comfortable with Python
and Kubernetes.`;

describe('career tools — the article contract', () => {
  it('registers every id the ported articles link to', () => {
    // A SUPERSET, not an equality, and the difference is deliberate. The failure this
    // guard exists to catch is a RENAMED or DELETED slug, which 404s a reader who
    // followed a call to action — so every article slug must still resolve, forever.
    // An ADDED tool cannot cause that failure: `personal-runway` was the first one no
    // article links to, and asserting equality would have made "ship a free tool the
    // catalogue did not previously have" fail a test whose entire subject is dead links.
    const registered = new Set(CAREER_TOOLS.map((tool) => tool.id));
    for (const slug of ARTICLE_SLUGS) {
      expect(registered.has(slug), `${slug} is linked by a blog post and must stay registered`).toBe(true);
    }
  });

  it('registers each id exactly once', () => {
    // What equality was also buying, kept: two entries under one slug means `getTool`
    // resolves whichever the array happened to reach first.
    const ids = CAREER_TOOLS.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves every article slug through the shared registry', () => {
    for (const slug of ARTICLE_SLUGS) {
      const tool = getTool(slug);
      expect(tool, `${slug} is linked by a blog post and must resolve`).toBeDefined();
      expect(tool!.kind).toBe('analyzer');
      expect(tool!.category).toBe('career');
    }
  });

  it('adds no duplicate ids to the registry', () => {
    const ids = TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('serves a client-safe definition carrying its fields and no analyze fn', () => {
    for (const tool of CAREER_TOOLS) {
      const def = toDefinition(tool);
      expect(def.kind).toBe('analyzer');
      expect((def as { fields: unknown[] }).fields.length).toBeGreaterThan(0);
      // Through `unknown` deliberately: the whole point is to probe for a property the
      // client-safe type does NOT declare, so a direct assertion is one the compiler is
      // right to refuse.
      expect((def as unknown as Record<string, unknown>).analyze).toBeUndefined();
    }
  });

  it('gives every field a label and every select at least one option', () => {
    for (const tool of CAREER_TOOLS) {
      for (const field of tool.fields) {
        expect(field.label, `${tool.id}.${field.id}`).toBeTruthy();
        if (field.type === 'select') {
          expect(field.options?.length, `${tool.id}.${field.id} options`).toBeGreaterThan(0);
        }
      }
      expect(tool.fields.some((f) => f.required), `${tool.id} needs a required field`).toBe(true);
    }
  });
});

describe('career tools — every analyzer survives any input', () => {
  const HOSTILE: Array<[string, string]> = [
    ['empty', ''],
    ['whitespace', '   \n\t  '],
    ['one character', 'x'],
    ['no line breaks', 'a'.repeat(4000)],
    ['punctuation only', '••• --- ,,, ;;; '],
  ];

  for (const tool of CAREER_TOOLS) {
    for (const [label, value] of HOSTILE) {
      it(`${tool.id} handles ${label}`, () => {
        const input = Object.fromEntries(tool.fields.map((f) => [f.id, value]));
        const result = tool.analyze(input);
        expect(result.headline).toBeTruthy();
        expect(Array.isArray(result.metrics)).toBe(true);
        expect(Array.isArray(result.recommendations)).toBe(true);
      });
    }

    it(`${tool.id} handles a missing input map entirely`, () => {
      const result = tool.analyze({});
      expect(result.headline).toBeTruthy();
    });
  }
});

describe('career tools — the readings are real', () => {
  it('scores a résumé and ranks fixes', () => {
    const result = getTool('ai-resume-scorer')!;
    if (result.kind !== 'analyzer') throw new Error('expected analyzer');
    const scored = result.analyze({ resume: SAMPLE_RESUME });
    expect(scored.score).toBeGreaterThan(0);
    expect(scored.score).toBeLessThanOrEqual(100);
    expect(scored.metrics.length).toBeGreaterThan(3);
    // "Responsible for" is a weak opener — the scorer must have something to say.
    expect(scored.recommendations.length).toBeGreaterThan(0);
  });

  it('matches a résumé against a posting and names what is missing', () => {
    const tool = getTool('job-resume-match')!;
    if (tool.kind !== 'analyzer') throw new Error('expected analyzer');
    const match = tool.analyze({ resume: SAMPLE_RESUME, job: SAMPLE_JOB });
    expect(match.score).toBeGreaterThan(0);
    const missing = match.metrics.find((m) => m.label === 'Missing');
    expect(missing, 'the match must report a Missing row').toBeDefined();
    // Only LEXICON skills are matched — "chargebacks" and "PCI" are domain terms
    // the lexicon does not know, and the tool reporting them would be a claim it
    // cannot back. Python and Kubernetes it does know, and the résumé lacks both.
    expect(missing!.value.toLowerCase()).toContain('python');
    expect(missing!.value.toLowerCase()).toContain('kubernetes');
  });

  it('reports per-area coverage as a real percentage', () => {
    const tool = getTool('job-resume-match')!;
    if (tool.kind !== 'analyzer') throw new Error('expected analyzer');
    const match = tool.analyze({ resume: SAMPLE_RESUME, job: SAMPLE_JOB });
    // `byArea.coverage` already arrives 0..100. Multiplying it again rendered
    // "1 of 1 matched" as 10000%, which is how this assertion came to exist.
    for (const metric of match.metrics) {
      const pct = /^(\d+)%$/.exec(metric.value);
      if (pct) expect(Number(pct[1]), metric.label).toBeLessThanOrEqual(100);
    }
  });

  it('is deterministic — the same document always scores the same', () => {
    const tool = getTool('ai-resume-scorer')!;
    if (tool.kind !== 'analyzer') throw new Error('expected analyzer');
    const a = tool.analyze({ resume: SAMPLE_RESUME });
    const b = tool.analyze({ resume: SAMPLE_RESUME });
    expect(a).toEqual(b);
  });

  it('places a figure inside the salary band it models', () => {
    const tool = getTool('salary-calculator')!;
    if (tool.kind !== 'analyzer') throw new Error('expected analyzer');
    const result = tool.analyze({ discipline: 'Product Manager', seniority: 'senior', currentBase: '150000' });
    expect(result.headline).toMatch(/\d/);
    expect(result.metrics.some((m) => m.label === 'Your figure')).toBe(true);
  });

  it('needs both documents before the tailor will run', () => {
    const tool = getTool('resume-tailor')!;
    if (tool.kind !== 'analyzer') throw new Error('expected analyzer');
    expect(tool.analyze({ resume: SAMPLE_RESUME }).headline).toBe('Nothing to read yet');
    expect(tool.analyze({ resume: SAMPLE_RESUME, job: SAMPLE_JOB }).headline).not.toBe('Nothing to read yet');
  });
});
