import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTranslator } from 'next-intl';
import en from '@/i18n/messages/en.json';
import zh from '@/i18n/messages/zh.json';
import es from '@/i18n/messages/es.json';
import fr from '@/i18n/messages/fr.json';
import de from '@/i18n/messages/de.json';
import { DEFAULT_LOCALE, LOCALES, type Locale } from '@/i18n/config';
import { BLOG_POSTS, postBody } from './blogData';
import { blogPostKey, blogTagKey, blogTagLabel, loadPostBody, localizePost, type BlogText } from './blogLocale';

/**
 * The blog, in five languages — the guard for `lib/blogLocale.ts`.
 *
 * A translated article can be wrong in two ways nobody sees in English: it can
 * be MISSING (the reader silently gets English, or a dotted key where a title
 * belongs), or it can be BROKEN — a translator dropped a section, rewrote a link,
 * or "translated" a figure's `kind` so the figure falls back to a code block. The
 * first is a catalog/file-presence check; the second is a structural diff against
 * the English post, which is what makes a translation reviewable without reading
 * Chinese.
 */

const CATALOGS: Record<Locale, Record<string, unknown>> = { en, zh, es, fr, de } as never;
const TRANSLATED = LOCALES.filter((locale) => locale !== DEFAULT_LOCALE);
const CONTENT_DIR = resolve(__dirname, '../content/blog');

function blogText(locale: Locale): BlogText {
  return createTranslator({ locale, messages: CATALOGS[locale] as never, namespace: 'blog' as never, onError: () => {} }) as unknown as BlogText;
}

/** Headings, fences, link/image targets and figure data of a markdown body. */
function structure(markdown: string) {
  const headings: number[] = [];
  const fences: string[] = [];
  const figures: unknown[] = [];
  let inFence = false;
  let fenceLang = '';
  let fenceBody: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const fence = line.match(/^\s*```(\S*)/);
    if (fence) {
      if (!inFence) { inFence = true; fenceLang = fence[1]; fenceBody = []; fences.push(fenceLang); continue; }
      inFence = false;
      if (fenceLang === 'bf-figure') {
        try { figures.push(figureShape(JSON.parse(fenceBody.join('\n')))); } catch { figures.push('INVALID JSON'); }
      }
      continue;
    }
    if (inFence) { fenceBody.push(line); continue; }
    const heading = line.match(/^(#{1,6})\s/);
    if (heading) headings.push(heading[1].length);
  }
  const targets = new Set([...markdown.matchAll(/\]\(([^)\s]+)/g)].map((m) => m[1]));
  return { headings, fences, figures, targets: [...targets].sort() };
}

/** Human-visible strings a translator may rewrite; every other value must survive verbatim. */
const TRANSLATABLE = new Set(['title', 'caption', 'label', 'note', 'tag', 'items', 'frame', 'xLabel', 'yLabel']);
function figureShape(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => figureShape(item, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, figureShape(v, k)]));
  }
  return typeof value === 'string' && TRANSLATABLE.has(key) ? 'string' : value;
}

describe('catalog copy', () => {
  it('mirrors each post’s front-matter in the English catalog', () => {
    // The .md front-matter is the English source; the catalog entry exists so the
    // other four can be keyed against it. The two must not drift.
    const t = blogText('en');
    const drift = BLOG_POSTS.filter((post) => t(blogPostKey(post.slug, 'title')) !== post.title || t(blogPostKey(post.slug, 'description')) !== post.description)
      .map((post) => post.slug);
    expect(drift).toEqual([]);
  });

  it.each(LOCALES)('%s titles and describes every post', (locale) => {
    const t = blogText(locale);
    const missing = BLOG_POSTS.flatMap((post) => (['title', 'description'] as const).map((field) => blogPostKey(post.slug, field)))
      .filter((key) => !t.has(key) || !t(key).trim());
    expect(missing).toEqual([]);
  });

  it.each(LOCALES)('%s labels every tag', (locale) => {
    const t = blogText(locale);
    const tags = [...new Set(BLOG_POSTS.flatMap((post) => post.tags))];
    expect(tags.filter((tag) => !t.has(blogTagKey(tag)))).toEqual([]);
  });

  it('localizes a post, and keeps the English copy for one with no entry', () => {
    const post = BLOG_POSTS[0];
    const zhPost = localizePost(post, blogText('zh'));
    expect(zhPost.title).toBe(blogText('zh')(blogPostKey(post.slug, 'title')));
    expect(zhPost.tags).toEqual(post.tags);
    const unknown = { ...post, slug: 'not-a-real-post' };
    expect(localizePost(unknown, blogText('zh')).title).toBe(post.title);
    expect(blogTagLabel('not-a-real-tag', blogText('zh'))).toBe('not-a-real-tag');
  });
});

describe('translated bodies', () => {
  it.each(TRANSLATED)('%s has a body for every post, structurally identical to the English', (locale) => {
    const problems: string[] = [];
    for (const post of BLOG_POSTS) {
      const file = resolve(CONTENT_DIR, `${post.slug}.${locale}.md`);
      if (!existsSync(file)) { problems.push(`${post.slug}: missing`); continue; }
      const translated = structure(postBody(readFileSync(file, 'utf8')));
      const english = structure(post.content);
      if (JSON.stringify(translated.headings) !== JSON.stringify(english.headings)) problems.push(`${post.slug}: headings ${translated.headings.length} vs ${english.headings.length}`);
      if (JSON.stringify(translated.fences) !== JSON.stringify(english.fences)) problems.push(`${post.slug}: code fences differ`);
      if (JSON.stringify(translated.figures) !== JSON.stringify(english.figures)) problems.push(`${post.slug}: bf-figure data differs`);
      if (JSON.stringify(translated.targets) !== JSON.stringify(english.targets)) problems.push(`${post.slug}: link/image targets differ`);
    }
    expect(problems).toEqual([]);
  });
});

describe('loadPostBody', () => {
  afterEach(() => vi.unstubAllGlobals());
  const post = BLOG_POSTS[0];

  it('serves the bundled English body for the default locale without a fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await loadPostBody(post, 'en', 'https://example.test')).toBe(post.content);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches the published translation and cleans it the way the English is cleaned', async () => {
    const fetchSpy = vi.fn(async () => new Response('# Titel\n\nHallo Welt.\n', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    expect(await loadPostBody(post, 'de', 'https://example.test')).toBe('Hallo Welt.');
    expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toMatch(new RegExp(`^https://example\\.test/blog-i18n/de/${post.slug}\\.md\\?v=`));
  });

  it('falls back to English when the translation is missing or unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    expect(await loadPostBody(post, 'fr', 'https://example.test')).toBe(post.content);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadPostBody(post, 'fr', 'https://example.test')).toBe(post.content);
  });
});
