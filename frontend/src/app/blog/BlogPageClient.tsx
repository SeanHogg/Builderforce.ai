'use client';

import { useCallback, useMemo } from 'react';
import { Icon } from '@/components/ui/Icon';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BLOG_POSTS } from '@/lib/blogData';
import JsonLd from '@/components/JsonLd';
import { blogIndexSchema } from '@/lib/structured-data';
import { ArticleCardGrid, ArticleRows } from '@/components/blog/ArticleCard';
import { CatalogToolbar } from '@/components/CatalogToolbar';
import { FilterChips, type FilterChip } from '@/components/FilterChips';
import { Pagination } from '@/components/Pagination';
import { CatalogInsightsBar, type CatalogInsightsItem } from '@/components/CatalogInsightsBar';
import type { ViewMode } from '@/components/ViewToggle';
import {
  BLOG_TOPICS,
  filterPosts,
  isBlogTopic,
  topTagsFor,
  topicCounts,
  topicOf,
} from '@/lib/blogTopics';

/** Articles per page on the /blog index. */
const PAGE_SIZE = 9;

/**
 * The /blog index.
 *
 * It browses a catalogue of 125+ articles, so it carries the same four controls
 * every other catalogue surface on the site carries — search, category filters,
 * a Card | List toggle and pagination — plus the insights strip /prompts
 * established. Before this it had a page number and nothing else, which is a
 * fine control for nine articles and useless for a hundred and twenty-five.
 *
 * ALL of that state lives in the URL. A reader who filters to "Careers", searches
 * "resume" and switches to the list can send that link to somebody; back and
 * forward move through it; a refresh keeps it. That was already true of `?page=`
 * and there is no reason for the other four to behave differently.
 */
export default function BlogPageClient() {
  const t = useTranslations('blog');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = searchParams.get('q') ?? '';
  const topicParam = searchParams.get('topic') ?? '';
  const topic = isBlogTopic(topicParam) ? topicParam : '';
  const tag = searchParams.get('tag') ?? '';
  const view: ViewMode = searchParams.get('view') === 'table' ? 'table' : 'card';

  /**
   * Write the filter state back to the URL.
   *
   * ONE writer for every control, so a control can never forget to reset the
   * page — which is the bug where filtering from page 6 of Careers to a topic
   * with two articles lands a reader on an empty grid.
   *
   * Typing REPLACES and everything else PUSHES: a chip press and a page turn are
   * steps a reader expects Back to undo, but a search box that pushed per
   * keystroke would bury them under one history entry per character.
   */
  const setParams = useCallback(
    (next: Record<string, string>, { keepPage = false, replace = false } = {}) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(next)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      if (!keepPage) params.delete('page');
      const qs = params.toString();
      const href = qs ? `${pathname}?${qs}` : pathname;
      if (replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  // Topic counts are of the whole corpus, not of the current result set: a chip
  // reads "Canvas 21" whatever else is selected, so the number tells a reader
  // what pressing it is worth rather than what they have already filtered away.
  const counts = useMemo(() => topicCounts(BLOG_POSTS), []);

  const topicChips: FilterChip[] = useMemo(
    () => [
      { id: '', label: t('topic.all'), count: BLOG_POSTS.length },
      ...BLOG_TOPICS.map((entry) => ({
        id: entry.id,
        label: t(`topic.${entry.labelKey}` as never),
        count: counts[entry.id] ?? 0,
      })),
    ],
    [counts, t],
  );

  // Posts in the active topic, before the tag and the query narrow them — the
  // set the tag chips are derived from, so a tag chip always has articles behind
  // it even while a query is selecting none of them.
  const inTopic = useMemo(
    () => (topic ? BLOG_POSTS.filter((post) => topicOf(post) === topic) : BLOG_POSTS),
    [topic],
  );

  const tagChips: FilterChip[] = useMemo(() => {
    const tags = topTagsFor(inTopic, 12);
    // A tag arriving from the URL that this topic does not carry still needs a
    // chip, or the reader sees a filtered grid with nothing showing it is on.
    const ids = tag && !tags.includes(tag) ? [tag, ...tags] : tags;
    return [{ id: '', label: t('tag.all') }, ...ids.map((id) => ({ id, label: id }))];
  }, [inTopic, tag, t]);

  const results = useMemo(() => filterPosts(BLOG_POSTS, { topic, tag, query }), [topic, tag, query]);

  const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const parsed = parseInt(searchParams.get('page') ?? '1', 10);
  const current = Math.min(Math.max(Number.isFinite(parsed) ? parsed : 1, 1), totalPages);
  const visible = results.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const goToPage = (page: number) => {
    setParams({ page: page === 1 ? '' : String(page) }, { keepPage: true });
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // The insights strip reads the WHOLE corpus, not the filtered page: it is the
  // shape of the library, and a shape that changed every keystroke would be a
  // readout of the search box rather than of the blog.
  const insightItems: CatalogInsightsItem[] = useMemo(
    () =>
      BLOG_POSTS.map((post) => ({
        key: post.slug,
        name: post.title,
        group: t(`topic.${topicOf(post)}` as never),
      })),
    [t],
  );

  const tagBars = useMemo(() => {
    const counted = new Map<string, number>();
    for (const post of BLOG_POSTS) {
      for (const postTag of post.tags) counted.set(postTag, (counted.get(postTag) ?? 0) + 1);
    }
    return [...counted.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 6)
      .map(([label, value]) => ({ key: label, label, value }));
  }, []);

  const distinctTags = useMemo(
    () => new Set(BLOG_POSTS.flatMap((post) => post.tags)).size,
    [],
  );

  return (
    <>
      <style>{`
        .blog-page {
          position: relative;
          z-index: 1;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }

        /* ── HERO ── */
        /* THE marketing column (globals.css) — same measure as the header. */
        .blog-hero {
          max-width: var(--marketing-max);
          box-sizing: border-box;
          margin: 0 auto;
          padding: 44px var(--marketing-gutter) 32px;
          text-align: center;
          animation: blog-fadeInUp 0.7s ease-out both;
        }
        @keyframes blog-fadeInUp {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .blog-hero-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: var(--surface-coral-soft);
          border: 1px solid var(--border-accent);
          border-radius: var(--radius-full);
          padding: 5px 16px;
          font-family: var(--font-display);
          font-size: var(--font-size-eyebrow);
          font-weight: 600;
          color: var(--coral-bright);
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin-bottom: 20px;
        }
        .blog-hero-title {
          font-family: var(--font-display);
          font-size: var(--font-size-page-title);
          font-weight: 700;
          letter-spacing: -0.03em;
          line-height: 1.1;
          background: linear-gradient(135deg, var(--hero-title-start) 0%, var(--coral-bright) 46%, var(--hero-title-end) 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin-bottom: 16px;
        }
        .blog-hero-desc {
          font-size: var(--font-size-card-title);
          color: var(--text-secondary);
          max-width: 520px;
          margin: 0 auto;
          line-height: 1.7;
        }

        /* ── RESULTS ── */
        .blog-main {
          flex: 1;
          max-width: var(--marketing-max);
          box-sizing: border-box;
          margin: 0 auto;
          padding: 8px var(--marketing-gutter) 72px;
          width: 100%;
        }
        /* Card, row and grid styles live in components/blog/ArticleCard.tsx */
        .blog-filters {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-bottom: 18px;
        }
        .blog-empty {
          text-align: center;
          padding: 56px 16px;
          color: var(--text-muted);
          font-size: var(--font-size-small);
        }
        .blog-empty button {
          margin-top: 14px;
        }

        @media (max-width: 640px) {
          .blog-hero { padding: 40px 20px 20px; }
          .blog-main { padding: 8px 16px 48px; }
        }
      `}</style>

      <JsonLd data={blogIndexSchema(BLOG_POSTS)} />

      <div className="blog-page">
        {/* ── Hero ── */}
        <div className="blog-hero">
          <div className="blog-hero-badge"><Icon source="📝" size="1em" /> {t('badge')}</div>
          <h1 className="blog-hero-title">{t('title')}</h1>
          <p className="blog-hero-desc">{t('desc')}</p>
        </div>

        <main className="blog-main">
          <CatalogInsightsBar
            entity="articles"
            items={insightItems}
            groupKind="topic"
            bars={{ title: t('insights.topTags'), data: tagBars }}
            extraStats={[
              { key: 'topics', label: t('insights.topics'), value: String(Object.keys(counts).length) },
              { key: 'tags', label: t('insights.tags'), value: String(distinctTags) },
            ]}
          />

          <div className="blog-filters">
            <FilterChips
              chips={topicChips}
              value={topic}
              onChange={(id) => setParams({ topic: id, tag: '' })}
              ariaLabel={t('topic.label')}
            />
            <FilterChips
              chips={tagChips}
              value={tag}
              onChange={(id) => setParams({ tag: id })}
              ariaLabel={t('tag.label')}
              size="sm"
            />
          </div>

          <CatalogToolbar
            search={query}
            onSearch={(value) => setParams({ q: value }, { replace: true })}
            searchPlaceholder={t('searchPlaceholder')}
            view={view}
            onView={(mode) => setParams({ view: mode === 'card' ? '' : mode }, { keepPage: true })}
            resultCount={results.length}
          />

          {results.length === 0 ? (
            <div className="blog-empty">
              <p>{t('empty')}</p>
              <button type="button" className="btn btn-secondary" onClick={() => setParams({ q: '', topic: '', tag: '' })}>
                {t('clearFilters')}
              </button>
            </div>
          ) : view === 'table' ? (
            <ArticleRows posts={visible} />
          ) : (
            <ArticleCardGrid posts={visible} />
          )}

          <Pagination
            page={current}
            pageCount={totalPages}
            onChange={goToPage}
            ariaLabel={t('paginationLabel')}
          />
        </main>

        {/* Footer is the canonical <AppFooter variant="full"> rendered by PublicShell. */}
      </div>
    </>
  );
}
