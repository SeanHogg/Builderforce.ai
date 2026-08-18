import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { realCatalogTranslator } from './realCatalogTranslations';

/**
 * The resolver's own header states the standard it is held to: "a translator the
 * tests build cannot quietly be less capable than the one the app uses." It has
 * now failed that twice — once on `t.has`, once on plural arms — so the two
 * callables added alongside them get pinned here rather than trusted.
 *
 * `t.raw` matters because the copy it returns is structural: the homepage's About
 * band, the hero's seeded canvas objects and the FAQ are all arrays of objects in
 * the catalog, and a resolver that stringifies them turns "renders three points"
 * into a crash. `t.rich` matters because the homepage `<h1>` is written through
 * it, so without it no test can assert the headline a visitor actually reads.
 */
const catalog = {
  home: {
    heroTitle: 'Any idea into <em>real.</em>',
    plain: 'No tags here',
    about: {
      points: [
        { title: 'One', body: 'First' },
        { title: 'Two', body: 'Second' },
      ],
    },
  },
};

const useTranslations = realCatalogTranslator(catalog as unknown as Record<string, unknown>);

describe('realCatalogTranslator', () => {
  it('returns catalog values through t.raw with their shape intact', () => {
    const t = useTranslations('home.about');

    expect(t.raw('points')).toEqual([
      { title: 'One', body: 'First' },
      { title: 'Two', body: 'Second' },
    ]);
  });

  it('gives t.raw the same namespace resolution as t', () => {
    expect(useTranslations().raw('home.plain')).toBe('No tags here');
    expect(useTranslations('home').raw('missing')).toBeUndefined();
  });

  it('hands each rich-text span to its tag renderer', () => {
    const t = useTranslations('home');
    const nodes = t.rich('heroTitle', { em: (chunks) => <em>{chunks}</em> });

    expect(renderToStaticMarkup(<>{nodes}</>)).toBe('Any idea into <em>real.</em>');
  });

  it('leaves a message with no tags as plain copy', () => {
    const t = useTranslations('home');

    expect(renderToStaticMarkup(<>{t.rich('plain', { em: (c) => <em>{c}</em> })}</>)).toBe('No tags here');
  });

  it('keeps the referential stability the real hook guarantees', () => {
    expect(useTranslations('home')).toBe(useTranslations('home'));
  });
});
