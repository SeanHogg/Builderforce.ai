import { describe, expect, it } from 'vitest';
import { hashedAssetUrls, releaseKeyFromAssets } from './release';

describe('hashedAssetUrls', () => {
  it('keeps URLs whose pathname has an 8+ hex run and sorts them', () => {
    expect(hashedAssetUrls([
      'https://cdn.example/app.a1b2c3d4.js',
      'https://cdn.example/favicon.ico',
      'https://cdn.example/style.deadbeef.css',
    ])).toEqual([
      'https://cdn.example/app.a1b2c3d4.js',
      'https://cdn.example/style.deadbeef.css',
    ]);
  });
});

describe('releaseKeyFromAssets', () => {
  it('returns 12 lowercase hex chars', async () => {
    const key = await releaseKeyFromAssets(['https://cdn.example/app.abcdef12.js']);
    expect(key).toMatch(/^[a-f0-9]{12}$/);
  });

  it('is stable for the same assets in any order', async () => {
    const a = ['https://cdn.example/a.11111111.js', 'https://cdn.example/b.22222222.js'];
    const b = [...a].reverse();
    expect(await releaseKeyFromAssets(a)).toBe(await releaseKeyFromAssets(b));
  });

  it('changes when the hashed set changes', async () => {
    const a = await releaseKeyFromAssets(['https://cdn.example/app.aaaaaaaa.js']);
    const b = await releaseKeyFromAssets(['https://cdn.example/app.bbbbbbbb.js']);
    expect(a).not.toBe(b);
  });
});
