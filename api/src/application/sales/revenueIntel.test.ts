/**
 * Contact-depth and revenue-intelligence invariants (PRD 19 §9).
 *
 * These fail a SELLER or a RECRUITER rather than a build:
 *
 *   - two current roles breaks "who works at X today", which is the query the
 *     experience table exists for;
 *   - averaging inferred and verified compensation produces a number that looks
 *     authoritative and is not;
 *   - a prospect score with no breakdown is one a seller ignores the third time
 *     it is wrong;
 *   - one external id mapping to two canonical records is the duplicate the
 *     whole `ri_ids` table exists to prevent;
 *   - and `ri_sequences` must NOT come back, because Builderforce already runs
 *     cadences on a canvas object and two models is two answers to "what is
 *     about to be sent to this person".
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONFIDENCE_LEVELS, ContactProfileError, isConfidence } from './contactProfile';
import {
  DEAL_FLOW_STATUSES,
  ENTITY_KINDS,
  PROSPECT_STATUSES,
  RevenueIntelError,
  isDealFlowStatus,
  isEntityKind,
  isProspectStatus,
} from './revenueIntelligence';

const read = (p: string) => readFileSync(p, 'utf8').split(String.fromCharCode(13)).join('');
const profile = read(resolve(__dirname, 'contactProfile.ts'));
const intel = read(resolve(__dirname, 'revenueIntelligence.ts'));
const routes = read(resolve(__dirname, '..', '..', 'presentation', 'routes', 'revenueIntelRoutes.ts'));

const fn = (src: string, name: string): string => {
  const at = src.indexOf(`export async function ${name}`);
  expect(at, `${name} should exist`).toBeGreaterThan(-1);
  const rest = src.slice(at + 10);
  const end = rest.indexOf('\nexport ');
  return end === -1 ? rest : rest.slice(0, end);
};

describe('vocabularies match the schema comments', () => {
  it('declares the three confidence levels', () => {
    expect([...CONFIDENCE_LEVELS]).toEqual(['self_reported', 'inferred', 'verified']);
    expect(isConfidence('verified')).toBe(true);
    expect(isConfidence('guessed')).toBe(false);
  });

  it('declares the six prospect statuses and four deal-flow statuses', () => {
    expect([...PROSPECT_STATUSES]).toEqual(['new', 'enriched', 'sequenced', 'engaged', 'converted', 'disqualified']);
    expect([...DEAL_FLOW_STATUSES]).toEqual(['new', 'qualifying', 'converted', 'rejected']);
    expect(isProspectStatus('engaged')).toBe(true);
    expect(isDealFlowStatus('won')).toBe(false);
  });

  it('declares the two entity kinds identity resolution spans', () => {
    expect([...ENTITY_KINDS]).toEqual(['person', 'company']);
    expect(isEntityKind('org')).toBe(false);
  });

  it('gives every error a status the route returns', () => {
    expect(new ContactProfileError('x').status).toBe(400);
    expect(new RevenueIntelError('x', 404).status).toBe(404);
  });
});

describe('exactly one current role', () => {
  const body = fn(profile, 'setExperience');

  it('clears other current roles in the same transaction', () => {
    expect(body).toContain('db.transaction');
    expect(body).toContain('.set({ isCurrent: false })');
  });

  it('rejects a current role with an end date rather than storing the contradiction', () => {
    expect(body).toContain('a current role cannot have an end date');
  });
});

describe('the two reads that pay for the tables exist', () => {
  it('finds alumni by exact company, not a prefix that would merge employers', () => {
    const body = fn(profile, 'alumniOf');
    expect(body).toContain('lower(${contactExperiences.company}) = lower(');
    expect(body).not.toContain('like');
  });

  it('keeps former employees in the alumni result', () => {
    // A former employee is often the better intro.
    expect(fn(profile, 'alumniOf')).not.toContain('eq(contactExperiences.isCurrent, true)');
  });

  it('benchmarks compensation grouped BY confidence rather than across it', () => {
    const body = fn(profile, 'compensationBenchmark');
    expect(body).toContain('groupBy(contactCompensations.confidence');
    expect(body).toContain('confidence: contactCompensations.confidence');
  });

  it('uses a median rather than a mean, because comp is skewed', () => {
    const body = fn(profile, 'compensationBenchmark');
    expect(body).toContain('percentile_cont(0.5)');
    expect(body).not.toContain('avg(');
  });
});

describe('compensation is an observation, not a fact', () => {
  it('appends rather than overwriting a previous observation', () => {
    const body = fn(profile, 'recordCompensation');
    expect(body).toContain('.insert(contactCompensations)');
    expect(body).not.toContain('onConflictDoUpdate');
  });

  it('defaults to inferred, because most of it is', () => {
    expect(fn(profile, 'recordCompensation')).toContain("input.confidence ?? 'inferred'");
  });

  it('is gated at MANAGER on both the read and the write', () => {
    expect(routes).toContain("router.get('/comp-benchmark', manager");
    expect(routes).toContain("router.post('/contacts/:ref/compensation', manager");
  });
});

describe('saved searches are shared, not copied', () => {
  it('joins to the platform search rather than duplicating its criteria', () => {
    expect(fn(profile, 'claimSearch')).toContain('.insert(savedContactSearches)');
    expect(fn(profile, 'searchesFor')).toContain('.innerJoin(savedSearches');
  });

  it('finds unclaimed searches with a LEFT JOIN, not a NOT IN', () => {
    const body = fn(profile, 'unclaimedSearches');
    expect(body).toContain('.leftJoin(savedContactSearches');
    expect(body).toContain('isNull(savedContactSearches.id)');
  });
});

describe('a prospect score is explained', () => {
  const body = fn(intel, 'scoreProspect');

  it('stores the per-criterion contributions beside the total', () => {
    expect(body).toContain('signals: { contributions, earned, possible }');
  });

  it('normalises against achievable weight rather than a fixed maximum', () => {
    expect(body).toContain('possible > 0 ? (earned / possible) * 100 : 0');
  });

  it('matches on equality, not fuzzily', () => {
    expect(body).toContain('norm(expected) === norm(observed)');
  });

  it('refuses an ICP with no criteria', () => {
    expect(fn(intel, 'createIcp')).toContain('scores every prospect identically');
  });

  it('keeps exactly one default ICP, in a transaction', () => {
    const dflt = fn(intel, 'setDefaultIcp');
    expect(dflt).toContain('db.transaction');
    expect(dflt).toContain('.set({ isDefault: false');
  });

  it('can tell whether the ICP predicts anything at all', () => {
    const eff = fn(intel, 'icpEffectiveness');
    expect(eff).toContain('width_bucket');
    expect(eff).toContain('conversionRate');
  });
});

describe('identity resolution keeps one id pointing at one record', () => {
  it('upserts on the unique (tenant, source, source_id) key', () => {
    const body = fn(intel, 'resolveIdentity');
    expect(body).toContain('target: [riIds.tenantId, riIds.source, riIds.sourceId]');
  });

  it('carries confidence, because resolution is often a guess', () => {
    expect(fn(intel, 'resolveIdentity')).toContain('confidence: dec(input.confidence)');
  });

  it('surfaces suspected duplicates for a data-quality sweep', () => {
    const body = fn(intel, 'suspectedDuplicates');
    expect(body).toContain('having(sql`count(*) > 1`)');
  });
});

describe('deal flow stays separate from prospects', () => {
  it('requires a source, so inbound can always be attributed', () => {
    expect(fn(intel, 'recordDealFlow')).toContain('deal flow with no origin cannot be attributed');
  });

  it('reports pipeline and won value separately by source', () => {
    const body = fn(intel, 'dealFlowBySource');
    expect(body).toContain('pipelineValue');
    expect(body).toContain('wonValue');
  });
});

describe('ri_sequences did NOT come across', () => {
  it('is referenced nowhere in the built code', () => {
    // Builderforce runs cadences on a canvas object with a sweep
    // (`sequenceRunner.ts`). A second sequence table would give the platform two
    // answers to "what is about to be sent to this person".
    for (const src of [profile, intel, routes]) {
      expect(src).not.toContain('riSequences');
    }
  });

  it('is explained in the module docstring rather than silently omitted', () => {
    expect(intel).toContain('`ri_sequences`');
    expect(intel).toContain('transform');
  });
});

describe('routing order keeps the literal segments reachable', () => {
  it('registers literal paths before their parameterised siblings', () => {
    expect(routes.indexOf("'/searches-unclaimed'")).toBeLessThan(routes.indexOf("'/searches/:id'"));
    expect(routes.indexOf("'/identities-duplicates'")).toBeLessThan(routes.indexOf("'/identities/:kind/:ref'"));
    expect(routes.indexOf("'/deal-flow-by-source'")).toBeLessThan(routes.indexOf("'/deal-flow/:id'"));
  });
});

describe('the merge added no schema', () => {
  it('touches only tables that already existed', () => {
    for (const t of ['contactExperiences', 'contactEducations', 'contactCompensations', 'savedContactSearches']) {
      expect(profile).toContain(t);
    }
    for (const t of ['riIcps', 'riProspects', 'riIds', 'dealFlowOpportunities']) {
      expect(intel).toContain(t);
    }
  });

  it('leaves the existing contacts owner alone', () => {
    // `contacts` is already feature-reached through SalesWorkspaceService; this
    // adds depth around it rather than a second contact system.
    expect(profile).not.toContain("from(contacts)");
  });
});
