import { describe, expect, it } from 'vitest';
import {
  buildExplorationPlan,
  defaultFindingSeverity,
  findingFingerprint,
  type QaHeatZone,
} from './qaTypes';

const zone = (over: Partial<QaHeatZone>): QaHeatZone => ({
  route: '/dashboard', selector: null, kind: 'pageview', label: null, heat: 1, score: 1, ...over,
});

describe('buildExplorationPlan', () => {
  it('visits each hot route once and exercises hot elements within budget', () => {
    const zones: QaHeatZone[] = [
      zone({ route: '/dashboard', selector: null, kind: 'pageview', heat: 100 }),
      zone({ route: '/dashboard', selector: 'button#new', kind: 'click', label: 'New', heat: 80 }),
      zone({ route: '/settings', selector: 'input#name', kind: 'input', heat: 40 }),
    ];
    const plan = buildExplorationPlan(zones, 10);

    // One goto per distinct route (deduped), and the hottest route comes first.
    const gotos = plan.filter((s) => s.action === 'goto').map((s) => s.route);
    expect(gotos).toEqual(['/dashboard', '/settings']);

    // Click for the click zone, fill for the input zone.
    expect(plan.some((s) => s.action === 'click' && s.selector === 'button#new')).toBe(true);
    expect(plan.some((s) => s.action === 'fill' && s.selector === 'input#name')).toBe(true);

    // Heat is carried onto the plan steps so findings inherit zone importance.
    const click = plan.find((s) => s.action === 'click' && s.selector === 'button#new');
    expect(click?.heat).toBe(80);
  });

  it('caps the number of exercised zones at the heat budget', () => {
    const zones: QaHeatZone[] = Array.from({ length: 50 }, (_, i) =>
      zone({ route: `/r${i}`, selector: `#el${i}`, kind: 'click', heat: 50 - i }),
    );
    const plan = buildExplorationPlan(zones, 5);
    // 5 element zones exercised → 5 click steps.
    expect(plan.filter((s) => s.action === 'click').length).toBe(5);
  });
});

describe('defaultFindingSeverity', () => {
  it('treats crashes as critical and a page error on a hot zone as critical', () => {
    expect(defaultFindingSeverity('crash', 0)).toBe('critical');
    expect(defaultFindingSeverity('pageerror', 25)).toBe('critical');
    expect(defaultFindingSeverity('pageerror', 5)).toBe('high');
  });
  it('downranks console noise on cold zones', () => {
    expect(defaultFindingSeverity('console', 5)).toBe('low');
    expect(defaultFindingSeverity('console', 80)).toBe('medium');
  });
});

describe('findingFingerprint', () => {
  it('is stable for the same error and distinct across type/route/selector', () => {
    const a = findingFingerprint({ type: 'console', route: '/x', selector: '#b', message: 'boom' });
    const b = findingFingerprint({ type: 'console', route: '/x', selector: '#b', message: 'boom' });
    const c = findingFingerprint({ type: 'network', route: '/x', selector: '#b', message: 'boom' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
