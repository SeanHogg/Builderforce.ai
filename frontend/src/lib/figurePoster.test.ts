import { describe, expect, it } from 'vitest';
// The poster renderer is a build-script module (plain ESM, run by `prebuild`
// through `node`), tested from here because this is where the test runner looks
// and because the corpus it draws lives in `src/content`.
import { esc, firstFigure, posterArt } from '../../scripts/lib/figurePoster.mjs';
import { BLOG_POSTS } from './blogData';
import { FIGURE_RENDERERS } from '@/components/blog/figures/registry';

/**
 * The share card is the only thing most people ever see of an article. It was a
 * TITLE on a gradient for 125 posts, which made every share look like every
 * other share — so the card now draws the post's own first figure.
 *
 * That creates a seam: the figure vocabulary is declared for the PAGE, and the
 * poster draws a subset of it for a PNG. A kind added to the page and forgotten
 * here silently reverts that post's card to a title, which nobody would notice
 * until they shared it. So the seam is asserted rather than remembered.
 */

/** Kinds with no poster form, each because a card cannot honestly show it. */
const ARTLESS: Record<string, string> = {
  templates: 'a résumé gallery resolved from a registry — four grey rectangles would be a lie about what is in the post',
  launch: 'a list of links; a card cannot be clicked, so drawing one sells nothing',
};

const PALETTE = {
  ink: '#f8fafc',
  muted: '#94a3b8',
  accent: '#ff6b5c',
  good: '#3fe0a5',
  bad: '#c084fc',
  panel: '#101826',
};
const BOX = { x: 610, y: 128, w: 510, h: 372 };

describe('figurePoster', () => {
  it('draws every figure kind the page renders, or declares why it cannot', () => {
    const undrawable: string[] = [];
    for (const kind of Object.keys(FIGURE_RENDERERS)) {
      if (kind in ARTLESS) continue;
      const sample = SAMPLES[kind];
      expect(sample, `no sample declared for the '${kind}' figure`).toBeDefined();
      if (!posterArt(sample, BOX, PALETTE)) undrawable.push(kind);
    }
    expect(undrawable, 'add a poster form in scripts/lib/figurePoster.mjs, or list it in ARTLESS with a reason').toEqual([]);
  });

  it('gives most published articles a drawn card rather than a title card', () => {
    // Not "every": the legacy corpus predates the figure vocabulary and keeps
    // the title layout, which is the honest fallback. What matters is that a
    // post WITH a figure never falls back.
    const withFigure = BLOG_POSTS.filter((post) => firstFigure(post.content));
    expect(withFigure.length).toBeGreaterThan(10);
    const fellBack = withFigure
      .filter((post) => {
        const spec = firstFigure(post.content);
        return !(spec.kind in ARTLESS) && !posterArt(spec, BOX, PALETTE);
      })
      .map((post) => post.slug);
    expect(fellBack).toEqual([]);
  });

  it('escapes label text into the SVG', () => {
    const art: string = posterArt(
      { kind: 'stack', bands: [{ label: 'Ampersands & <script>' }] },
      BOX,
      PALETTE,
    );
    expect(art).toContain('&amp;');
    expect(art).not.toContain('<script>');
    expect(esc('a & b')).toBe('a &amp; b');
  });

  it('reads the first figure of a post and ignores the rest', () => {
    const post = BLOG_POSTS.find((entry) => entry.slug === 'grade-the-proof-and-close-the-loop');
    expect(post, 'the methodology article is the fixture').toBeDefined();
    const spec = firstFigure(post!.content);
    expect(spec.kind).toBe('bars');
    expect(spec.rows).toHaveLength(8);
  });
});

/** One minimal spec per drawable kind — the fixture the seam assertion uses. */
const SAMPLES: Record<string, unknown> = {
  flow: { kind: 'flow', steps: [{ label: 'Read' }, { label: 'Prove' }, { label: 'Build' }] },
  stack: { kind: 'stack', bands: [{ label: 'Idea' }, { label: 'Make' }] },
  bars: { kind: 'bars', max: 5, rows: [{ label: 'Demo video', value: 1 }, { label: 'Pilot', value: 4 }] },
  compare: { kind: 'compare', columns: [{ title: 'Before', items: ['a'] }, { title: 'After', items: ['b'] }] },
  matrix: { kind: 'matrix', xLabel: 'Effort', yLabel: 'Fidelity', points: [{ label: 'Pilot', x: 4, y: 4 }] },
  screen: { kind: 'screen', frame: 'A board', regions: [{ label: 'The board', x: 4, y: 8, w: 92, h: 70 }] },
  devices: { kind: 'devices', devices: [{ label: 'Desktop', width: 1280 }, { label: 'Phone', width: 390 }] },
};
