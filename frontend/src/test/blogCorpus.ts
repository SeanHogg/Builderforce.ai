import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BLOG_POSTS, postBody, type BlogPost } from '@/lib/blogData';

/**
 * Every published post WITH its English body, read from disk — for tests only.
 *
 * The app's `BLOG_POSTS` is metadata: bodies are published assets the post route
 * fetches (`lib/blogLocale.ts`), so nothing in the bundle carries them. The guards
 * over article content (figures parse, no leading H1, translations match the
 * English structure) read the same source files the publisher does, cleaned by the
 * same `postBody` the route applies.
 */
export const BLOG_CONTENT_DIR = resolve(__dirname, '../content/blog');

export interface BlogPostWithBody extends BlogPost {
  content: string;
}

export const BLOG_CORPUS: BlogPostWithBody[] = BLOG_POSTS.map((post) => ({
  ...post,
  content: postBody(readFileSync(resolve(BLOG_CONTENT_DIR, `${post.slug}.md`), 'utf8')),
}));
