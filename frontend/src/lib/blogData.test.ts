import { describe, it, expect } from 'vitest';
import { BLOG_POSTS, getPostBySlug } from './blogData';

// ---------------------------------------------------------------------------
// BLOG_POSTS
// ---------------------------------------------------------------------------

describe('BLOG_POSTS', () => {
  it('contains at least one post', () => {
    expect(BLOG_POSTS.length).toBeGreaterThan(0);
  });

  it('each post has the required fields', () => {
    for (const post of BLOG_POSTS) {
      expect(typeof post.slug).toBe('string');
      expect(post.slug.length).toBeGreaterThan(0);
      expect(typeof post.title).toBe('string');
      expect(post.title.length).toBeGreaterThan(0);
      expect(typeof post.date).toBe('string');
      expect(typeof post.description).toBe('string');
      expect(Array.isArray(post.tags)).toBe(true);
      expect(typeof post.author).toBe('string');
      expect(typeof post.content).toBe('string');
    }
  });

  it('is sorted newest-first by date', () => {
    for (let i = 1; i < BLOG_POSTS.length; i++) {
      expect(BLOG_POSTS[i - 1].date >= BLOG_POSTS[i].date).toBe(true);
    }
  });

  it('has no duplicate slugs', () => {
    const slugs = BLOG_POSTS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

// ---------------------------------------------------------------------------
// getPostBySlug
// ---------------------------------------------------------------------------

describe('getPostBySlug', () => {
  it('returns the post for a known slug', () => {
    const slug = BLOG_POSTS[0].slug;
    const post = getPostBySlug(slug);
    expect(post).toBeDefined();
    expect(post!.slug).toBe(slug);
  });

  it('returns undefined for an unknown slug', () => {
    expect(getPostBySlug('this-slug-does-not-exist')).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(getPostBySlug('')).toBeUndefined();
  });

  it('content does not start with a top-level H1 heading', () => {
    for (const post of BLOG_POSTS) {
      // The buildPost helper strips "# Title\n" from the body
      expect(post.content.trimStart()).not.toMatch(/^# /);
    }
  });

  it('tags is an array of non-empty strings', () => {
    for (const post of BLOG_POSTS) {
      for (const tag of post.tags) {
        expect(typeof tag).toBe('string');
        expect(tag.length).toBeGreaterThan(0);
      }
    }
  });
});
