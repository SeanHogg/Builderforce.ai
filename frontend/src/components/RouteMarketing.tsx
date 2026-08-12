'use client';

import { Suspense, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getRouteMarketing, isNoindexTeaserRoute } from '@/lib/routeMarketing';
import { PRODUCT_SECTIONS } from '@/lib/content';
import { routeMarketingSchema } from '@/lib/structured-data';
import { ButtonLink, Icon, Surface, surfaceClassName } from '@/components/ui';
import JsonLd from './JsonLd';
import RelatedArticles from './blog/RelatedArticles';
import { signInHref } from '@/lib/auth';
import { ProjectManagerVisual } from './marketing/ProjectManagerVisual';

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
function RouteMarketingContent({ pathname, tab }: { pathname: string; tab: string | null }) {
  const t = useTranslations('routeMarketing');
  const m = getRouteMarketing(pathname);
  const isProjectsRoute = pathname === '/projects';
  const conversionVariant = isProjectsRoute && tab === 'manager' ? 'manager' : isProjectsRoute ? 'projects' : null;
  const loginHref = signInHref(conversionVariant === 'manager' ? `${pathname}?tab=manager` : pathname);
  const title = conversionVariant ? t(`${conversionVariant}.title`) : m.title;
  const description = conversionVariant ? t(`${conversionVariant}.description`) : m.description;
  const metaDesc = conversionVariant ? t(`${conversionVariant}.seoDescription`) : m.seoDescription ?? m.description;
  const faq = conversionVariant === 'manager' ? undefined : m.faq;

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
    document.title = `${title} — Builderforce.ai`;
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
  }, [title, metaDesc, pathname]);

  return (
    <div className="route-mkt">
      <JsonLd
        data={routeMarketingSchema({
          path: pathname,
          title,
          description: metaDesc,
          faq,
        })}
      />

      <section className={surfaceClassName({ tone: 'raised', padding: 'lg' }, `rm-hero${conversionVariant ? ' rm-hero-conversion' : ''}`)}>
        <div className="rm-hero-copy">
          {conversionVariant ? (
            <div className="ui-eyebrow rm-eyebrow">{t(`${conversionVariant}.eyebrow`)}</div>
          ) : (
            <div className="rm-icon" aria-hidden="true"><Icon source={m.icon} size={28} /></div>
          )}
          <h1 className="ui-text-page-title rm-title">{title}</h1>
          <p className="rm-desc">{description}</p>
          {conversionVariant === 'manager' ? (
            <div className="rm-auth-note"><Icon source="lock" size={15} />{t('manager.authRequired')}</div>
          ) : !conversionVariant ? (
            <p className="ui-text-small rm-sub">{t('subtitle', { surface: m.title })}</p>
          ) : null}
          <div className="rm-actions">
            {conversionVariant === 'manager' ? (
              <>
                <ButtonLink href={loginHref} variant="primary" size="lg"><Icon source="lock" size={16} />{t('manager.primaryCta')}</ButtonLink>
                <ButtonLink href="/register" variant="secondary" size="lg">{t('manager.secondaryCta')}</ButtonLink>
              </>
            ) : conversionVariant === 'projects' ? (
              <>
                <ButtonLink href="/register" variant="primary" size="lg"><Icon source="sparkles" size={16} />{t('projects.primaryCta')}</ButtonLink>
                <ButtonLink href={loginHref} variant="secondary" size="lg">{t('projects.secondaryCta')}</ButtonLink>
              </>
            ) : (
              <>
                <ButtonLink href="/create/new" variant="primary" size="lg"><span aria-hidden="true">✦</span>{t('startFree')}</ButtonLink>
                <ButtonLink href={loginHref} variant="secondary" size="lg">{t('signIn')}</ButtonLink>
                <ButtonLink href="/creation-canvas" variant="ghost" size="lg">{t('exploreCanvas')} →</ButtonLink>
              </>
            )}
          </div>
          {conversionVariant && (
            <div className="rm-proof-row">
              {[0, 1, 2].map((index) => <span key={index}><Icon source="check" size={14} />{t(`${conversionVariant}.proof.${index}`)}</span>)}
            </div>
          )}
        </div>
        {conversionVariant && <ProjectManagerVisual variant={conversionVariant} />}
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

      {faq && faq.length > 0 && (
        <section className="rm-faq">
          <div className="ui-eyebrow rm-inside-head">{t('faqHeading')}</div>
          <div className="rm-faq-list">
            {faq.map((q) => (
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

      {conversionVariant && (
        <section className="rm-close">
          <div>
            <div className="ui-eyebrow">{t(`${conversionVariant}.closingEyebrow`)}</div>
            <h2>{t(`${conversionVariant}.closingTitle`)}</h2>
            <p>{t(`${conversionVariant}.closingBody`)}</p>
          </div>
          <ButtonLink href={conversionVariant === 'manager' ? loginHref : '/register'} variant="primary" size="lg">
            {t(`${conversionVariant}.closingCta`)}<Icon source="arrow-up-right" size={16} />
          </ButtonLink>
        </section>
      )}

      {m.relatedSurface && (
        <RelatedArticles surface={m.relatedSurface} heading={t('relatedReading')} embedded />
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
        .rm-hero-copy { min-width: 0; }
        .rm-hero-conversion { display: grid; grid-template-columns: minmax(0, .9fr) minmax(420px, 1.1fr); gap: var(--space-8); align-items: center; text-align: left; overflow: hidden; }
        .rm-hero-conversion .rm-desc { margin-left: 0; max-width: 620px; font-size: var(--font-size-section); }
        .rm-hero-conversion .rm-actions { justify-content: flex-start; margin-top: var(--space-5); }
        .rm-eyebrow { color: var(--accent); margin-bottom: var(--space-3); }
        .rm-auth-note { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--text-secondary); background: var(--surface-interactive); border: 1px solid var(--border-subtle); border-radius: var(--radius-full); padding: var(--space-2) var(--space-3); font-size: var(--font-size-small); margin-top: var(--space-2); }
        .rm-proof-row { display: flex; flex-wrap: wrap; gap: var(--space-4); margin-top: var(--space-5); color: var(--text-secondary); font-size: var(--font-size-small); }
        .rm-proof-row span { display: inline-flex; align-items: center; gap: var(--space-1); }
        .rm-proof-row svg { color: var(--success); }
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

        .rm-faq { width: 100%; }
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
        .rm-close { margin-top: var(--space-10); padding: clamp(28px, 5vw, 56px); border-radius: var(--radius-xl); display: flex; justify-content: space-between; align-items: center; gap: var(--space-8); background: linear-gradient(125deg, color-mix(in srgb, var(--accent) 16%, var(--surface-raised)), color-mix(in srgb, var(--coral-bright) 10%, var(--surface-raised))); border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border-subtle)); }
        .rm-close h2 { margin: var(--space-2) 0; font-size: var(--font-size-page-title); color: var(--text-primary); }
        .rm-close p { margin: 0; color: var(--text-secondary); max-width: 680px; }
        .rm-product-visual { position: relative; padding: var(--space-4); border-radius: var(--radius-xl); border: 1px solid color-mix(in srgb, var(--accent) 25%, var(--border-subtle)); background: color-mix(in srgb, var(--bg-deep) 92%, var(--accent)); box-shadow: 0 24px 70px color-mix(in srgb, var(--accent) 14%, transparent); transform: rotate(1deg); }
        .rm-visual-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-4); }
        .rm-visual-brand { display: flex; gap: var(--space-2); align-items: center; font-weight: 700; color: var(--text-primary); }
        .rm-live { display: flex; gap: var(--space-2); align-items: center; color: var(--success); font-size: var(--font-size-small); }
        .rm-live > span { width: 7px; height: 7px; border-radius: 50%; background: var(--success); box-shadow: 0 0 0 4px color-mix(in srgb, var(--success) 16%, transparent); }
        .rm-team { display: flex; }
        .rm-team span { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 50%; margin-left: -5px; border: 2px solid var(--bg-deep); background: var(--accent); color: white; font-size: var(--font-size-field-label); font-weight: 800; }
        .rm-board { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-3); }
        .rm-board-column { padding: var(--space-3); border-radius: var(--radius-lg); background: color-mix(in srgb, var(--surface-raised) 86%, transparent); min-height: 220px; }
        .rm-column-title { display: flex; justify-content: space-between; color: var(--text-secondary); font-size: var(--font-size-small); margin-bottom: var(--space-3); }
        .rm-column-title b { font-weight: 500; color: var(--text-muted); }
        .rm-task-card { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); border-radius: var(--radius-md); background: var(--surface-raised); border: 1px solid var(--border-subtle); box-shadow: var(--shadow-sm); }
        .rm-task-card strong { color: var(--text-primary); font-size: var(--font-size-small); line-height: 1.4; }
        .rm-task-kicker { color: var(--accent); font-size: var(--font-size-field-label); font-weight: 800; text-transform: uppercase; letter-spacing: .08em; }
        .rm-task-meta { display: flex; align-items: center; gap: var(--space-2); color: var(--text-muted); font-size: var(--font-size-field-label); }
        .rm-task-meta i { width: 16px; height: 16px; border-radius: 50%; background: var(--sky-bright); }
        .rm-task-placeholder { height: 44px; margin-top: var(--space-3); border-radius: var(--radius-md); border: 1px dashed var(--border-subtle); }
        .rm-manager-score { display: flex; gap: var(--space-4); align-items: center; padding: var(--space-4); border-radius: var(--radius-lg); background: var(--surface-raised); border: 1px solid var(--border-subtle); }
        .rm-score-number { color: var(--text-primary); font-size: var(--font-size-page-title); font-weight: 750; letter-spacing: -.06em; }
        .rm-score-unit { color: var(--text-muted); }
        .rm-manager-score > div:last-child { display: flex; flex-direction: column; gap: 3px; color: var(--text-secondary); font-size: var(--font-size-small); }
        .rm-manager-score strong { color: var(--text-primary); }
        .rm-manager-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-3); margin: var(--space-3) 0; }
        .rm-mini-card { display: grid; grid-template-columns: auto 1fr; gap: var(--space-2); align-items: center; padding: var(--space-3); border-radius: var(--radius-md); background: color-mix(in srgb, var(--surface-raised) 88%, transparent); color: var(--text-secondary); font-size: var(--font-size-field-label); }
        .rm-mini-card span { grid-column: 1 / -1; font-size: var(--font-size-section); color: var(--text-primary); font-weight: 750; }
        .rm-decision { display: grid; grid-template-columns: auto 1fr auto; gap: var(--space-3); align-items: start; padding: var(--space-3); border-radius: var(--radius-lg); background: color-mix(in srgb, var(--accent) 10%, var(--surface-raised)); border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border-subtle)); }
        .rm-decision-icon { width: 28px; height: 28px; display: grid; place-items: center; border-radius: var(--radius-md); background: var(--accent); color: white; }
        .rm-decision div { display: flex; flex-direction: column; gap: 3px; font-size: var(--font-size-small); color: var(--text-secondary); }
        .rm-decision strong { color: var(--text-primary); }
        .rm-now { color: var(--text-muted); font-size: var(--font-size-field-label); }
        @media (max-width: 900px) { .rm-hero-conversion { grid-template-columns: 1fr; } .rm-product-visual { transform: none; } }
        @media (max-width: 620px) { .rm-board { grid-template-columns: 1fr; } .rm-board-column { min-height: 0; } .rm-manager-grid { grid-template-columns: 1fr; } .rm-close { align-items: flex-start; flex-direction: column; } }
      `}</style>
    </div>
  );
}

function RouteMarketingQuery({ pathname }: { pathname: string }) {
  const searchParams = useSearchParams();
  return <RouteMarketingContent pathname={pathname} tab={searchParams.get('tab')} />;
}

export default function RouteMarketing({ pathname }: { pathname: string }) {
  return (
    <Suspense fallback={<RouteMarketingContent pathname={pathname} tab={null} />}>
      <RouteMarketingQuery pathname={pathname} />
    </Suspense>
  );
}
