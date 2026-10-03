import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isStudioHost, studioHostRedirect, studioProjectPath, STUDIO_ROUTE } from './studioHost';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

describe('studio host', () => {
  it('recognises the studio subdomain only', () => {
    expect(isStudioHost('studio.builderforce.ai')).toBe(true);
    expect(isStudioHost('builderforce.ai')).toBe(false);
    expect(isStudioHost('mystudio.builderforce.ai')).toBe(false);
  });

  it('sends the host root to the Studio route and leaves every other path alone', () => {
    expect(studioHostRedirect('/')).toBe(STUDIO_ROUTE);
    expect(studioHostRedirect('/auth/callback')).toBeNull();
    expect(studioHostRedirect('/studio/project/4')).toBeNull();
  });

  it('builds project paths under the Studio route', () => {
    expect(studioProjectPath(42)).toBe('/studio/project/42');
  });
});

/**
 * `studioHostRedirect('/')` is only ever CALLED if two facts outside this module
 * hold, and both were false in production on 2026-10-03 or would have been:
 * the middleware has to match `/`, and the Worker has to be invoked for `/` at
 * all. The second one is the subtle half — with the assets binding, a path with
 * a matching static file is answered by the asset layer and the Worker script
 * never runs, and `/` is prerendered. The unit tests above passed the whole
 * time; `studio.builderforce.ai/` still served the marketing home page.
 */
describe('the studio redirect is reachable in production', () => {
  it('runs the Worker for the host root instead of serving the prerendered asset', () => {
    const wrangler = read('../../../wrangler.toml');
    const rule = wrangler.match(/^run_worker_first\s*=\s*(.+)$/m)?.[1];
    expect(rule, 'frontend/wrangler.toml must declare assets.run_worker_first').toBeDefined();
    expect(rule).toMatch(/(^|[["\s,])"\/"([\]\s,]|$)/);
  });

  it('matches the host root in the middleware matcher', () => {
    const matcher = read('../../middleware.ts').match(/matcher:\s*\[([\s\S]*?)\]/)?.[1];
    expect(matcher, 'src/middleware.ts must export a config.matcher').toBeDefined();
    expect(matcher).toMatch(/(^|\s)'\/',/m);
    expect(matcher).toContain(`'${STUDIO_ROUTE}/:path*'`);
  });
});
