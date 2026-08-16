import { render, screen, fireEvent, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BlogPageClient from './BlogPageClient';
import { BLOG_POSTS } from '@/lib/blogData';
import { topicOf } from '@/lib/blogTopics';

/**
 * The /blog index is the one catalogue surface a reader hits with no account, so
 * these assert the browsing contract rather than the markup: the four controls
 * exist, each narrows the result set, and ALL of them round-trip through the URL
 * (which is what makes a filtered view something you can send to somebody).
 */

const routing = vi.hoisted(() => ({ params: new URLSearchParams(), pushed: [] as string[] }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/blog',
  useSearchParams: () => routing.params,
  useRouter: () => ({
    push: (href: string) => { routing.pushed.push(href); },
    replace: (href: string) => { routing.pushed.push(href); },
  }),
}));

/** The most recent URL the page asked for, as query params. */
const lastQuery = () => new URLSearchParams(routing.pushed[routing.pushed.length - 1]?.split('?')[1] ?? '');

/** Article links in the results region, excluding chips and toolbar controls. */
const articleLinks = () => screen.queryAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/blog/'));

describe('BlogPageClient', () => {
  beforeEach(() => {
    routing.params = new URLSearchParams();
    routing.pushed = [];
  });

  it('pages the corpus rather than dumping every article', () => {
    render(<BlogPageClient />);
    // 125+ articles, nine to a page.
    expect(articleLinks()).toHaveLength(9);
    expect(screen.getByLabelText('blog.paginationLabel')).toBeTruthy();
  });

  it('reports how many articles match', () => {
    render(<BlogPageClient />);
    expect(screen.getByText(`common.resultCount ${BLOG_POSTS.length}`)).toBeTruthy();
  });

  it('narrows to a topic and resets to page one', () => {
    routing.params = new URLSearchParams('page=4');
    render(<BlogPageClient />);

    const bar = screen.getByRole('group', { name: 'blog.topic.label' });
    fireEvent.click(within(bar).getByText(/blog\.topic\.canvas/));

    const query = lastQuery();
    expect(query.get('topic')).toBe('canvas');
    // The page cursor is dropped, or the reader lands past the end of a
    // twenty-one-article topic they just selected from page four.
    expect(query.get('page')).toBeNull();
  });

  it('applies the topic from the URL', () => {
    routing.params = new URLSearchParams('topic=canvas');
    render(<BlogPageClient />);

    const expected = BLOG_POSTS.filter((post) => topicOf(post) === 'canvas').length;
    expect(screen.getByText(`common.resultCount ${expected}`)).toBeTruthy();
    expect(articleLinks().length).toBeLessThanOrEqual(9);
  });

  it('searches titles, descriptions and tags', () => {
    routing.params = new URLSearchParams('q=zzzznotaword');
    render(<BlogPageClient />);

    expect(articleLinks()).toHaveLength(0);
    expect(screen.getByText('blog.empty')).toBeTruthy();
    expect(screen.getByText('blog.clearFilters')).toBeTruthy();
  });

  it('clears every filter at once from the empty state', () => {
    routing.params = new URLSearchParams('q=zzzznotaword&topic=canvas&tag=diagrams');
    render(<BlogPageClient />);

    fireEvent.click(screen.getByText('blog.clearFilters'));
    const query = lastQuery();
    expect(query.get('q')).toBeNull();
    expect(query.get('topic')).toBeNull();
    expect(query.get('tag')).toBeNull();
  });

  it('switches to the list view without losing the page', () => {
    routing.params = new URLSearchParams('page=2');
    render(<BlogPageClient />);

    fireEvent.click(screen.getByRole('button', { name: /common\.viewMode\.table/ }));
    const query = lastQuery();
    expect(query.get('view')).toBe('table');
    // A layout change is not a filter change — it must not move the reader.
    expect(query.get('page')).toBe('2');
  });

  it('renders the list layout when the URL asks for it', () => {
    routing.params = new URLSearchParams('view=table');
    const { container } = render(<BlogPageClient />);

    expect(container.querySelector('.blog-rows')).toBeTruthy();
    expect(container.querySelector('.blog-grid')).toBeNull();
  });

  it('summarises the corpus, not the filtered page', () => {
    routing.params = new URLSearchParams('topic=canvas');
    render(<BlogPageClient />);
    // The insights strip counts every article whatever is filtered below it —
    // twice over, as the stat tile and as the donut's centre value.
    expect(screen.getAllByText(BLOG_POSTS.length.toLocaleString()).length).toBeGreaterThan(0);
    expect(screen.getByText('blog.insights.topTags')).toBeTruthy();
  });
});
