import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import BlogFigure, { parseFigure, type FigureSpec } from './BlogFigure';
import { BLOG_POSTS } from '@/lib/blogData';
import { PROOF_FORMS } from '@/lib/methodology';
import { RESUME_TEMPLATES } from '@/lib/canvasResume';

/**
 * Figures are DATA inside a markdown file, which means a typo in one is a
 * silent failure: `parseFigure` returns null, the renderer falls back to a code
 * block, and the article ships with raw JSON where a diagram should be. Nothing
 * about that is loud — the page still builds, the test suite still passes, and
 * the only person who finds out is a reader.
 *
 * So the fenced blocks in the actual published posts are parsed here, and each
 * one is rendered. A post cannot ship a figure that does not draw.
 */

const FENCE = /```bf-figure\r?\n([\s\S]*?)```/g;

/** Every ```bf-figure block in the published corpus, tagged with its post. */
function figuresInCorpus(): Array<{ slug: string; index: number; source: string }> {
  const found: Array<{ slug: string; index: number; source: string }> = [];
  for (const post of BLOG_POSTS) {
    let index = 0;
    for (const match of post.content.matchAll(FENCE)) {
      found.push({ slug: post.slug, index: index++, source: match[1] });
    }
  }
  return found;
}

const CORPUS = figuresInCorpus();

describe('BlogFigure', () => {
  it('the published posts contain figures at all', () => {
    // Guards the regex itself: a change to the fence language that nobody
    // noticed would otherwise make every assertion below vacuously pass.
    expect(CORPUS.length).toBeGreaterThan(0);
  });

  it('every figure in every published post parses', () => {
    const broken = CORPUS.filter((figure) => parseFigure(figure.source) === null)
      .map((figure) => `${figure.slug} #${figure.index}`);
    expect(broken).toEqual([]);
  });

  it('every figure declares a kind this component renders', () => {
    const KINDS = ['flow', 'matrix', 'stack', 'bars', 'compare', 'templates', 'launch'];
    const unknown = CORPUS
      .map((figure) => ({ ...figure, spec: parseFigure(figure.source) }))
      .filter((figure) => figure.spec && !KINDS.includes(figure.spec.kind))
      .map((figure) => `${figure.slug} #${figure.index}: ${figure.spec?.kind}`);
    expect(unknown).toEqual([]);
  });

  it('every figure renders without throwing and produces visible content', () => {
    for (const figure of CORPUS) {
      const spec = parseFigure(figure.source);
      expect(spec, `${figure.slug} #${figure.index} did not parse`).not.toBeNull();
      const { container, unmount } = render(<BlogFigure spec={spec as FigureSpec} />);
      expect(container.querySelector('figure'), `${figure.slug} #${figure.index}`).not.toBeNull();
      expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
      unmount();
    }
  });

  it('resolves every embedded template id against the résumé registry', () => {
    // The `templates` figure names ids and owns no data of its own, so a
    // renamed template silently renders an EMPTY gallery — the exact failure
    // the port already produced once by dropping the embeds altogether.
    const ids = new Set(RESUME_TEMPLATES.map((template) => template.id));
    const dangling: string[] = [];
    for (const figure of CORPUS) {
      const spec = parseFigure(figure.source);
      if (spec?.kind !== 'templates') continue;
      for (const id of spec.templateIds) if (!ids.has(id as never)) dangling.push(`${figure.slug}: ${id}`);
    }
    expect(dangling).toEqual([]);
  });

  it('keeps every launch link site-relative', () => {
    // A figure is authored content; an absolute href in authored content is an
    // open redirect. The renderer drops them, so assert the corpus has none
    // rather than letting a post ship a link that silently disappears.
    const external: string[] = [];
    for (const figure of CORPUS) {
      const spec = parseFigure(figure.source);
      if (spec?.kind !== 'launch') continue;
      for (const link of spec.links) {
        if (!link.href.startsWith('/') || link.href.startsWith('//')) external.push(`${figure.slug}: ${link.href}`);
      }
    }
    expect(external).toEqual([]);
  });

  it('restored an inline embed to every ported template article', () => {
    // The port dropped 14 posts' embeds. Twelve are restorable from registries
    // that exist; the two that needed sample-people and platform-video fixtures
    // stay text-only, and are named here so re-adding a fixture is noticed.
    const withFigure = new Set(CORPUS.map((figure) => figure.slug));
    const restored = BLOG_POSTS
      .filter((post) => /^best-resume-template-for-/.test(post.slug) || post.slug === 'how-to-choose-the-right-resume-template')
      .map((post) => post.slug);
    expect(restored.length).toBe(9 + 1);
    expect(restored.filter((slug) => !withFigure.has(slug))).toEqual([]);
    expect(withFigure.has('video-resume-examples-that-land-interviews')).toBe(true);
    expect(withFigure.has('how-to-build-a-3d-world-resume-in-hired-video-studio')).toBe(true);
  });

  it('rejects malformed JSON rather than throwing', () => {
    expect(parseFigure('{ not json')).toBeNull();
    expect(parseFigure('[]')).toBeNull();
    expect(parseFigure('"a string"')).toBeNull();
    expect(parseFigure('{ "title": "no kind" }')).toBeNull();
  });

  it('plots every proof form on the fidelity/effort matrix, at the product’s own numbers', () => {
    // The one figure in the corpus that restates data the product owns. A post
    // that quietly dropped a proof — or drew one a point cheaper than it is —
    // would be advertising different advice than /realize gives.
    const matrix = CORPUS
      .map((figure) => parseFigure(figure.source))
      .find((spec): spec is Extract<FigureSpec, { kind: 'matrix' }> => spec?.kind === 'matrix');
    expect(matrix, 'no matrix figure found in the corpus').toBeDefined();

    for (const proof of PROOF_FORMS) {
      // Matched on the plotted coordinates rather than the label, since the
      // label is prose and the numbers are the claim.
      const plotted = matrix!.points.filter((point) => point.x === proof.effort && point.y === proof.fidelity);
      expect(plotted.length, `nothing plotted at effort ${proof.effort} / fidelity ${proof.fidelity} for ${proof.key}`)
        .toBeGreaterThan(0);
    }
    expect(matrix!.points).toHaveLength(PROOF_FORMS.length);
  });
});
