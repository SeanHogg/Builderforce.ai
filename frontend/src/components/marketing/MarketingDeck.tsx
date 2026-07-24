'use client';

/**
 * MarketingDeck — the guided "ultimate demo" walkthrough at /marketing.
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
        .mdk { position: relative; min-height: calc(100vh - 64px); display: flex; flex-direction: column;
          padding: clamp(24px, 5vw, 56px) clamp(16px, 5vw, 48px) clamp(20px, 4vw, 40px); }
        .mdk-stage { flex: 1; display: flex; align-items: center; justify-content: center; }
        .mdk-card {
          width: 100%; max-width: 900px; text-align: center;
          background: var(--surface-card, var(--bg-elevated, #fff));
          border: 1px solid var(--border-subtle, rgba(0,0,0,0.08));
          border-radius: 24px; padding: clamp(28px, 5vw, 64px) clamp(22px, 5vw, 60px);
          box-shadow: var(--shadow-coral-soft, 0 20px 60px -30px rgba(0,0,0,0.4));
        }
        .mdk-chapter {
          font-family: var(--font-display); font-weight: 800; letter-spacing: -0.02em;
          font-size: clamp(2.6rem, 9vw, 4.4rem); line-height: 1;
          color: var(--coral-bright, #ff6b4a); opacity: 0.9; margin-bottom: 10px;
        }
        .mdk-eyebrow {
          display: inline-flex; align-items: center; gap: 8px; margin-bottom: 18px;
          font-family: var(--font-display); font-size: 0.72rem; font-weight: 600;
          letter-spacing: 0.16em; text-transform: uppercase;
          color: var(--coral-bright, #ff6b4a);
          border: 1px solid var(--border-accent, var(--border-subtle, rgba(0,0,0,0.12)));
          border-radius: 999px; padding: 5px 15px;
          background: color-mix(in srgb, var(--coral-bright, #ff6b4a) 8%, transparent);
        }
        .mdk-title {
          font-family: var(--font-display); font-weight: 800; letter-spacing: -0.02em;
          font-size: clamp(1.7rem, 4.6vw, 3rem); line-height: 1.08;
          color: var(--text-primary, #14181f); margin: 0 0 14px;
        }
        .mdk-tagline {
          font-size: clamp(1rem, 2.2vw, 1.28rem); line-height: 1.5;
          color: var(--text-secondary, #4a5568); margin: 0 auto; max-width: 640px;
        }
        .mdk-steps {
          list-style: none; margin: 30px auto 0; padding: 0; max-width: 560px;
          display: flex; flex-direction: column; gap: 12px; text-align: left;
        }
        .mdk-step {
          display: flex; align-items: flex-start; gap: 14px;
          background: var(--surface, var(--bg-base, rgba(0,0,0,0.02)));
          border: 1px solid var(--border-subtle, rgba(0,0,0,0.08));
          border-radius: 14px; padding: 14px 16px;
          color: var(--text-primary, #14181f); font-size: clamp(0.95rem, 1.8vw, 1.05rem);
        }
        .mdk-step-num {
          flex: 0 0 auto; width: 26px; height: 26px; border-radius: 999px;
          display: inline-flex; align-items: center; justify-content: center;
          font-family: var(--font-display); font-weight: 700; font-size: 0.82rem;
          color: #fff; background: var(--coral-bright, #ff6b4a);
        }
        .mdk-see {
          margin: 30px auto 0; max-width: 620px; border-radius: 14px;
          padding: 16px 20px; font-size: clamp(0.98rem, 2vw, 1.12rem); font-weight: 600;
          color: var(--text-on-accent, #fff);
          background: linear-gradient(135deg, var(--coral-bright, #ff6b4a), var(--coral-dark, #e0452a));
        }
        .mdk-see-label {
          display: block; font-size: 0.68rem; letter-spacing: 0.16em; text-transform: uppercase;
          font-weight: 700; opacity: 0.85; margin-bottom: 4px;
        }
        .mdk-ctas { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; margin-top: 32px; }
        .mdk-btn {
          font-family: var(--font-display); font-weight: 600; font-size: 0.98rem;
          padding: 12px 26px; border-radius: 12px; cursor: pointer; border: none;
          text-decoration: none; display: inline-flex; align-items: center; gap: 8px;
        }
        .mdk-btn-primary { color: #fff; background: linear-gradient(135deg, var(--coral-bright, #ff6b4a), var(--coral-dark, #e0452a)); }
        .mdk-btn-ghost {
          color: var(--text-primary, #14181f); background: var(--surface, transparent);
          border: 1px solid var(--border-subtle, rgba(0,0,0,0.14));
        }
        .mdk-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .mdk-controls {
          display: flex; align-items: center; justify-content: space-between; gap: 16px;
          max-width: 900px; width: 100%; margin: clamp(20px, 3vw, 32px) auto 0;
        }
        .mdk-dots { display: flex; gap: 9px; flex-wrap: wrap; justify-content: center; }
        .mdk-dot {
          width: 10px; height: 10px; border-radius: 999px; border: none; cursor: pointer; padding: 0;
          background: var(--border-strong, var(--text-muted, rgba(0,0,0,0.25)));
          opacity: 0.5; transition: opacity 0.15s, transform 0.15s;
        }
        .mdk-dot[aria-current="true"] { opacity: 1; transform: scale(1.35); background: var(--coral-bright, #ff6b4a); }
        .mdk-progress { font-family: var(--font-display); font-weight: 600; font-size: 0.85rem;
          color: var(--text-muted, #6b7280); min-width: 54px; }
        .mdk-nav { display: flex; gap: 10px; }
        @media (max-width: 560px) {
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
        <div className="mdk-dots" role="tablist" aria-label={t('ui.progressLabel')}>
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
