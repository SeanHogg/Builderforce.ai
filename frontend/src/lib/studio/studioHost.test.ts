import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { studioProjectPath, studioSessionPath, STUDIO_ROUTE } from './studioHost';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

describe('studio addressing', () => {
  it('builds project paths under the Studio route', () => {
    expect(studioProjectPath(42)).toBe('/studio/project/42');
  });

  it('builds session paths for the Studio lens — guest and server ids alike', () => {
    expect(studioSessionPath('local-abc')).toBe('/studio/local-abc');
    expect(studioSessionPath('2f1c0b7e-0000-4000-8000-000000000000')).toBe('/studio/2f1c0b7e-0000-4000-8000-000000000000');
  });

  // The host-root redirect is `lib/productHosts.ts` (tested there); the Studio route
  // itself must reach middleware for its IDE page's isolation headers.
  it('matches the Studio route in the middleware matcher', () => {
    const matcher = read('../../middleware.ts').match(/matcher:\s*\[([\s\S]*?)\]/)?.[1];
    expect(matcher).toContain(`'${STUDIO_ROUTE}/:path*'`);
  });
});
