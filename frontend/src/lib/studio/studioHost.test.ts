import { describe, expect, it } from 'vitest';
import { isStudioHost, studioHostRedirect, studioProjectPath, STUDIO_ROUTE } from './studioHost';

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
