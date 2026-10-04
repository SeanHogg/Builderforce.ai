import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { studioProjectPath, STUDIO_ROUTE } from './studioHost';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

describe('studio addressing', () => {
  it('builds project paths under the Studio route', () => {
    expect(studioProjectPath(42)).toBe('/studio/project/42');
  });

  // The host-root redirect is `lib/productHosts.ts` (tested there); the Studio route
  // itself must reach middleware for its IDE page's isolation headers.
  it('matches the Studio route in the middleware matcher', () => {
    const matcher = read('../../middleware.ts').match(/matcher:\s*\[([\s\S]*?)\]/)?.[1];
    expect(matcher).toContain(`'${STUDIO_ROUTE}/:path*'`);
  });
});
