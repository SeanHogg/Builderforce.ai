/**
 * Growth-ops invariants (PRD 19 §9 — experimentation, content, page insight,
 * waitlists, onboarding, vocabulary).
 *
 * Every one of these fails a CUSTOMER or a DECISION rather than a build:
 *
 *   - a lift reported before the declared sample is why A/B testing has the
 *     reputation it has;
 *   - traffic that does not total 100 means part of the audience never reaches
 *     the denominator;
 *   - a heatmap without a window blends a page with its own redesign;
 *   - a map drawn over the wrong viewport points at the wrong element;
 *   - inviting somebody twice is what two waitlist features produce;
 *   - a required onboarding step and an optional one must not collapse, or a
 *     tour becomes a wall.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ExperimentError, TEST_STATUSES, isTestStatus } from './experimentation';
import { ContentError, FLOW_STATUSES, OUTREACH_STATUSES, isFlowStatus, isOutreachStatus } from './contentStudio';
import { EMBED_MODES, MIN_HEATMAP_SAMPLES, PageInsightError, isEmbedMode } from './pageInsight';
import { WAITLIST_STATUSES, WaitlistError, isWaitlistStatus } from './waitlist';
import { AUDIENCES, OnboardingError, PROGRESS_STATUSES, isAudience, isProgressStatus } from '../tenant/onboardingFlows';

const read = (p: string) => readFileSync(p, 'utf8').split(String.fromCharCode(13)).join('');
const exp = read(resolve(__dirname, 'experimentation.ts'));
const content = read(resolve(__dirname, 'contentStudio.ts'));
const insight = read(resolve(__dirname, 'pageInsight.ts'));
const wait = read(resolve(__dirname, 'waitlist.ts'));
const onboard = read(resolve(__dirname, '..', 'tenant', 'onboardingFlows.ts'));
const vocab = read(resolve(__dirname, '..', 'kernel', 'platformVocabulary.ts'));
const routes = read(resolve(__dirname, '..', '..', 'presentation', 'routes', 'growthOpsRoutes.ts'));

const fn = (src: string, name: string): string => {
  const at = src.indexOf(`export async function ${name}`);
  expect(at, `${name} should exist`).toBeGreaterThan(-1);
  const rest = src.slice(at + 10);
  const end = rest.indexOf('\nexport ');
  return end === -1 ? rest : rest.slice(0, end);
};

describe('vocabularies are closed and match the schema', () => {
  it('declares every status set', () => {
    expect([...TEST_STATUSES]).toEqual(['draft', 'running', 'stopped', 'concluded']);
    expect([...FLOW_STATUSES]).toEqual(['draft', 'active', 'paused', 'archived']);
    expect([...OUTREACH_STATUSES]).toEqual(['researching', 'pitched', 'booked', 'recorded', 'published', 'declined']);
    expect([...WAITLIST_STATUSES]).toEqual(['waiting', 'invited', 'joined', 'declined']);
    expect([...PROGRESS_STATUSES]).toEqual(['pending', 'in_progress', 'done', 'skipped']);
    expect([...AUDIENCES]).toEqual(['signup', 'invite', 'hire', 'employee', 'freelancer']);
    expect([...EMBED_MODES]).toEqual(['inline', 'modal', 'drawer', 'bubble']);
  });

  it('rejects values outside them', () => {
    expect(isTestStatus('paused')).toBe(false);
    expect(isFlowStatus('active')).toBe(true);
    expect(isOutreachStatus('recorded')).toBe(true);
    expect(isWaitlistStatus('queued')).toBe(false);
    expect(isProgressStatus('skipped')).toBe(true);
    expect(isAudience('partner')).toBe(false);
    expect(isEmbedMode('popup')).toBe(false);
  });

  it('gives every error a status the route returns', () => {
    expect(new ExperimentError('x').status).toBe(400);
    expect(new ContentError('x', 409).status).toBe(409);
    expect(new PageInsightError('x', 404).status).toBe(404);
    expect(new WaitlistError('x').status).toBe(400);
    expect(new OnboardingError('x').status).toBe(400);
  });
});

describe('an A/B result is gated on the declared sample', () => {
  const body = fn(exp, 'variantResults');

  it('treats a test with no declared minimum as underpowered by definition', () => {
    expect(body).toContain('minimum === null || rows.some((r) => r.exposures < minimum)');
  });

  it('returns null lift and null winner while underpowered', () => {
    expect(body).toContain('lift: underpowered');
    expect(body).toContain('winner: underpowered ? null');
  });

  it('says WHY, so a surface can explain the blank', () => {
    expect(body).toContain('No minimum sample was declared');
    expect(body).toContain('has not reached the declared minimum sample');
  });
});

describe('traffic allocation is validated, not assumed', () => {
  const body = fn(exp, 'setVariants');

  it('requires exactly one control', () => {
    expect(body).toContain('exactly one variant must be the control');
  });

  it('requires the split to total 100, with tolerance for thirds', () => {
    expect(body).toContain('Math.abs(total - 100) > 0.05');
    expect(body).toContain('would see nothing and never reach the denominator');
  });

  it('refuses to re-allocate a running test', () => {
    expect(body).toContain('a running test cannot be re-allocated');
  });

  it('replaces variants wholesale inside a transaction', () => {
    expect(body).toContain('db.transaction');
    expect(body).toContain('.delete(abTestVariants)');
  });
});

describe('journey attribution uses the stored weights', () => {
  it('sums attribution rather than counting rows', () => {
    expect(fn(exp, 'journeyFunnel')).toContain('sum(${journeyTouchpoints.attribution})');
    expect(fn(exp, 'channelAttribution')).toContain('sum(${journeyTouchpoints.attribution})');
  });

  it('counts people distinctly, so a chatty channel is not a wide funnel', () => {
    expect(fn(exp, 'journeyFunnel')).toContain('count(distinct coalesce(');
  });

  it('never defaults attribution, because the model is the caller\'s choice', () => {
    const body = fn(exp, 'recordTouchpoint');
    expect(body).toContain('input.attribution === null || input.attribution === undefined ? null');
  });

  it('orders the funnel by the journey\'s own stage list, so empty stages show', () => {
    expect(fn(exp, 'journeyFunnel')).toContain('stages.map((stage) => byStage.get(stage) ??');
  });
});

describe('a heatmap carries its window and its verdict', () => {
  it('requires a valid period', () => {
    expect(fn(insight, 'storeHeatmap')).toContain('periodEnd must be after periodStart');
  });

  it('returns the most recent map rather than merging windows', () => {
    const body = fn(insight, 'heatmapFor');
    expect(body).toContain('desc(marketingHeatmapPages.periodEnd)');
    expect(body).toContain('underpowered');
  });

  it('has a stated floor below which a map is a shape, not a finding', () => {
    expect(MIN_HEATMAP_SAMPLES).toBe(100);
    expect(fn(insight, 'heatmapFor')).toContain('a map is a shape, not a finding');
  });

  it('picks the widest screenshot at or below the requested viewport', () => {
    const body = fn(insight, 'screenshotFor');
    expect(body).toContain('viewportWidth} <= ');
    expect(body).toContain('desc(marketingHeatmapScreenshots.viewportWidth)');
  });
});

describe('embed layout resolves most-specific-first', () => {
  const body = fn(insight, 'layoutFor');

  it('prefers a matching host pattern over the default', () => {
    expect(body).toContain('r.hostPattern && host.includes(r.hostPattern)');
  });

  it('returns null when nothing is placed, rather than defaulting to inline', () => {
    expect(body).toContain('if (rows.length === 0) return null');
  });
});

describe('the two waitlists are one status machine', () => {
  it('only invites rows that are still waiting, so a retry is safe', () => {
    expect(fn(wait, 'inviteFromList')).toContain("eq(waitlistEntries.status, 'waiting')");
    expect(fn(wait, 'inviteRegion')).toContain("eq(regionWaitlist.status, 'waiting')");
  });

  it('closes the loop across BOTH tables in one call', () => {
    const body = fn(wait, 'markOutcome');
    expect(body).toContain('.update(waitlistEntries)');
    expect(body).toContain('.update(regionWaitlist)');
  });

  it('assigns a queue position at insert so it never moves', () => {
    expect(fn(wait, 'joinList')).toContain('max(${waitlistEntries.position}) + 1');
  });

  it('is idempotent on (list, email)', () => {
    expect(fn(wait, 'joinList')).toContain('onConflictDoNothing({ target: [waitlistEntries.listKey, waitlistEntries.email] })');
  });

  it('measures wait time only over people who actually joined', () => {
    expect(fn(wait, 'conversionFunnel')).toContain('filter (where ${waitlistEntries.joinedAt} is not null)');
  });

  it('answers "who is waiting" across both tables', () => {
    const body = fn(wait, 'waitlistOverview');
    expect(body).toContain('.from(waitlistEntries)');
    expect(body).toContain('.from(regionWaitlist)');
  });
});

describe('onboarding gates state, never capability', () => {
  it('reports blocked separately from remaining', () => {
    const body = fn(onboard, 'flowProgress');
    expect(body).toContain('const blocked = remaining.filter((t) => t.isRequired)');
    expect(body).toContain('blocked: blocked.length');
  });

  it('counts an untouched step as pending rather than omitting it', () => {
    expect(fn(onboard, 'flowProgress')).toContain("byTask.get(t.id) ?? 'pending'");
  });

  it('requires a reason for a skip', () => {
    expect(fn(onboard, 'setProgress')).toContain('a skip with no reason teaches nothing');
  });

  it('reports skips apart from completions in the funnel', () => {
    const body = fn(onboard, 'flowFunnel');
    expect(body).toContain("filter (where ${onboardingProgress.status} = 'done')");
    expect(body).toContain("filter (where ${onboardingProgress.status} = 'skipped')");
  });

  it('assembles the definition in three queries, not one per checklist', () => {
    const body = fn(onboard, 'flowDefinition');
    expect(body).toContain('inArray(onboardingTasks.checklistId, ids)');
  });
});

describe('exclusive defaults are enforced by the writer', () => {
  it('brand kit default clears and sets in one transaction', () => {
    const body = fn(content, 'setDefaultBrandKit');
    expect(body).toContain('db.transaction');
    expect(body).toContain('.set({ isDefault: false');
  });

  it('returns null rather than guessing a brand kit', () => {
    expect(fn(content, 'defaultBrandKit')).toContain('return row ?? null');
  });
});

describe('nurture flows are a definition, not a second runner', () => {
  it('refuses an active flow with no steps or entry rule', () => {
    expect(fn(content, 'saveNurtureFlow')).toContain('enrols everybody into nothing');
  });

  it('never enrols or sends', () => {
    expect(content).not.toContain('followUpEnrollments');
    expect(content).not.toContain('sequenceDueSteps');
  });

  it('explains the decision rather than omitting it silently', () => {
    expect(content).toContain('sequenceRunner.ts');
  });
});

describe('the platform vocabulary has exactly one definition', () => {
  it('offers no per-tenant write path to the shared axis', () => {
    // A tenant's own stages are `pipeline_stages`; writing here would stop the
    // axis being shared.
    expect(vocab).not.toContain('.insert(stageLookup)');
    expect(vocab).not.toContain('.update(stageLookup)');
  });

  it('returns unknown stage keys as null rather than echoing the key', () => {
    expect(fn(vocab, 'stageLabel')).toContain('?? null');
  });

  it('keeps unsupported countries visible and makes filtering explicit', () => {
    expect(vocab).toContain('export async function supportedCountries');
    expect(fn(vocab, 'countries')).not.toContain('isSupported, true');
  });

  it('is cached, because it is read constantly and written almost never', () => {
    expect(vocab).toContain('getOrSetCached');
    expect(vocab).toContain('invalidateVocabulary');
  });
});

describe('routing order keeps literal segments reachable', () => {
  it('registers literal paths before their parameterised siblings', () => {
    expect(routes.indexOf("'/journeys/attribution'")).toBeLessThan(routes.indexOf("'/journeys/:id/funnel'"));
    expect(routes.indexOf("'/heatmaps/readable'")).toBeLessThan(routes.indexOf("'/heatmaps/:id/screenshots'"));
    expect(routes.indexOf("'/content/pipeline'")).toBeLessThan(routes.indexOf("router.get('/content'"));
    expect(routes.indexOf("'/podcasts/pipeline'")).toBeLessThan(routes.indexOf("'/podcasts/:id'"));
    expect(routes.indexOf("'/brand/default'")).toBeLessThan(routes.indexOf("'/brand/:id/default'"));
    expect(routes.indexOf("'/waitlist/overview'")).toBeLessThan(routes.indexOf("'/waitlist/:listKey'"));
  });

  it('keeps high-volume surface writes at member and definitions at MANAGER', () => {
    expect(routes).toContain("router.post('/tests/variants/:variantId/exposure', (c)");
    expect(routes).toContain("router.post('/waitlist/join', (c)");
    expect(routes).toContain("router.put('/tests/:id/variants', manager");
    expect(routes).toContain("router.post('/waitlist/regions/:country/open', manager");
  });
});

describe('the merge added no schema', () => {
  it('touches only tables that already existed', () => {
    for (const t of ['abTests', 'abTestVariants', 'abTestSegments', 'customerJourneys', 'journeyTouchpoints']) {
      expect(exp).toContain(t);
    }
    for (const t of ['brandKits', 'marketingContentItems', 'marketingEmails', 'nurtureFlows', 'learnVideos', 'podcastOutreach']) {
      expect(content).toContain(t);
    }
    for (const t of ['marketingHeatmapPages', 'marketingHeatmapScreenshots', 'embedWidgetLayout']) {
      expect(insight).toContain(t);
    }
    expect(wait).toContain('waitlistEntries');
    expect(wait).toContain('regionWaitlist');
    for (const t of ['onboardingFlows', 'onboardingChecklists', 'onboardingTasks', 'onboardingProgress']) {
      expect(onboard).toContain(t);
    }
  });

  it('keeps A/B tests apart from `experiments`, which is a different thing', () => {
    // `experiments` is "a product bet rather than a traffic split" by its own
    // docstring. Merging them gives a qualitative bet a fake p-value.
    expect(exp).not.toContain('from(experiments)');
    expect(exp).toContain('`experiments`');
  });
});
