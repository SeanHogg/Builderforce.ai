'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getRouteMarketing, isNoindexTeaserRoute } from '@/lib/routeMarketing';
import { PRODUCT_SECTIONS } from '@/lib/content';
import { routeMarketingSchema } from '@/lib/structured-data';
import { ButtonLink, Icon, Surface, surfaceClassName } from '@/components/ui';
import JsonLd from './JsonLd';
import RelatedArticles from './blog/RelatedArticles';
import { signInHref } from '@/lib/auth';

/**
 * Marketing page rendered (inside MarketingShell) when a logged-out visitor or
 * crawler hits an authenticated route — a feature-specific hero, "how it works"
 * highlights, the product map, a per-feature FAQ, associated blog articles, and
 * JSON-LD. Replaces the old one-line gate so every authed deep link is a real,
 * indexable marketing page rather than a dead end.
 *
 * All per-route copy lives in lib/routeMarketing.ts (single source of truth);
 * this component only renders it and decides its own section visibility.
 */
export default function RouteMarketing({ pathname }: { pathname: string }) {
  const t = useTranslations('routeMarketing');
  const m = getRouteMarketing(pathname);
  const loginHref = signInHref(pathname);
  const metaDesc = m.seoDescription ?? m.description;

  // Client-set <title>/description so each feature route has a unique, crawlable
  // head (these routes render client-side, so there is no server metadata
  // export). Modern crawlers execute JS and read both this and the JSON-LD below.
  //
  // The `noindex` half matters as much as the title. Every authenticated route
  // renders this teaser to a logged-out visitor, which quietly turned operator
  // tooling — Platform Admin, the workspace switcher — into indexable pages. The
  // root layout declares `robots: 'index, follow'`, so a route that must stay
  // out of the index has to say so here, and has to put the tag BACK on unmount
  // or one visit to /admin would suppress the whole site for that session.
  useEffect(() => {
    const prevTitle = document.title;
    document.title = `${m.title} — Builderforce.ai`;
    const tag = document.querySelector('meta[name="description"]');
    const prevDesc = tag?.getAttribute('content') ?? null;
    if (tag) tag.setAttribute('content', metaDesc);

    const robots = document.querySelector('meta[name="robots"]');
    const prevRobots = robots?.getAttribute('content') ?? null;
    if (robots && isNoindexTeaserRoute(pathname)) robots.setAttribute('content', 'noindex, follow');

    return () => {
      document.title = prevTitle;
      if (tag && prevDesc !== null) tag.setAttribute('content', prevDesc);
      if (robots && prevRobots !== null) robots.setAttribute('content', prevRobots);
    };
  }, [m.title, metaDesc, pathname]);

  return (
    <div className="route-mkt">
      <JsonLd
        data={routeMarketingSchema({
          path: pathname,
          title: m.title,
          description: metaDesc,
          faq: m.faq,
        })}
      />

      <section className={surfaceClassName({ tone: 'raised', padding: 'lg' }, 'rm-hero')}>
        <div className="rm-icon" aria-hidden="true"><Icon source={m.icon} size={28} /></div>
        <h1 className="ui-text-page-title rm-title">{m.title}</h1>
        <p className="rm-desc">{m.description}</p>
        <p className="ui-text-small rm-sub">{t('subtitle', { surface: m.title })}</p>
        <div className="rm-actions">
          <ButtonLink href="/create/new" variant="primary" size="lg">
            <span aria-hidden="true">✦</span>
            {t('startFree')}
          </ButtonLink>
          <ButtonLink href={loginHref} variant="secondary" size="lg">{t('signIn')}</ButtonLink>
          <ButtonLink href="/creation-canvas" variant="ghost" size="lg">{t('exploreCanvas')} →</ButtonLink>
        </div>
      </section>

      {m.highlights && m.highlights.length > 0 && (
        <section className="rm-highlights">
          <div className="ui-eyebrow rm-inside-head">{t('howItWorks', { surface: m.title })}</div>
          <div className="rm-hl-grid">
            {m.highlights.map((h) => (
              <Surface key={h.title} tone="raised" padding="md">
                <div className="ui-text-card-title rm-hl-title">{h.title}</div>
                <div className="ui-text-small rm-hl-desc">{h.desc}</div>
              </Surface>
            ))}
          </div>
        </section>
      )}

      {m.figures && m.figures.length > 0 && (
        <section className="rm-figures">
          <div className="ui-eyebrow rm-inside-head">{t('seeHowItWorks')}</div>
          {m.figures.map((f) => (
            <figure key={f.src} className="rm-figure">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="rm-figure-img" src={f.src} alt={f.alt} loading="lazy" width={1600} height={900} />
              <figcaption className="ui-text-small rm-figure-cap">{f.caption}</figcaption>
            </figure>
          ))}
        </section>
      )}

      <section className="rm-inside">
        <div className="ui-eyebrow rm-inside-head">{t('whatYouGet')}</div>
        <div className="rm-grid">
          {PRODUCT_SECTIONS.map((s) => (
            <Link
              key={s.id}
              href={`/product#${s.id}`}
              className={surfaceClassName({ tone: 'raised', interactive: true }, 'rm-card')}
            >
              <div className="rm-card-icon" aria-hidden="true"><Icon source={s.icon} size={24} /></div>
              <div className="ui-text-card-title">{s.title}</div>
              <div className="ui-text-small rm-card-blurb">{s.blurb}</div>
            </Link>
          ))}
        </div>
      </section>

      {m.faq && m.faq.length > 0 && (
        <section className="rm-faq">
          <div className="ui-eyebrow rm-inside-head">{t('faqHeading')}</div>
          <div className="rm-faq-list">
            {m.faq.map((q) => (
              <details
                key={q.question}
                className={surfaceClassName({ tone: 'raised', padding: 'none' }, 'rm-faq-item')}
              >
                <summary className="ui-text-card-title rm-faq-q">{q.question}</summary>
                <p className="ui-text-body rm-faq-a">{q.answer}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {m.relatedSurface && (
        <RelatedArticles surface={m.relatedSurface} heading={t('relatedReading')} />
      )}

      {/* LAYOUT ONLY.
          This block used to be 95 lines and carried a fourth parallel vocabulary
          — `.rm-btn-primary` / `.rm-btn-secondary` / `.rm-btn-ghost` / `.rm-card`
          / `.rm-hl-card` / `.rm-faq-item` / `.rm-inside-head` re-declared the
          button, the card and the eyebrow that `<Button>`, `<Surface>` and
          `.ui-eyebrow` already own, on the single component that renders for 86
          public routes. Its eyebrow was 0.82rem sans against a documented
          0.68rem mono, its title clamped to a ramp that matched no role, and its
          buttons were `padding: 13px 26px` — off the space ramp entirely.

          What is left here is what genuinely belongs to THIS composition: the
          measure, the grid tracks, the gaps, and the disclosure marker. Colour,
          border, radius, type and motion all come from the primitives now, so
          this page cannot drift from the rest of the product again. */}
      <style>{`
        .route-mkt { max-width: var(--marketing-max); margin: 0 auto; padding: var(--space-6) var(--marketing-gutter); }
        .rm-hero { text-align: center; }
        .rm-icon { font-size: var(--font-size-hero); line-height: 1; margin-bottom: var(--space-4); }
        .rm-title { color: var(--text-primary); margin: 0 0 var(--space-3); }
        .rm-desc {
          font-size: var(--font-size-body);
          color: var(--text-secondary);
          max-width: var(--content-narrow);
          margin: 0 auto var(--space-2);
          line-height: 1.6;
        }
        .rm-sub { color: var(--text-muted); margin: 0 auto var(--space-6); }
        .rm-actions { display: flex; gap: var(--space-3); flex-wrap: wrap; justify-content: center; align-items: center; }

        .rm-highlights, .rm-figures, .rm-inside, .rm-faq { margin-top: var(--space-10); }
        .rm-hl-grid, .rm-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--space-4); }
        .rm-hl-title { margin-bottom: var(--space-1); }
        .rm-hl-desc, .rm-card-blurb { color: var(--text-secondary); }

        .rm-figures { display: flex; flex-direction: column; gap: var(--space-6); }
        .rm-figure { margin: 0; }
        .rm-figure-img {
          width: 100%; height: auto; display: block;
          border-radius: var(--radius-xl);
          border: 1px solid var(--border-subtle);
          background: var(--bg-deep);
        }
        .rm-figure-cap { color: var(--text-muted); text-align: center; margin-top: var(--space-2); }

        .rm-inside-head { text-align: center; margin-bottom: var(--space-5); }
        .rm-card { display: flex; flex-direction: column; gap: var(--space-2); text-decoration: none; }
        .rm-card-icon { font-size: var(--font-size-section); }

        .rm-faq { max-width: var(--content-narrow); margin-left: auto; margin-right: auto; }
        .rm-faq-list { display: flex; flex-direction: column; gap: var(--space-3); }
        .rm-faq-item { padding-left: var(--space-5); padding-right: var(--space-5); }
        .rm-faq-q {
          cursor: pointer; list-style: none; padding: var(--space-4) 0;
          color: var(--text-primary); display: flex;
          justify-content: space-between; align-items: center; gap: var(--space-3);
        }
        .rm-faq-q::-webkit-details-marker { display: none; }
        .rm-faq-q::after { content: '+'; color: var(--coral-bright); font-size: var(--font-size-section); line-height: 1; flex-shrink: 0; }
        .rm-faq-item[open] .rm-faq-q::after { content: '–'; }
        .rm-faq-a { margin: 0 0 var(--space-4); color: var(--text-secondary); }
      `}</style>
    </div>
  );
}
