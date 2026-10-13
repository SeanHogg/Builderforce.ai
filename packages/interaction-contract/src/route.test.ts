import { describe, expect, it } from 'vitest';
import { fnv1a64, issueFingerprint, routeTemplate } from './route';

describe('routeTemplate', () => {
  it('strips query and hash and normalises slashes', () => {
    expect(routeTemplate('/pricing?plan=pro#faq')).toBe('/pricing');
    expect(routeTemplate('/pricing/')).toBe('/pricing');
    expect(routeTemplate('//docs//intro')).toBe('/docs/intro');
    expect(routeTemplate('')).toBe('/');
    expect(routeTemplate('/')).toBe('/');
    expect(routeTemplate('https://example.com/a/1?x=1')).toBe('/a/:id');
  });

  it('replaces numeric, uuid, hex and long-token segments with :id', () => {
    expect(routeTemplate('/orders/1234')).toBe('/orders/:id');
    expect(routeTemplate('/u/3f2504e0-4f89-11d3-9a0c-0305e82c3301/edit')).toBe('/u/:id/edit');
    expect(routeTemplate('/build/deadbeef')).toBe('/build/:id');
    expect(routeTemplate('/invite/AbCdEfGhIjKlMnOpQrStUv')).toBe('/invite/:id');
  });

  it('keeps ordinary words', () => {
    expect(routeTemplate('/blog/hello-world')).toBe('/blog/hello-world');
    expect(routeTemplate('/cafe')).toBe('/cafe');
    expect(routeTemplate('/blog/how-to-build-a-saas-app')).toBe('/blog/how-to-build-a-saas-app');
  });

  it('prefers a learned template that matches', () => {
    expect(routeTemplate('/blog/hello-world', ['/blog/:slug'])).toBe('/blog/:slug');
    expect(routeTemplate('/blog/hello/world', ['/blog/:slug'])).toBe('/blog/hello/world');
    expect(routeTemplate('/docs/a', ['/blog/:slug'])).toBe('/docs/a');
  });
});

describe('fnv1a64', () => {
  it('matches the reference FNV-1a 64 vectors', () => {
    expect(fnv1a64('')).toBe('cbf29ce484222325');
    expect(fnv1a64('a')).toBe('af63dc4c8601ec8c');
    expect(fnv1a64('foobar')).toBe('85944171f73967e8');
  });
});

describe('issueFingerprint', () => {
  const input = { siteId: 'site-1', route: '/checkout', kind: 'rage', subject: 'getByRole("button")' };

  it('is deterministic, 16 hex chars', () => {
    const a = issueFingerprint(input);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(issueFingerprint({ ...input })).toBe(a);
  });

  it('changes when any field changes', () => {
    const base = issueFingerprint(input);
    expect(issueFingerprint({ ...input, siteId: 'site-2' })).not.toBe(base);
    expect(issueFingerprint({ ...input, route: '/cart' })).not.toBe(base);
    expect(issueFingerprint({ ...input, kind: 'dead' })).not.toBe(base);
    expect(issueFingerprint({ ...input, subject: 'x' })).not.toBe(base);
  });
});
