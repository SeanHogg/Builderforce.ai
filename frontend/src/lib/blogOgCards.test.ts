import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BLOG_POSTS } from './blogData';

/**
 * The OG cards are BUILD artifacts (`scripts/gen-blog-og.mjs`, wired into
 * `prebuild`). A post added without re-running it would advertise a card that
 * 404s — and a 404 card is worse than the generic one it replaced, because the
 * crawler shows nothing at all.
 */
describe('per-article Open Graph cards', () => {
  const dir = join(__dirname, '..', '..', 'public', 'blog', 'og');

  it('renders one card per published post', () => {
    const missing = BLOG_POSTS
      .map((post) => post.slug)
      .filter((slug) => !existsSync(join(dir, `${slug}.png`)));
    expect(missing, 'run `node scripts/gen-blog-og.mjs`').toEqual([]);
  });

  it('has posts at all, so the assertion above is not vacuous', () => {
    expect(BLOG_POSTS.length).toBeGreaterThan(50);
  });
});
