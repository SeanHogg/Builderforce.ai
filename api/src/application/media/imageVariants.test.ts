/**
 * AN UNBOUNDED `?w=` IS A BILL AND A BUCKET.
 *
 * Each accepted width costs one edge transformation AND one stored R2 object, per image.
 * An attacker walking `w=1..2000` against every public avatar would multiply both. The
 * closed set is the control, so the assertions below are mostly about what is REFUSED —
 * and about the third outcome, `null`, which is the pre-existing "serve the original"
 * contract that every stored `users.avatar_url` still depends on.
 */
import { describe, expect, it } from 'vitest';
import {
  AVATAR_WIDTHS,
  avatarVariantKey,
  isResizable,
  parseAvatarWidth,
} from './imageVariants';

describe('parseAvatarWidth', () => {
  it('accepts every declared width', () => {
    for (const width of AVATAR_WIDTHS) {
      expect(parseAvatarWidth(String(width))).toBe(width);
    }
  });

  it('returns null — not a width — when none was asked for', () => {
    // The pre-existing contract: no `w` means the ORIGINAL bytes, which is what every
    // `users.avatar_url` already stored points at.
    expect(parseAvatarWidth(undefined)).toBeNull();
    expect(parseAvatarWidth(null)).toBeNull();
    expect(parseAvatarWidth('')).toBeNull();
  });

  it('refuses an undeclared width instead of quietly serving full size', () => {
    // Collapsing "invalid" into "none" would make a typo return a 5 MB image at a
    // 40-pixel render site — exactly the byte bill the variants exist to remove.
    for (const bad of ['1', '100', '2000', '513', '-64', '64.5', 'big', '64px', 'NaN']) {
      expect(parseAvatarWidth(bad)).toBe('invalid');
    }
  });

  it('refuses values that would be resource exhaustion', () => {
    expect(parseAvatarWidth('999999')).toBe('invalid');
    expect(parseAvatarWidth('0')).toBe('invalid');
  });

  it('keeps the width list small — every entry multiplies stored objects', () => {
    expect(AVATAR_WIDTHS.length).toBeLessThanOrEqual(6);
  });
});

describe('avatarVariantKey', () => {
  it('derives the key from the ORIGINAL key, inheriting its immutability', () => {
    // The original carries a fresh UUID per upload, so a variant of it can never be
    // stale — which is why the response may be cached `immutable`.
    const original = 'avatars/u-1/8f14e45f-ea8f-4b3e-9f2a-000000000001.png';
    expect(avatarVariantKey(original, 128)).toBe(`${original}@w128.webp`);
  });

  it('gives each width its own key', () => {
    const original = 'avatars/u-1/a.png';
    const keys = new Set(AVATAR_WIDTHS.map((width) => avatarVariantKey(original, width)));
    expect(keys.size).toBe(AVATAR_WIDTHS.length);
  });

  it('keeps variants under the original\'s prefix, so a cleanup finds them', () => {
    const original = 'avatars/u-1/a.png';
    expect(avatarVariantKey(original, 64).startsWith(original)).toBe(true);
  });
});

describe('isResizable', () => {
  it('accepts the still formats the upload allows', () => {
    expect(isResizable('image/png')).toBe(true);
    expect(isResizable('image/jpeg')).toBe(true);
    expect(isResizable('image/webp')).toBe(true);
  });

  it('refuses GIF, so an animation is never silently replaced by one frame of it', () => {
    expect(isResizable('image/gif')).toBe(false);
  });

  it('refuses anything it does not recognise', () => {
    expect(isResizable('application/octet-stream')).toBe(false);
    expect(isResizable(undefined)).toBe(false);
    expect(isResizable(null)).toBe(false);
  });

  it('is case-insensitive, because a content type off the wire may not be lowercase', () => {
    expect(isResizable('Image/PNG')).toBe(true);
  });
});
