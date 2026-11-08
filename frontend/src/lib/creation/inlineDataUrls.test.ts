import { describe, expect, it } from 'vitest';
import { isCompleteDataUrl, preserveInlineDataUrls } from './inlineDataUrls';

const ART = `data:image/png;base64,${'QUJD'.repeat(50)}`;

describe('preserveInlineDataUrls', () => {
  it('regression: a Brain patch that echoes comicPages truncated to 40k keeps the inline art', () => {
    const big = `data:image/png;base64,${'A'.repeat(60_000)}`;
    const current = { comicPages: [{ id: 'p1', panels: [{ id: 'a', image: big }, { id: 'b', image: ART }] }] };
    const truncated = big.slice(0, 40_000);
    const patch = { comicPages: [{ id: 'p1', panels: [{ id: 'a', image: truncated, caption: 'new' }, { id: 'b', image: ART.slice(0, -3) }] }] };
    const next = preserveInlineDataUrls(current, patch);
    expect(next.comicPages[0]!.panels[0]!.image).toBe(big);
    expect(next.comicPages[0]!.panels[0]).toMatchObject({ caption: 'new' });
    expect(next.comicPages[0]!.panels[1]!.image).toBe(ART);
  });

  it('keeps the art against an oversized string that is not a complete data URL', () => {
    expect(preserveInlineDataUrls({ image: ART }, { image: 'x'.repeat(40_000) }).image).toBe(ART);
  });

  it('lets an https URL replace inline art (a real hosted replacement)', () => {
    expect(preserveInlineDataUrls({ image: ART }, { image: 'https://cdn.example/a.png' }).image).toBe('https://cdn.example/a.png');
  });

  it("lets '' clear inline art (a deliberate clear)", () => {
    expect(preserveInlineDataUrls({ image: ART }, { image: '' }).image).toBe('');
  });

  it('lets a complete data URL replace the art, and leaves non-data fields alone', () => {
    const other = `data:image/png;base64,${'QkJC'.repeat(20)}`;
    expect(preserveInlineDataUrls({ image: ART, title: 'a' }, { image: other, title: 'b' })).toEqual({ image: other, title: 'b' });
  });

  it('follows array items by id when the patch reorders them', () => {
    const current = { pages: [{ id: 'x', image: ART }, { id: 'y', image: 'https://e/y.png' }] };
    const next = preserveInlineDataUrls(current, { pages: [{ id: 'y', image: 'z' }, { id: 'x', image: ART.slice(0, -3) }] });
    expect(next.pages).toEqual([{ id: 'y', image: 'z' }, { id: 'x', image: ART }]);
  });

  it('returns the same patch object when nothing needed restoring', () => {
    const patch = { title: 'fine' };
    expect(preserveInlineDataUrls({ title: 'old' }, patch)).toBe(patch);
    expect(preserveInlineDataUrls(null, patch)).toBe(patch);
  });

  it('knows a complete data URL from a cut one', () => {
    expect(isCompleteDataUrl(ART)).toBe(true);
    expect(isCompleteDataUrl(ART.slice(0, -1))).toBe(false);
    expect(isCompleteDataUrl('https://x/y.png')).toBe(false);
    expect(isCompleteDataUrl(`data:image/png;base64,${'A'.repeat(40_000)}`)).toBe(false);
  });
});
