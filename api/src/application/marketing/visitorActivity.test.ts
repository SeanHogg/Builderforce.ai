import { describe, expect, it } from 'vitest';
import {
  VISIT_TARGET_TYPE,
  VISITOR_ACTOR_TYPE,
  kindFromVerb,
  toActivityInput,
  visitorVerb,
} from './visitorActivity';
import { VISITOR_JOURNEY_KINDS, parseVisitorEvent } from '../../domain/marketing/VisitorJourney';

/**
 * The fold onto `activity_log` is a MAPPING, and a mapping is only correct if it
 * survives the round trip: the flow graph switches on `page_view`, and it reads
 * back a column that stores `visitor.page_view`. These assert the translation in
 * both directions and the one column that can silently overflow.
 */

const parse = (input: Parameters<typeof parseVisitorEvent>[0]) =>
  parseVisitorEvent(input, { visitorId: 'v-abc', personaOf: (p) => (typeof p === 'string' ? p : null), nowMs: Date.now() })!;

describe('visitor journey → activity_log', () => {
  it('round-trips every structural kind through the verb column', () => {
    for (const kind of Object.values(VISITOR_JOURNEY_KINDS)) {
      expect(kindFromVerb(visitorVerb(kind))).toBe(kind);
    }
  });

  it('leaves a verb that carries no visitor prefix alone', () => {
    // Defensive: the same reader would otherwise mangle any other actor's verb
    // if the predicate on a query were ever loosened.
    expect(kindFromVerb('task.created')).toBe('task.created');
  });

  it('maps an event onto the kernel columns, tenant-less', () => {
    const row = toActivityInput(parse({
      kind: 'page_view', visitId: 'visit-12345678', path: '/pricing?utm=x', metadata: { referrer: '/' },
    }));

    expect(row.tenantId).toBeNull();
    expect(row.actor.type).toBe(VISITOR_ACTOR_TYPE);
    expect(row.actor.ref).toBe('v-abc');
    expect(row.verb).toBe('visitor.page_view');
    expect(row.targetType).toBe(VISIT_TARGET_TYPE);
    expect(row.targetId).toBe('visit-12345678');
    // The query string is dropped by the domain, not here.
    expect(row.targetLabel).toBe('/pricing');
    expect(row.metadata).toEqual({ referrer: '/' });
  });

  it('folds the persona into metadata rather than a column', () => {
    const row = toActivityInput(parse({ kind: 'demo_start', persona: 'founder', metadata: { step: 1 } }));
    expect(row.metadata).toEqual({ step: 1, persona: 'founder' });
  });

  it('carries a persona even when the event brought no metadata of its own', () => {
    const row = toActivityInput(parse({ kind: 'demo_start', persona: 'founder' }));
    expect(row.metadata).toEqual({ persona: 'founder' });
  });

  it('cannot produce a verb wider than the column that stores it', () => {
    // `activity_log.verb` is varchar(64). The domain caps a kind at 56 for this
    // reason; if that cap ever moves, this fails before a row is truncated in
    // production and a journey kind quietly stops matching.
    const longest = `a${'b'.repeat(55)}`;
    expect(parse({ kind: longest })).not.toBeNull();
    expect(visitorVerb(longest).length).toBeLessThanOrEqual(64);
    expect(parseVisitorEvent(
      { kind: `${longest}c` },
      { visitorId: 'v-abc', personaOf: () => null, nowMs: Date.now() },
    )).toBeNull();
  });
});
