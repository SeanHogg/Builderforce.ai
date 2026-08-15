import { describe, expect, it } from 'vitest';
import { APP_PACKAGE_TARGETS, accentForApp, appSlug, isAppPackageTarget, packageAppTarget } from './packageApp';
import { capacitorWebAssets } from '../game/adapters/capacitor';
import type { GameTargetContext } from '../game/gameTarget';

describe('app packaging targets', () => {
  it('offers the installable ones and refuses the rest', () => {
    expect([...APP_PACKAGE_TARGETS]).toEqual(['pwa', 'android', 'ios']);
    expect(isAppPackageTarget('android')).toBe(true);
    // `roblox` re-authors against a different engine; `web` is already answered by
    // the live preview and the published site.
    expect(isAppPackageTarget('roblox')).toBe(false);
    expect(isAppPackageTarget('web')).toBe(false);
    expect(isAppPackageTarget('nonsense')).toBe(false);
  });
});

describe('appSlug', () => {
  it('produces a file- and bundle-safe stem', () => {
    expect(appSlug('Recipe Box')).toBe('recipe-box');
    expect(appSlug('  ¡Hola! ')).toBe('hola');
  });

  it('never returns empty', () => {
    expect(appSlug('!!!')).toBe('app');
    expect(appSlug('')).toBe('app');
  });
});

describe('accentForApp', () => {
  // A launcher icon that changes colour on every build looks like a different app
  // to the person who installed it.
  it('is stable for a given name', () => {
    expect(accentForApp('Recipe Box')).toBe(accentForApp('Recipe Box'));
    expect(accentForApp('Recipe Box')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('differs between names', () => {
    expect(accentForApp('Recipe Box')).not.toBe(accentForApp('Invoice Tracker'));
  });
});

const ctxFor = (game: GameTargetContext['game']): GameTargetContext => ({
  projectId: 1,
  tenantId: 1,
  projectName: 'p',
  game,
  apiOrigin: 'https://api.test',
  siteUrl: null,
  secretNames: [],
});

describe('capacitorWebAssets with a built bundle', () => {
  const base = { title: 'Recipe Box', slug: 'recipe-box', brief: 'b', accent: '#4d9eff' };

  it('ships every file of a built dist under www/, not just one document', () => {
    const { files } = capacitorWebAssets(ctxFor({
      ...base,
      html: '<html><head></head><body>app</body></html>',
      webAssets: {
        'index.html': '<html><head></head><body>app</body></html>',
        'assets/app.js': 'console.log(1)',
        'assets/app.css': 'body{}',
      },
    }));
    expect(Object.keys(files).sort()).toEqual(['www/assets/app.css', 'www/assets/app.js', 'www/index.html']);
    // Only the entry document is touched, and only to point at the icons.
    expect(files['www/index.html']).toContain('icons/icon-512.png');
    expect(files['www/assets/app.js']).toBe('console.log(1)');
  });

  it('carries binary assets through unchanged', () => {
    const png = new Uint8Array([1, 2, 3]);
    const { binaryFiles } = capacitorWebAssets(ctxFor({
      ...base,
      html: '<html><head></head><body></body></html>',
      webAssets: { 'index.html': '<html><head></head><body></body></html>' },
      binaryAssets: { 'assets/logo.png': png },
    }));
    expect(binaryFiles['www/assets/logo.png']).toBe(png);
    // …alongside the generated launcher icons, which it must not displace.
    expect(binaryFiles['resources/icon.png']).toBeInstanceOf(Uint8Array);
  });

  // The touch layer gives a keyboard-driven GAME on-screen controls. Putting a
  // D-pad over an app's login form would be worse than useless.
  it('injects the touch layer for a game and never for an app bundle', () => {
    const asGame = capacitorWebAssets(ctxFor({ ...base, html: '<html><head></head><body>game</body></html>' }));
    const asApp = capacitorWebAssets(ctxFor({
      ...base,
      html: '<html><head></head><body>app</body></html>',
      webAssets: { 'index.html': '<html><head></head><body>app</body></html>' },
    }));
    expect(asGame.files['www/index.html']!.length).toBeGreaterThan(asApp.files['www/index.html']!.length);
  });
});

describe('packageAppTarget guards', () => {
  const args = {
    env: {} as never,
    db: {} as never,
    bucket: {} as never,
    tenantId: 1,
    projectId: 1,
    projectName: 'Recipe Box',
  };

  it('refuses a target that is not an app packaging target', async () => {
    const result = await packageAppTarget({ ...args, target: 'roblox', bundle: { files: { 'index.html': 'x' }, binaryFiles: {} } });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain('not an app packaging target');
  });

  // Refused BEFORE anything is written, because the alternative is discovering it
  // after a five-minute APK build on a runner.
  it('refuses a bundle with no entry document', async () => {
    const result = await packageAppTarget({ ...args, target: 'pwa', bundle: { files: { 'assets/app.js': 'x' }, binaryFiles: {} } });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain('index.html');
  });
});
