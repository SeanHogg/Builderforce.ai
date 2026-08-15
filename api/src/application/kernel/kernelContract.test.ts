/**
 * The kernel's contracts, as tests (PRD 20 §6, §7).
 *
 * Not a database test — these assert the invariants that make the kernel usable
 * as ONE surface across fifteen domains, and every one of them is a thing that
 * silently drifts otherwise:
 *
 *   · the roster and the schema's domain vocabulary are the same list;
 *   · every seat has a manifest entry, so a surface can be built from it;
 *   · every metric key is namespaced to its domain, so `metric_facts` rows from
 *     two seats cannot collide in one chart;
 *   · cache keys are derived from (tenant, domain, object), which is §6.3's
 *     stated precondition for the "cached or say why not" rule;
 *   · the five relations the route group exposes are the five the application
 *     layer invalidates — a sixth added to one and not the other is how a
 *     mutation stops being visible.
 */
import { describe, expect, it } from 'vitest';
import {
  DOMAINS,
  OBJECT_RELATIONS,
  isDomain,
  objectCacheKey,
  recentsCacheKey,
  relationCacheKey,
} from './ObjectRegistry';
import { DOMAIN_MANIFEST, ROSTER, UNIVERSAL_METRICS, metricsFor } from './DomainService';

describe('the roster', () => {
  /**
   * The roster, written out.
   *
   * This used to be `expect(DOMAINS).toHaveLength(15)`, which is the weaker half of
   * the invariant: it catches an accidental sixteenth seat and is blind to a renamed
   * one, a reordered one, or a duplicate that keeps the count right. Naming them makes
   * adding a seat a deliberate edit — which it must be, because the schema's `domain`
   * column, the navigation and the permission modules all read this list — and catches
   * the drift a count cannot see.
   *
   * `operations` is the sixteenth, added because every one of the original fifteen
   * models how a company runs ITSELF and none modelled what it SELLS. See `DOMAINS`.
   */
  const EXPECTED = [
    'growth', 'delivery', 'agents', 'hiring', 'finance', 'revenue', 'commerce',
    'identity', 'people', 'platform', 'governance', 'investor', 'support',
    'canvas', 'integrations', 'operations', 'legal',
  ];

  it('is exactly the roster PRD 20 §3 enumerates, in order, with no duplicates', () => {
    expect([...DOMAINS]).toEqual(EXPECTED);
    expect(new Set(DOMAINS).size).toBe(DOMAINS.length);
  });

  it('gives every domain a manifest entry — a seat with no manifest is a surface that cannot be built', () => {
    for (const domain of DOMAINS) {
      const entry = DOMAIN_MANIFEST[domain];
      expect(entry, `no manifest entry for ${domain}`).toBeDefined();
      expect(entry.domain).toBe(domain);
      expect(entry.seat.length).toBeGreaterThan(0);
      expect(entry.rootKind.length).toBeGreaterThan(0);
    }
  });

  it('lists the roster in the same order as the domain vocabulary', () => {
    expect(ROSTER.map((r) => r.domain)).toEqual([...DOMAINS]);
  });

  it('namespaces every metric key to its own domain', () => {
    // Two seats charting `revenue` and meaning different things is how one chart
    // ends up summing unrelated facts. The prefix is the guard.
    for (const entry of ROSTER) {
      for (const metric of entry.metrics) {
        expect(metric, `${entry.domain} charts an unnamespaced metric`).toMatch(
          new RegExp(`^${entry.domain}\\.`),
        );
      }
    }
  });

  it('gives every domain at least one object kind to list', () => {
    for (const entry of ROSTER) expect(entry.kinds.length).toBeGreaterThan(0);
  });

  it('gives every domain the two universal metrics, so no surface ships fifteen empty panels', () => {
    // `registryProjection.ts` writes these from the registry itself. Without
    // them a seat charts nothing until a bespoke rollup is written for it, which
    // is how "insights everywhere" turns into a slogan.
    for (const domain of DOMAINS) {
      const keys = metricsFor(domain);
      for (const suffix of UNIVERSAL_METRICS) {
        expect(keys, `${domain} is missing ${suffix}`).toContain(`${domain}.${suffix}`);
      }
      expect(keys.length).toBeGreaterThan(UNIVERSAL_METRICS.length);
    }
  });

  it('gates state and never capability — every seat is reachable at some rung', () => {
    // A dimmed CFO is an invitation; a missing CFO is a secret (§7). A rung
    // beyond the ladder would make a seat permanently invisible.
    for (const entry of ROSTER) {
      expect(entry.rung).toBeGreaterThanOrEqual(0);
      expect(entry.rung).toBeLessThanOrEqual(3);
    }
  });

  it('always includes the canvas at rung zero — it is the front door, not a feature', () => {
    expect(DOMAIN_MANIFEST.canvas.rung).toBe(0);
  });
});

describe('isDomain', () => {
  it('accepts every roster domain and nothing else', () => {
    for (const d of DOMAINS) expect(isDomain(d)).toBe(true);
    for (const junk of ['', 'Growth', 'billing', 'work', 'pmo', '../etc']) {
      expect(isDomain(junk)).toBe(false);
    }
  });
});

describe('cache keys', () => {
  it('derive from (tenant, object) rather than from a feature table', () => {
    expect(objectCacheKey(7, 'abc')).toBe('kernel:object:7:abc');
    expect(relationCacheKey(7, 'abc', 'activity')).toBe('kernel:object:7:abc:activity');
    expect(recentsCacheKey(7, 'u1', 'delivery')).toBe('kernel:recents:7:u1:delivery');
  });

  it('separate two tenants holding the same object id', () => {
    expect(objectCacheKey(1, 'x')).not.toBe(objectCacheKey(2, 'x'));
  });

  it('separate every relation, so invalidating one does not depend on key collision', () => {
    const keys = OBJECT_RELATIONS.map((rel) => relationCacheKey(1, 'x', rel));
    expect(new Set(keys).size).toBe(OBJECT_RELATIONS.length);
  });
});

describe('object relations', () => {
  it('are the five the route group exposes', () => {
    // If this list and `objectRoutes.ts` disagree, a mutation invalidates a key
    // nothing reads and the surface serves stale data until the TTL expires.
    expect([...OBJECT_RELATIONS]).toEqual(['activity', 'annotations', 'members', 'shares', 'revisions']);
  });
});
