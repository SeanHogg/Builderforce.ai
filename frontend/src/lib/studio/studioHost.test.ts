import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deviceBoardPath, isDeviceBoardId, studioBoardHref, studioProjectPath, studioSessionPath, STUDIO_ROUTE } from './studioHost';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

describe('studio addressing', () => {
  it('builds project paths under the Studio route', () => {
    expect(studioProjectPath(42)).toBe('/studio/project/42');
  });

  it('builds session paths for the Studio lens — guest and server ids alike', () => {
    expect(studioSessionPath('local-abc')).toBe('/studio/local-abc');
    expect(studioSessionPath('2f1c0b7e-0000-4000-8000-000000000000')).toBe('/studio/2f1c0b7e-0000-4000-8000-000000000000');
  });

  describe('device board shell', () => {
    const ID = '2f1c0b7e-0000-4000-8000-000000000000';

    it('addresses a held board as a query on the static shell', () => {
      expect(deviceBoardPath(ID)).toBe(`/studio/local?board=${ID}`);
    });

    it('opens the server page online and the device shell offline', () => {
      expect(studioBoardHref(ID, true)).toBe(`/studio/${ID}`);
      expect(studioBoardHref(ID, false)).toBe(`/studio/local?board=${ID}`);
    });

    it('never sends an id the shell cannot open (a legacy local-<uuid>) to the shell', () => {
      expect(studioBoardHref('local-abc', false)).toBe('/studio/local-abc');
    });

    it('accepts only plain board UUIDs', () => {
      expect(isDeviceBoardId(ID)).toBe(true);
      for (const bad of [null, undefined, '', 'local-abc', `${ID}/x`, '../etc']) expect(isDeviceBoardId(bad)).toBe(false);
    });
  });

  // The host-root redirect is `lib/productHosts.ts` (tested there); the Studio route
  // itself must reach middleware for its IDE page's isolation headers.
  it('matches the Studio route in the middleware matcher', () => {
    const matcher = read('../../middleware.ts').match(/matcher:\s*\[([\s\S]*?)\]/)?.[1];
    expect(matcher).toContain(`'${STUDIO_ROUTE}/:path*'`);
  });
});
