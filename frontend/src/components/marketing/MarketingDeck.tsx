'use client';

/**
 * MarketingDeck — the guided "ultimate demo" walkthrough at /demo.
 *
 * A paged slide deck a presenter (or a self-serve visitor) follows to see one
 * idea go from sign-in → a running app → deployed + tested → a human+agent team
 * → a lean team steering an agent workforce. Copy is fully localized under the
 * `marketingDeck` namespace (slides via t.raw, UI labels via t); all colour comes
 * from theme tokens so it reads in light AND dark, and the stage is fluid/mobile.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

type SlideKind = 'intro' | 'scenario' | 'outro';

interface Slide {
  kind: SlideKind;
  /** Two-digit chapter marker for scenario slides, e.g. "01". */
  chapter?: string;
  eyebrow: string;
  title: string;
  tagline: string;
  /** The click-by-click the user follows (scenario slides). */
  steps?: string[];
  /** The "what you'll see" WOW payoff (scenario slides). */
  see?: string;
}

export default function MarketingDeck() {
  const t = useTranslations('marketingDeck');
  const slides = t.raw('slides') as Slide[];
  const total = slides.length;
  const [i, setI] = useState(0);

  const go = useCallback(
    (next: number) => setI((prev) => Math.min(Math.max(next, 0), total - 1)),
    [total],
  );
  const next = useCallback(() => go(i + 1), [go, i]);
  const prev = useCallback(() => go(i - 1), [go, i]);

  // Keyboard paging — arrows + space, the way people expect a deck to drive.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
      else if (e.key === 'Home') { e.preventDefault(); go(0); }
      else if (e.key === 'End') { e.preventDefault(); go(total - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, go, total]);

  if (total === 0) return null;
  const slide = slides[i]!;
  const atStart = i === 0;
  const atEnd = i === total - 1;

  return (
    <section className="mdk" aria-roledescription="carousel" aria-label={t('seo.title')}>
      <style>{`
        .mdk { position: relative; width: 100%; max-width: var(--marketing-max); margin: 0 auto; display: flex; flex-direction: column;
          padding: clamp(48px, 7vw, 92px) var(--marketing-gutter) clamp(36px, 5vw, 64px); }
        .mdk-stage { display: flex; align-items: center; min-height: min(610px, calc(100svh - 180px)); }
        .mdk-card {
          position: relative; width: 100%; overflow: hidden; text-align: left;
          background: linear-gradient(145deg, var(--bg-elevated), color-mix(in srgb, var(--accent-subtle) 72%, transparent));
          border: 1px solid var(--border-accent, var(--border-subtle));
          border-radius: var(--radius-xl); padding: clamp(34px, 6vw, 70px);
          box-shadow: 0 24px 70px var(--shadow-coral-mid, rgba(59,130,246,.14));
        }
        .mdk-card::after { position: absolute; width: 420px; height: 420px; right: -190px; top: -230px;
          border: 1px solid var(--border-accent, var(--border-subtle)); border-radius: 50%;
          box-shadow: 0 0 0 55px color-mix(in srgb, var(--accent) 4%, transparent), 0 0 0 110px color-mix(in srgb, var(--accent) 2%, transparent);
          pointer-events: none; content: ''; }
        .mdk-chapter {
          font-family: var(--font-display); font-weight: 800; letter-spacing: -0.02em;
          font-size: var(--font-size-hero); line-height: .85;
          color: var(--accent); opacity: .24; margin-bottom: 18px;
        }
        .mdk-eyebrow {
          display: inline-flex; align-items: center; gap: 8px; margin-bottom: 16px;
          font-family: var(--font-display); font-size: var(--font-size-eyebrow); font-weight: 800;
          letter-spacing: 0.16em; text-transform: uppercase;
          color: var(--accent);
        }
        .mdk-title {
          font-family: var(--font-display); font-weight: 800; letter-spacing: -0.045em;
          font-size: var(--font-size-hero); line-height: .98;
          color: var(--text-primary); margin: 0 0 22px; max-width: 18ch;
        }
        .mdk-tagline {
          font-size: var(--font-size-lede); line-height: 1.65;
          color: var(--text-secondary); margin: 0; max-width: 720px;
        }
        .mdk-steps {
          list-style: none; margin: 34px 0 0; padding: 0; max-width: 760px;
          display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; text-align: left;
        }
        .mdk-step {
          display: flex; align-items: flex-start; gap: 14px;
          background: var(--bg-surface, var(--surface, rgba(0,0,0,0.02)));
          border: 1px solid var(--border-subtle, rgba(0,0,0,0.08));
          border-radius: var(--radius-lg); padding: 14px 16px;
          color: var(--text-primary); font-size: var(--font-size-lede);
        }
        .mdk-step-num {
          flex: 0 0 auto; width: 26px; height: 26px; border-radius: var(--radius-full);
          display: inline-flex; align-items: center; justify-content: center;
          font-family: var(--font-display); font-weight: 700; font-size: var(--font-size-small);
          color: var(--text-on-accent); background: var(--accent);
        }
        .mdk-see {
          margin: 28px 0 0; max-width: 760px; border: 1px solid var(--border-accent); border-radius: var(--radius-lg);
          padding: 16px 20px; font-size: var(--font-size-lede); font-weight: 600;
          color: var(--text-primary); background: var(--accent-subtle);
        }
        .mdk-see-label {
          display: block; font-size: var(--font-size-eyebrow); letter-spacing: 0.16em; text-transform: uppercase;
          font-weight: 700; opacity: 0.85; margin-bottom: 4px;
        }
        .mdk-ctas { display: flex; flex-wrap: wrap; gap: 12px; justify-content: flex-start; margin-top: 32px; }
        .mdk-btn {
          font-family: var(--font-display); font-weight: 600; font-size: var(--font-size-card-title);
          padding: 12px 26px; border-radius: var(--radius-lg); cursor: pointer; border: none;
          text-decoration: none; display: inline-flex; align-items: center; gap: 8px;
        }
        .mdk-btn-primary { color: var(--text-on-accent); background: var(--accent); box-shadow: 0 10px 28px var(--shadow-coral-mid, rgba(59,130,246,.24)); }
        .mdk-btn-ghost {
          color: var(--text-primary); background: var(--surface, transparent);
          border: 1px solid var(--border-subtle, rgba(0,0,0,0.14));
        }
        .mdk-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .mdk-controls {
          display: flex; align-items: center; justify-content: space-between; gap: 16px;
          width: 100%; margin: 22px 0 0; padding-top: 20px; border-top: 1px solid var(--border);
        }
        .mdk-dots { display: flex; gap: 9px; flex-wrap: wrap; justify-content: center; }
        .mdk-dot {
          width: 10px; height: 10px; border-radius: var(--radius-full); border: none; cursor: pointer; padding: 0;
          background: var(--border-strong, var(--text-muted, rgba(0,0,0,0.25)));
          opacity: 0.5; transition: opacity 0.15s, transform 0.15s;
        }
        .mdk-dot[aria-current="true"] { width: 28px; opacity: 1; background: var(--accent); }
        .mdk-progress { font-family: var(--font-display); font-weight: 600; font-size: var(--font-size-small);
          color: var(--text-muted); min-width: 54px; }
        .mdk-nav { display: flex; gap: 10px; }
        @media (max-width: 560px) {
          .mdk { padding-top: 30px; }
          .mdk-stage { min-height: 0; }
          .mdk-card { padding: 28px 22px; }
          .mdk-title { font-size: var(--font-size-page-title); }
          .mdk-steps { grid-template-columns: 1fr; }
          .mdk-controls { flex-direction: column-reverse; }
          .mdk-nav { width: 100%; }
          .mdk-nav .mdk-btn { flex: 1; justify-content: center; }
        }
      `}</style>

      <div className="mdk-stage">
        <article className="mdk-card" aria-live="polite">
          {slide.kind === 'scenario' && slide.chapter && (
            <div className="mdk-chapter" aria-hidden="true">{slide.chapter}</div>
          )}
          <span className="mdk-eyebrow">{slide.eyebrow}</span>
          <h1 className="mdk-title">{slide.title}</h1>
          <p className="mdk-tagline">{slide.tagline}</p>

          {slide.steps && slide.steps.length > 0 && (
            <ol className="mdk-steps">
              {slide.steps.map((step, s) => (
                <li key={s} className="mdk-step">
                  <span className="mdk-step-num" aria-hidden="true">{s + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          )}

          {slide.see && (
            <p className="mdk-see">
              <span className="mdk-see-label">{t('ui.seeLabel')}</span>
              {slide.see}
            </p>
          )}

          {slide.kind === 'intro' && (
            <div className="mdk-ctas">
              <button type="button" className="mdk-btn mdk-btn-primary" onClick={next}>
                {t('ui.start')} →
              </button>
            </div>
          )}

          {slide.kind === 'outro' && (
            <div className="mdk-ctas">
              <Link href="/register" className="mdk-btn mdk-btn-primary">{t('ui.ctaPrimary')}</Link>
              <Link href="/book-demo" className="mdk-btn mdk-btn-ghost">{t('ui.ctaSecondary')}</Link>
              <button type="button" className="mdk-btn mdk-btn-ghost" onClick={() => go(0)}>{t('ui.restart')}</button>
            </div>
          )}
        </article>
      </div>

      <div className="mdk-controls">
        <div className="mdk-nav">
          <button type="button" className="mdk-btn mdk-btn-ghost" onClick={prev} disabled={atStart} aria-label={t('ui.prev')}>
            ← {t('ui.prev')}
          </button>
          <button type="button" className="mdk-btn mdk-btn-ghost" onClick={next} disabled={atEnd} aria-label={t('ui.next')}>
            {t('ui.next')} →
          </button>
        </div>
        <div className="mdk-dots" role="group" aria-label={t('ui.progressLabel')}>
          {slides.map((s, d) => (
            <button
              key={d}
              type="button"
              className="mdk-dot"
              aria-current={d === i}
              aria-label={`${t('ui.progress', { current: d + 1, total })}: ${s.eyebrow}`}
              onClick={() => go(d)}
            />
          ))}
        </div>
        <div className="mdk-progress" aria-hidden="true">{t('ui.progress', { current: i + 1, total })}</div>
      </div>
    </section>
  );
}
