import { describe, expect, it } from 'vitest';
import en from '@/i18n/messages/en.json';
import zh from '@/i18n/messages/zh.json';
import es from '@/i18n/messages/es.json';
import fr from '@/i18n/messages/fr.json';
import de from '@/i18n/messages/de.json';
import { BLOG_POSTS } from './blogData';
import { OPEN_SOURCE_PACKAGES, openSourceBySlug, openSourcePath, packageRegistryUrl } from './openSourcePackages';

/**
 * The registry supplies the SUFFIX of every `openSource.packages.<key>.*` lookup,
 * which `check-i18n-keys` cannot resolve statically — so this is where those keys
 * are proven, by enumerating the registry in all five catalogs. The arrays (`gets`,
 * comparison `rows`) are invisible to the catalog parity test, so their lengths
 * are compared here too.
 */
const CATALOGS = { en, zh, es, fr, de } as unknown as Record<string, Record<string, unknown>>;

const at = (root: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], root);

const STRING_KEYS = ['tagline', 'summary', 'problem', 'status', 'quickStartNote', 'usage'];
const COMPARISON_STRINGS = ['title', 'intro', 'ours', 'theirs', 'note'];

describe('open-source registry', () => {
  it('declares each slug and catalog key once', () => {
    const slugs = OPEN_SOURCE_PACKAGES.map((entry) => entry.slug);
    const keys = OPEN_SOURCE_PACKAGES.map((entry) => entry.key);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('resolves every slug to its own detail path', () => {
    for (const entry of OPEN_SOURCE_PACKAGES) {
      expect(openSourceBySlug(entry.slug)).toBe(entry);
      expect(openSourcePath(entry)).toBe(`/open-source/${entry.slug}`);
    }
    expect(openSourceBySlug('not-a-package')).toBeUndefined();
  });

  it('links a registry page only for npm-distributed packages', () => {
    for (const entry of OPEN_SOURCE_PACKAGES) {
      for (const name of entry.packages) {
        const url = packageRegistryUrl(entry, name);
        if (entry.distribution === 'npm') expect(url).toBe(`https://www.npmjs.com/package/${name}`);
        else expect(url).toBeUndefined();
      }
    }
  });

  it('points each related article at a published post', () => {
    const published = new Set(BLOG_POSTS.map((post) => post.slug));
    const dangling = OPEN_SOURCE_PACKAGES
      .filter((entry) => entry.relatedBlogSlug && !published.has(entry.relatedBlogSlug))
      .map((entry) => entry.slug);
    expect(dangling).toEqual([]);
  });

  it.each(Object.keys(CATALOGS))('%s carries the copy for every registry row', (locale) => {
    const catalog = CATALOGS[locale];
    const reference = CATALOGS.en;
    const gaps: string[] = [];
    for (const entry of OPEN_SOURCE_PACKAGES) {
      const base = `openSource.packages.${entry.key}`;
      for (const key of STRING_KEYS) {
        const value = at(catalog, `${base}.${key}`);
        if (typeof value !== 'string' || value.length === 0) gaps.push(`${base}.${key}`);
      }
      const gets = at(catalog, `${base}.gets`);
      if (!Array.isArray(gets) || gets.length !== (at(reference, `${base}.gets`) as unknown[]).length) {
        gaps.push(`${base}.gets`);
      }
      const comparison = at(catalog, `${base}.comparison`);
      if (entry.hasComparison) {
        for (const key of COMPARISON_STRINGS) {
          if (typeof at(comparison, key) !== 'string') gaps.push(`${base}.comparison.${key}`);
        }
        const rows = at(comparison, 'rows') as { aspect?: string; ours?: string; theirs?: string }[] | undefined;
        const enRows = at(reference, `${base}.comparison.rows`) as unknown[];
        if (!Array.isArray(rows) || rows.length !== enRows.length || rows.some((row) => !row.aspect || !row.ours || !row.theirs)) {
          gaps.push(`${base}.comparison.rows`);
        }
      } else if (comparison !== undefined) {
        gaps.push(`${base}.comparison (present but hasComparison is false)`);
      }
    }
    const why = at(catalog, 'openSource.why.points');
    if (!Array.isArray(why) || why.length !== (at(reference, 'openSource.why.points') as unknown[]).length) {
      gaps.push('openSource.why.points');
    }
    expect(gaps).toEqual([]);
  });
});
