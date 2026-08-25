/**
 * The last parity batch's invariants (PRD 19 §9 — scheduling, practice, AI ops,
 * people, portfolio, customer surface).
 *
 * Each fails a PERSON rather than a build:
 *
 *   - a check-then-insert outside a transaction puts two people in one slot;
 *   - a buffer that is displayed but not enforced is not a buffer;
 *   - an internal runbook published because a caller checked one flag of two;
 *   - a health score that reads as failing because a survey skipped an axis;
 *   - an emergency contact list with two primaries, on the day it is used;
 *   - a monitor with no threshold that pages on every blip.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BOOKING_MODES, BookingError, RESERVATION_STATUSES, isBookingMode } from './bookings';
import { CLIENT_STATUSES, CONSULTATION_STATUSES, DECK_VISIBILITY, PracticeError, isDeckVisibility } from './agencyPractice';
import { AiOpsError, TOOL_OUTCOMES, isToolOutcome } from '../agent/aiOperations';
import { PeopleInsightError } from '../people/peopleInsight';
import { PortfolioIntelError } from '../investor/portfolioIntel';
import {
  ARTICLE_STATUSES,
  ARTICLE_VISIBILITY,
  CustomerSurfaceError,
  MONITOR_KINDS,
  WIDGET_KINDS,
  isArticleVisibility,
} from '../support/customerSurface';

const read = (p: string) => readFileSync(p, 'utf8').split(String.fromCharCode(13)).join('');
const booking = read(resolve(__dirname, 'bookings.ts'));
const practice = read(resolve(__dirname, 'agencyPractice.ts'));
const aiOps = read(resolve(__dirname, '..', 'agent', 'aiOperations.ts'));
const people = read(resolve(__dirname, '..', 'people', 'peopleInsight.ts'));
const portfolio = read(resolve(__dirname, '..', 'investor', 'portfolioIntel.ts'));
const surface = read(resolve(__dirname, '..', 'support', 'customerSurface.ts'));
const routes = read(resolve(__dirname, '..', '..', 'presentation', 'routes', 'practiceOpsRoutes.ts'));

/** Source with comments removed, for assertions about what the code DOES rather
 *  than about what its docstring says it deliberately avoids. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

const fn = (src: string, name: string): string => {
  const at = src.indexOf(`export async function ${name}`);
  expect(at, `${name} should exist`).toBeGreaterThan(-1);
  const rest = src.slice(at + 10);
  const end = rest.indexOf('\nexport ');
  return end === -1 ? rest : rest.slice(0, end);
};

describe('vocabularies are closed', () => {
  it('declares every status set the schema documents', () => {
    expect([...BOOKING_MODES]).toEqual(['one_to_one', 'one_to_many', 'round_robin']);
    expect([...RESERVATION_STATUSES]).toEqual(['confirmed', 'cancelled', 'completed', 'no_show']);
    expect([...CLIENT_STATUSES]).toEqual(['active', 'paused', 'ended', 'prospect']);
    expect([...CONSULTATION_STATUSES]).toEqual(['scheduled', 'delivered', 'cancelled', 'no_show']);
    expect([...DECK_VISIBILITY]).toEqual(['private', 'unlisted', 'public']);
    expect([...TOOL_OUTCOMES]).toEqual(['ok', 'error', 'refused', 'timeout']);
    expect([...ARTICLE_STATUSES]).toEqual(['draft', 'published', 'archived']);
    expect([...ARTICLE_VISIBILITY]).toEqual(['tenant', 'public', 'internal']);
    expect([...WIDGET_KINDS]).toEqual(['csat', 'nps', 'ces', 'freeform']);
    expect([...MONITOR_KINDS]).toEqual(['http', 'tcp', 'ping', 'keyword']);
  });

  it('rejects values outside them', () => {
    expect(isBookingMode('group')).toBe(false);
    expect(isToolOutcome('refused')).toBe(true);
    expect(isDeckVisibility('secret')).toBe(false);
    expect(isArticleVisibility('internal')).toBe(true);
  });

  it('gives every error a status the route returns', () => {
    expect(new BookingError('x', 409).status).toBe(409);
    expect(new PracticeError('x').status).toBe(400);
    expect(new AiOpsError('x', 404).status).toBe(404);
    expect(new PeopleInsightError('x').status).toBe(400);
    expect(new PortfolioIntelError('x').status).toBe(400);
    expect(new CustomerSurfaceError('x').status).toBe(400);
  });
});

describe('double booking is prevented by the write', () => {
  const body = fn(booking, 'reserve');

  it('checks and inserts inside one transaction', () => {
    expect(body).toContain('db.transaction');
  });

  it('uses a half-open overlap, so back-to-back bookings are allowed', () => {
    expect(body).toContain('startsAt} < ');
    expect(body).toContain('endsAt} > ');
  });

  it('widens the tested window by the service buffer, so the buffer is enforced', () => {
    expect(body).toContain('const bufferMs = service.bufferMin * 60_000');
    expect(body).toContain('windowStart');
    expect(body).toContain('windowEnd');
  });

  it('counts against capacity rather than existence-testing', () => {
    expect(body).toContain('>= service.capacity');
  });

  it('treats a cancelled reservation as free', () => {
    expect(body).toContain("ne(bookingReservations.status, 'cancelled')");
  });

  it('refuses a capacity that contradicts the mode', () => {
    expect(fn(booking, 'createService')).toContain('use one_to_many for a group session');
  });

  it('returns busy intervals rather than free ones', () => {
    // Free time is `availability_slots`, which Builderforce already owns.
    expect(booking).toContain('export async function busyIntervals');
    expect(stripComments(booking)).not.toContain('availabilitySlots');
  });
});

describe('a practice can see whether a client is worth it', () => {
  const body = fn(practice, 'clientEconomics');

  it('reports contractual and delivered side by side, not as one margin', () => {
    expect(body).toContain('retainerCents');
    expect(body).toContain('deliveredCents');
  });

  it('counts only delivered consultations', () => {
    expect(body).toContain("eq(consultantConsultations.status, 'delivered')");
  });

  it('returns null utilisation with no retainer, not infinity', () => {
    expect(body).toContain('c.retainerCents ? deliveredCents / c.retainerCents : null');
  });

  it('lets a consultation exist without a booking', () => {
    expect(fn(practice, 'recordConsultation')).toContain('input.reservationId ?? null');
  });

  it('derives a deck card count rather than trusting the caller', () => {
    expect(fn(practice, 'saveDeck')).toContain('cardCount: input.cards.length');
  });

  it('refuses a priced deck nobody can buy', () => {
    expect(fn(practice, 'saveDeck')).toContain('must be unlisted or public');
  });
});

describe('AI operations are measured honestly', () => {
  it('separates a refusal from an error', () => {
    const body = fn(aiOps, 'toolUsage');
    expect(body).toContain("filter (where ${aiToolCalls.outcome} = 'refused')");
    expect(body).toContain("filter (where ${aiToolCalls.outcome} = 'error')");
  });

  it('requires a model on every classification', () => {
    expect(fn(aiOps, 'classifyMessage')).toContain('a label with no model has no provenance');
  });

  it('groups the classification mix per model', () => {
    expect(fn(aiOps, 'classificationMix')).toContain('groupBy(aiEmailClassifications.model');
  });

  it('applies cache expiry in the query, not via a sweep', () => {
    const body = fn(aiOps, 'cacheLookup');
    expect(body).toContain('expiresAt} > now()');
    expect(body).toContain('isNull(enrichmentCache.expiresAt)');
  });

  it('counts the hit on the read path so savings cannot be understated', () => {
    expect(fn(aiOps, 'cacheLookup')).toContain('hitCount: sql`${enrichmentCache.hitCount} + 1`');
  });

  it('computes savings over hits rather than entries', () => {
    expect(fn(aiOps, 'cacheSavings')).toContain('${enrichmentCache.hitCount} * ${enrichmentCache.costCentsAvoided}');
  });
});

describe('people data is handled carefully', () => {
  it('normalises a health score over the axes actually scored', () => {
    const body = fn(people, 'weightedScore');
    expect(body).toContain('scoredWeight > 0 ? weighted / scoredWeight : null');
    expect(body).toContain('partial: missing.length > 0');
  });

  it('takes the scores as an argument rather than reading pulse responses', () => {
    expect(stripComments(people)).not.toContain('pulseResponses');
  });

  it('keeps exactly one primary emergency contact, in a transaction', () => {
    const body = fn(people, 'setEmergencyContact');
    expect(body).toContain('db.transaction');
    expect(body).toContain('.set({ isPrimary: false');
  });

  it('refuses a contact nobody can reach', () => {
    expect(fn(people, 'setEmergencyContact')).toContain('a name alone cannot be reached');
  });

  it('derives the retention rate rather than accepting it', () => {
    const body = fn(people, 'recordCohort');
    expect(body).toContain('const rate = (input.retainedCount / input.startingCount) * 100');
  });

  it('pools retention rather than averaging rates across uneven cohorts', () => {
    expect(fn(people, 'retentionByHorizon')).toContain('pooledRate');
  });

  it('gates every emergency-contact route at MANAGER', () => {
    expect(routes).toContain("router.get('/people/employees/:id/emergency-contacts', manager");
    expect(routes).toContain("router.post('/people/employees/:id/emergency-contacts', manager");
    expect(routes).toContain("router.delete('/people/emergency-contacts/:id', manager");
  });
});

describe('a valuation is argued, not asserted', () => {
  it('states its method', () => {
    expect(fn(portfolio, 'impliedValuation')).toContain("method: 'peer revenue multiple");
  });

  it('reports a range and the peer count behind it', () => {
    const body = fn(portfolio, 'impliedValuation');
    expect(body).toContain('low:');
    expect(body).toContain('mid:');
    expect(body).toContain('high:');
    expect(body).toContain('basis:');
  });

  it('excludes peers with no multiple rather than treating them as zero', () => {
    expect(fn(portfolio, 'comparableSpread')).toContain('multiple} is not null');
  });

  it('gates modules on rung and never on a plan', () => {
    expect(fn(portfolio, 'visibleModules')).toContain('requiredRung} <= ');
    // Checked against the CODE: the docstring names PlanLimits precisely to say
    // that plan gating is NOT this module's job.
    expect(stripComments(portfolio)).not.toContain('PlanLimits');
    expect(stripComments(portfolio)).not.toContain('planLimits');
  });
});

describe('the public help centre cannot leak an internal article', () => {
  it('requires published AND public inside the query', () => {
    for (const name of ['publicArticles', 'publicArticle']) {
      const body = fn(surface, name);
      expect(body).toContain("eq(supportArticles.status, 'published')");
      expect(body).toContain("eq(supportArticles.visibility, 'public')");
    }
  });

  it('keeps status and visibility as separate writes', () => {
    expect(fn(surface, 'setArticleStatus')).not.toContain('visibility');
    expect(surface).toContain('export async function setArticleVisibility');
  });

  it('leaves the public router without authMiddleware', () => {
    const pub = routes.slice(routes.indexOf('export function createPublicSupportRoutes'));
    expect(pub).not.toContain('authMiddleware');
  });
});

describe('the widget cooldown has exactly one decider', () => {
  const body = fn(surface, 'shouldPrompt');

  it('never prompts for a disabled widget or one with no question set', () => {
    expect(body).toContain('widget is disabled');
    expect(body).toContain('widget has no question set');
  });

  it('takes the last response time as an argument rather than reading it', () => {
    expect(body).toContain('lastRespondedAt: Date | null');
  });

  it('explains its verdict, so a surface can log why it stayed silent', () => {
    expect(body).toContain('reason:');
  });
});

describe('a monitor threshold separates a blip from an outage', () => {
  const body = fn(surface, 'evaluateProbe');

  it('reports degraded below the threshold and down at or above it', () => {
    expect(body).toContain("failures >= monitor.failThreshold ? ('down' as const) : ('degraded' as const)");
  });

  it('resets the count on a success', () => {
    expect(body).toContain('probe.ok ? 0 : probe.consecutiveFailures + 1');
  });

  it('refuses a threshold or interval that makes monitoring useless', () => {
    const upsert = fn(surface, 'upsertMonitor');
    expect(upsert).toContain('a threshold of 0 pages on every blip');
    expect(upsert).toContain('probing faster costs more than it detects');
  });
});

describe('the merge added no schema', () => {
  it('touches only tables that already existed', () => {
    for (const t of ['bookingServices', 'bookingHosts', 'bookingReservations']) expect(booking).toContain(t);
    for (const t of ['agencyBrandings', 'agencyClients', 'consultantConsultations', 'consultantKnowledgeDocs', 'cardDecks']) {
      expect(practice).toContain(t);
    }
    for (const t of ['aiToolCalls', 'aiEmailClassifications', 'aiCompetitors', 'enrichmentCache']) expect(aiOps).toContain(t);
    for (const t of ['healthDimensions', 'hrEmergencyContacts', 'cohortRetention']) expect(people).toContain(t);
    for (const t of ['investorPeerComparables', 'scratchPadAttachments', 'modules']) expect(portfolio).toContain(t);
    for (const t of ['supportArticles', 'customerEngagementFeedbackWidgets', 'uptimeMonitors']) expect(surface).toContain(t);
  });
});
