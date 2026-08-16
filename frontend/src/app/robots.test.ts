import { describe, expect, it } from 'vitest';
import robots from './robots';
import { indexableTeaserRoutes, noindexTeaserRoutes } from '@/lib/routeMarketing';

const rules = () => {
  const result = robots().rules;
  return Array.isArray(result) ? result : [result];
};

const disallowOf = (rule: { disallow?: string | string[] }): string[] =>
  Array.isArray(rule.disallow) ? rule.disallow : rule.disallow ? [rule.disallow] : [];

describe('robots.txt', () => {
  it('never disallows a route the sitemap submits', () => {
    // The defect this file replaced: nine marketed routes were disallowed here
    // AND listed in the sitemap, and the disallow won — a crawler that cannot
    // fetch the page never reads the meta tag that would have let it in.
    const indexable = indexableTeaserRoutes();
    for (const rule of rules()) {
      const blocked = disallowOf(rule).filter((path) => indexable.includes(path));
      expect(blocked).toEqual([]);
    }
  });

  it('disallows every operator and personal-console teaser', () => {
    for (const rule of rules()) {
      const disallow = disallowOf(rule);
      for (const route of noindexTeaserRoutes()) expect(disallow).toContain(route);
    }
  });

  it('does not swallow /embedded with the framed-webview prefix', () => {
    // `Disallow: /embed` is a bare prefix match, so it would also block
    // /embedded — a real marketing page for a real destination.
    for (const rule of rules()) {
      expect(disallowOf(rule)).not.toContain('/embed');
    }
  });

  it('grants the named AI crawlers the public site, not the whole site', () => {
    const named = rules().find((rule) => Array.isArray(rule.userAgent));
    expect(named?.userAgent).toContain('ClaudeBot');
    expect(disallowOf(named ?? {})).toContain('/api/');
  });

  it('points at the sitemap', () => {
    expect(robots().sitemap).toBe('https://builderforce.ai/sitemap.xml');
  });
});
