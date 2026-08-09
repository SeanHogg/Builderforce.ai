import { describe, expect, it } from 'vitest';
import { listDestinations, rankDestinations, scoreDestination, type Destination } from './registry';
import { NAV_GROUPS } from '@/lib/navGroups';

/** Stand-in for the `nav` namespace: the leaf of the key is close enough to a
 *  label for ranking assertions, and keeps these tests free of an i18n provider. */
const translate = (key: string): string => (key.split('.').at(-1) ?? key);

describe('listDestinations', () => {
  it('registers every nav group and every one of its tabs', () => {
    const projects = NAV_GROUPS.find((group) => group.id === 'projects')!;
    const destinations = listDestinations();
    const ids = destinations.map((destination) => destination.id);

    expect(ids).toContain('projects');
    for (const tab of projects.tabs ?? []) {
      if (!tab.id) continue;
      expect(ids).toContain(`projects.${tab.id}`);
    }
  });

  it('does not list a group and its default tab as two rows', () => {
    // The default tab (id '') IS the group's own destination; emitting both put
    // two identical rows in the palette.
    const ids = listDestinations().map((destination) => destination.id);
    expect(ids.filter((id) => id === 'projects')).toHaveLength(1);
    expect(ids).not.toContain('projects.');
  });

  it('gives every destination a unique id', () => {
    const ids = listDestinations().map((destination) => destination.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('carries the canvas surfaces, so the work itself is searchable', () => {
    const ids = listDestinations().map((destination) => destination.id);
    expect(ids).toContain('canvas.library');
    expect(ids).toContain('canvas.new');
  });

  it('propagates the nav config gating rather than restating it', () => {
    const admin = listDestinations().find((destination) => destination.id === 'admin');
    expect(admin?.superadminOnly).toBe(true);
  });
});

describe('scoreDestination', () => {
  const destination: Destination = {
    id: 'insights.delivery', labelKey: 'tab.delivery', groupLabelKey: 'group.insights',
    href: '/insights/delivery', icon: '📦', keywords: ['dora', 'cycle time'],
  };

  it('ranks an exact label hit above a prefix, a word start, and a path hit', () => {
    const exact = scoreDestination(destination, 'Delivery', 'Insights', 'delivery');
    const prefix = scoreDestination(destination, 'Delivery report', 'Insights', 'delivery');
    const wordStart = scoreDestination(destination, 'Fast delivery', 'Insights', 'delivery');
    const viaPath = scoreDestination(destination, 'Unrelated', 'Elsewhere', 'insights');

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(viaPath);
  });

  it('matches synonyms the label does not contain', () => {
    expect(scoreDestination(destination, 'Delivery', 'Insights', 'dora')).toBeGreaterThan(0);
  });

  it('treats regex metacharacters in the query as literal text', () => {
    // A stray '(' from a half-typed query must not throw out of the ranker.
    expect(() => scoreDestination(destination, 'Delivery', 'Insights', 'deliv(')).not.toThrow();
    expect(scoreDestination(destination, 'Delivery', 'Insights', 'deliv(')).toBe(0);
  });

  it('scores everything as a match when the query is empty', () => {
    expect(scoreDestination(destination, 'Delivery', 'Insights', '   ')).toBeGreaterThan(0);
  });
});

describe('rankDestinations', () => {
  it('puts the best label match first', () => {
    const ranked = rankDestinations(listDestinations(), 'tasks', translate);
    expect(ranked[0]?.label.toLowerCase()).toContain('tasks');
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(rankDestinations(listDestinations(), 'zzzznotathing', translate)).toEqual([]);
  });

  it('honours the result limit', () => {
    expect(rankDestinations(listDestinations(), '', translate, 5)).toHaveLength(5);
  });

  it('resolves labels through the translator, not the raw key', () => {
    const ranked = rankDestinations(listDestinations(), 'settings', translate);
    expect(ranked[0]?.label).not.toContain('group.');
  });
});

describe('plan-gated destinations', () => {
  it('declares a feature only where a server gate was verified', () => {
    const byId = new Map(listDestinations().map((destination) => [destination.id, destination]));
    // Enforced by tenantHasFeature('psychometricPersona') and
    // requirePlanFeature('advancedInsights') respectively.
    expect(byId.get('settings.settings.viewpoint')?.feature).toBe('psychometricPersona');
    expect(byId.get('insights.insights.finance')?.feature).toBe('advancedInsights');
  });

  it('leaves ungated destinations with no feature, so no lock is advertised the API would not apply', () => {
    const projects = listDestinations().find((destination) => destination.id === 'projects');
    expect(projects?.feature).toBeUndefined();
  });

  it('preserves gate fields through ranking', () => {
    // rankDestinations is generic precisely so the palette keeps what it passed
    // in; a non-generic version silently dropped `locked` and every row rendered
    // as unlocked.
    const gated = listDestinations().map((destination) => ({ ...destination, locked: true }));
    const ranked = rankDestinations(gated, 'persona', translate);
    expect(ranked[0]?.locked).toBe(true);
  });
});
