import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRODUCT_HOSTS, productHostOf, productHostRedirect } from './productHosts';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

describe('product hosts', () => {
  it('recognises each product subdomain and nothing that merely contains its name', () => {
    expect(productHostOf('studio.builderforce.ai')?.route).toBe('/studio');
    expect(productHostOf('spawn.builderforce.ai')?.route).toBe('/spawn');
    expect(productHostOf('builderforce.ai')).toBeNull();
    expect(productHostOf('mystudio.builderforce.ai')).toBeNull();
    expect(productHostOf('respawn.builderforce.ai')).toBeNull();
  });

  it('sends a product host root to its route and leaves its own paths alone', () => {
    expect(productHostRedirect('spawn.builderforce.ai', '/')).toEqual({ pathname: '/spawn', hostname: null });
    expect(productHostRedirect('spawn.builderforce.ai', '/spawn/account')).toBeNull();
    expect(productHostRedirect('studio.builderforce.ai', '/auth/callback')).toBeNull();
    expect(productHostRedirect('builderforce.ai', '/')).toBeNull();
  });

  it('sends Studio, and the canvases it starts, to the apex — one origin for browser-held work', () => {
    expect(productHostRedirect('studio.builderforce.ai', '/')).toEqual({ pathname: '/studio', hostname: 'builderforce.ai' });
    expect(productHostRedirect('studio.builderforce.ai', '/studio')).toEqual({ pathname: '/studio', hostname: 'builderforce.ai' });
    expect(productHostRedirect('studio.builderforce.ai', '/studio/local-abc')).toEqual({ pathname: '/studio/local-abc', hostname: 'builderforce.ai' });
    expect(productHostRedirect('studio.builderforce.ai', '/create/local-abc')).toEqual({ pathname: '/create/local-abc', hostname: 'builderforce.ai' });
    expect(productHostRedirect('studio.localhost', '/')).toEqual({ pathname: '/studio', hostname: 'localhost' });
    // Whole segments only: a path that merely starts with the letters stays.
    expect(productHostRedirect('studio.builderforce.ai', '/creators')).toBeNull();
  });
});

/**
 * `productHostRedirect(host, '/')` is only ever CALLED if facts outside this module
 * hold, and they were false in production on 2026-10-03 or would have been: the
 * middleware has to match `/`, the Worker has to be invoked for `/` at all (with the
 * assets binding, the prerendered `index.html` answers `/` and the Worker never
 * runs), and the host has to be routed to this Worker. The unit tests above passed
 * the whole time; `studio.builderforce.ai/` still served the marketing home page.
 */
describe('every product host redirect is reachable in production', () => {
  it('runs the Worker for the host root instead of serving the prerendered asset', () => {
    const wrangler = read('../../wrangler.toml');
    const rule = wrangler.match(/^run_worker_first\s*=\s*(.+)$/m)?.[1];
    expect(rule, 'frontend/wrangler.toml must declare assets.run_worker_first').toBeDefined();
    expect(rule).toMatch(/(^|[["\s,])"\/"([\]\s,]|$)/);
  });

  it('matches the host root in the middleware matcher', () => {
    const matcher = read('../middleware.ts').match(/matcher:\s*\[([\s\S]*?)\]/)?.[1];
    expect(matcher, 'src/middleware.ts must export a config.matcher').toBeDefined();
    expect(matcher).toMatch(/(^|\s)'\/',/m);
  });

  it.each(PRODUCT_HOSTS.map((h) => [h.label]))('routes %s.builderforce.ai to this Worker and reserves it from user sites', (label) => {
    expect(read('../../wrangler.toml')).toContain(`pattern = "${label}.builderforce.ai/*"`);
    expect(read('../../../api/src/application/ide/siteHosting.ts')).toMatch(new RegExp(`'${label}'`));
  });
});
