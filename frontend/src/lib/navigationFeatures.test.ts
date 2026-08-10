import { describe, expect, it } from 'vitest';
import { NAV_GROUPS } from './navGroups';
import { filterNavigationGroups, navigationFeatureForPath } from './navigationFeatures';

describe('navigation feature filtering', () => {
  it('keeps core navigation while hiding disabled optional modules', () => {
    const groups = filterNavigationGroups(NAV_GROUPS, new Set(['projects', 'knowledge']));
    const ids = groups.map((group) => group.id);
    expect(ids).toContain('create');
    expect(ids).toContain('create');
    expect(ids).toContain('settings');
    expect(ids).toContain('projects');
    expect(ids).toContain('knowledge');
    expect(ids).not.toContain('quality');
  });

  it('maps mobile destinations to their controlling module', () => {
    expect(navigationFeatureForPath('/projects?tab=tasks')).toBe('projects');
    expect(navigationFeatureForPath('/workforce/plan')).toBe('workforce');
    expect(navigationFeatureForPath('/settings')).toBeUndefined();
  });
});
